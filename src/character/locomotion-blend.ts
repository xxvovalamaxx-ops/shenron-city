/**
 * Clip weights for the player's body: a 1D locomotion blend by ground speed,
 * with jump and landing layered over it.
 *
 * The first version switched clips at speed thresholds and cross-faded
 * between them, so a player easing into a run popped from walk to jog, and
 * the playback rate jumped with it. This blends instead:
 *
 *   speed   0 ─────── 1.45 ──────── 3.4 ─────────── 6.2 m/s
 *   clip    Idle      Walk          Jog             Sprint
 *
 * Two neighbouring clips at a time, weighted linearly, and every locomotion
 * clip advances on one shared, normalised stride phase — so the feet of the
 * walk and the jog land together while they are blended, instead of two
 * cycles drifting against each other.
 *
 * Pure: speed and timings in, weights out. Unit tested.
 */
import { CLIP_REFERENCE_SPEED } from './player-locomotion'

export type LocomotionClip = 'Idle_Loop' | 'Walk_Loop' | 'Jog_Fwd_Loop' | 'Sprint_Loop'
export type JumpClip = 'Jump_Start' | 'Jump_Loop' | 'Jump_Land'
export type BodyClip = LocomotionClip | JumpClip

/** Blend anchors, in ascending speed. */
export const LOCOMOTION_ANCHORS: ReadonlyArray<{ clip: LocomotionClip; speed: number }> = [
  { clip: 'Idle_Loop', speed: 0 },
  { clip: 'Walk_Loop', speed: CLIP_REFERENCE_SPEED.Walk_Loop },
  { clip: 'Jog_Fwd_Loop', speed: CLIP_REFERENCE_SPEED.Jog_Fwd_Loop },
  { clip: 'Sprint_Loop', speed: CLIP_REFERENCE_SPEED.Sprint_Loop },
]

export type ClipWeights = Record<BodyClip, number>

export function emptyWeights(): ClipWeights {
  return {
    Idle_Loop: 0,
    Walk_Loop: 0,
    Jog_Fwd_Loop: 0,
    Sprint_Loop: 0,
    Jump_Start: 0,
    Jump_Loop: 0,
    Jump_Land: 0,
  }
}

/** Locomotion weights for a ground speed; they always sum to 1. */
export function locomotionWeights(speed: number): Record<LocomotionClip, number> {
  const out: Record<LocomotionClip, number> = { Idle_Loop: 0, Walk_Loop: 0, Jog_Fwd_Loop: 0, Sprint_Loop: 0 }
  const s = Number.isFinite(speed) ? Math.max(0, speed) : 0
  const anchors = LOCOMOTION_ANCHORS
  if (s <= anchors[0].speed) {
    out[anchors[0].clip] = 1
    return out
  }
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]
    const b = anchors[i]
    if (s <= b.speed) {
      const t = (s - a.speed) / (b.speed - a.speed)
      out[a.clip] = 1 - t
      out[b.clip] = t
      return out
    }
  }
  out[anchors[anchors.length - 1].clip] = 1
  return out
}

/**
 * Stride cycles per second for the shared locomotion phase.
 *
 * Each moving clip has a natural cadence at the current speed — its authored
 * cycle rate scaled by speed / reference speed, clamped so a clip is never
 * slowed to a crawl or sped to a blur. The shared phase advances at the
 * weight-averaged cadence of the moving clips. Idle does not count: it has no
 * stride, and averaging it in would slow the feet as the player starts off.
 */
export function strideRate(
  speed: number,
  weights: Record<LocomotionClip, number>,
  durations: Partial<Record<LocomotionClip, number>>,
): number {
  let rate = 0
  let total = 0
  for (const { clip, speed: reference } of LOCOMOTION_ANCHORS) {
    if (reference <= 0) continue
    const w = weights[clip]
    const duration = durations[clip]
    if (!(w > 0) || !duration || duration <= 0) continue
    const scale = Math.min(1.6, Math.max(0.55, speed / reference))
    rate += w * (scale / duration)
    total += w
  }
  return total > 0 ? rate / total : 0
}

export interface AirInput {
  /** Simulation seconds now. */
  now: number
  grounded: boolean
  /** When the last jump started (seconds), or -Infinity. */
  jumpedAt: number
  /** When the player last touched down (seconds), or -Infinity. */
  landedAt: number
  /** How long the last airborne spell lasted, seconds. */
  lastAirTime: number
  /** When the current airborne spell began, seconds. */
  airborneSince: number
}

export interface AirLayer {
  /** 0..1 of the whole body given to the jump clips. */
  weight: number
  start: number
  loop: number
  land: number
  /** Playback positions, seconds into each clip. */
  startTime: number
  landTime: number
}

/** Seconds into Jump_Start where the feet leave the ground (after the crouch). */
export const JUMP_START_OFFSET = 0.16
/** Jump_Start is played this much faster: our take-off is instant. */
export const JUMP_START_RATE = 1.35
/** How long the take-off pose owns the air before the fall loop takes over. */
export const JUMP_START_HOLD = 0.32
/** Landing recovery length on the body, seconds. */
export const LAND_TIME = 0.42
export const LAND_RATE = 1.5
/** Falls shorter than this land without the recovery clip — kerbs, steps. */
export const MIN_AIR_FOR_LAND = 0.28
/** Walking off a ledge: this long airborne before the fall loop starts. */
export const FALL_DELAY = 0.12

/**
 * The jump layer: take-off, fall loop, and the landing recovery. Weights here
 * are *layer-relative*; the caller scales the locomotion blend by
 * `1 - weight`.
 */
export function airLayer(input: AirInput): AirLayer {
  const out: AirLayer = { weight: 0, start: 0, loop: 0, land: 0, startTime: 0, landTime: 0 }
  if (!input.grounded) {
    const sinceJump = input.now - input.jumpedAt
    const airborne = input.now - input.airborneSince
    const jumped = sinceJump >= 0 && sinceJump < airborne + 0.05
    if (jumped) {
      // Take-off pose, easing into the fall loop.
      const toLoop = Math.max(0, Math.min(1, (sinceJump - JUMP_START_HOLD) / 0.2))
      out.start = 1 - toLoop
      out.loop = toLoop
      out.startTime = JUMP_START_OFFSET + sinceJump * JUMP_START_RATE
      out.weight = Math.min(1, sinceJump / 0.06)
    } else {
      // Stepped off something: a beat of normal gait, then the fall loop.
      const t = Math.max(0, Math.min(1, (airborne - FALL_DELAY) / 0.15))
      out.loop = 1
      out.weight = t
    }
    return out
  }
  const sinceLand = input.now - input.landedAt
  if (input.lastAirTime >= MIN_AIR_FOR_LAND && sinceLand >= 0 && sinceLand < LAND_TIME) {
    out.land = 1
    out.landTime = sinceLand * LAND_RATE
    // Full weight on impact, handing back to the gait over the recovery.
    const fade = sinceLand / LAND_TIME
    out.weight = Math.max(0, 1 - fade * fade)
  }
  return out
}

/** Final per-clip weights: the air layer over the speed blend. Sums to 1. */
export function bodyWeights(speed: number, air: AirLayer): ClipWeights {
  const out = emptyWeights()
  const loco = locomotionWeights(speed)
  const ground = 1 - Math.max(0, Math.min(1, air.weight))
  out.Idle_Loop = loco.Idle_Loop * ground
  out.Walk_Loop = loco.Walk_Loop * ground
  out.Jog_Fwd_Loop = loco.Jog_Fwd_Loop * ground
  out.Sprint_Loop = loco.Sprint_Loop * ground
  const layer = 1 - ground
  const airTotal = air.start + air.loop + air.land
  if (layer > 0 && airTotal > 0) {
    out.Jump_Start = (air.start / airTotal) * layer
    out.Jump_Loop = (air.loop / airTotal) * layer
    out.Jump_Land = (air.land / airTotal) * layer
  } else if (layer > 0) {
    out.Idle_Loop += layer
  }
  return out
}

/** The clip carrying the most weight — for the dataset readout and QA. */
export function dominantClip(weights: ClipWeights): BodyClip {
  let best: BodyClip = 'Idle_Loop'
  let bestWeight = -1
  for (const clip of Object.keys(weights) as BodyClip[]) {
    if (weights[clip] > bestWeight) {
      best = clip
      bestWeight = weights[clip]
    }
  }
  return best
}
