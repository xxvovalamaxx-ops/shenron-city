/**
 * Ambience maths, with no Web Audio in it.
 *
 * Everything here is pure and renderer-free, so the decisions that actually
 * shape how the city sounds — which bed applies where, how a crossfade is
 * weighted, how far a door has to be before you stop hearing it — are testable
 * under node, where `AudioContext` does not exist. `engine.ts` is the only file
 * that touches the browser API and is deliberately a thin shell over this one.
 *
 * Zone bounds are borrowed rather than invented. The lobby, shaft and floor
 * plate derive from `src/world/layout.ts`; the market volume and the two
 * interior insets are the ones `cityTourLocationEvents` already uses in
 * `src/gameplay/city-tour.ts`. Authoring a second set of bounds here would
 * guarantee that the sound and the walls drift apart the first time a wall
 * moves.
 *
 * Units are metres and seconds, matching the rest of the simulation.
 */
import type { Vec3 } from '../gameplay/collision'
import { ENTRANCE, HQ, LOBBY, SHAFT } from '../world/layout'

// ── Zones ────────────────────────────────────────────────────────────────────

export type ZoneId = 'boulevard' | 'market' | 'park' | 'lobby' | 'hq'

/** Iteration order. `boulevard` is first so it also wins a dominance tie. */
export const ZONE_IDS: readonly ZoneId[] = ['boulevard', 'market', 'park', 'lobby', 'hq']

/** A weight, gain or share per zone. Weights from `zoneWeights` sum to 1. */
export type ZoneMix = Record<ZoneId, number>

interface Box {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

interface ZoneShape {
  /** Union of boxes; inside any one of them is fully inside the zone. */
  boxes: readonly Box[]
  /** Metres over which membership falls from 1 to 0 outside those boxes. */
  feather: number
}

function box(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
): Box {
  return { minX, maxX, minY, maxY, minZ, maxZ }
}

/** Ground level is a touch below zero so a player standing on it is inside. */
const FLOOR = -1

/**
 * Everywhere except the boulevard, which is the fallback bed.
 *
 * Feathers are wider outdoors than indoors on purpose: in open air a district
 * fades in over several metres, whereas a wall is meant to be an abrupt-ish
 * change you can still walk through without a click.
 */
const ZONE_SHAPES: Record<Exclude<ZoneId, 'boulevard'>, ZoneShape> = {
  // Stall row on the east side of Dragon Boulevard, as authored for the tour.
  market: { boxes: [box(9, 20, FLOOR, 4, 71, 107)], feather: 7 },
  // The green pocket slab laid down by CityDistrict at (-20, 49), 15.5 x 20 m.
  park: { boxes: [box(-27.75, -12.25, FLOOR, 5, 39, 59)], feather: 7 },
  lobby: {
    boxes: [
      box(
        -(LOBBY.halfWidth - 0.5),
        LOBBY.halfWidth - 0.5,
        FLOOR,
        8,
        LOBBY.backZ + 0.5,
        LOBBY.frontZ - 0.5,
      ),
      // The shaft column. Without it a rider hears open-street traffic at floor
      // 30, because the car sits behind the lobby's back wall and 180 m of
      // travel passes through no authored volume at all.
      box(-SHAFT.halfWidth, SHAFT.halfWidth, FLOOR, HQ.y - 0.5, SHAFT.backZ, SHAFT.doorZ),
    ],
    feather: 3,
  },
  hq: {
    boxes: [
      box(
        -(HQ.halfWidth - 0.2),
        HQ.halfWidth - 0.2,
        HQ.y - 0.5,
        HQ.y + HQ.ceiling,
        HQ.backZ + 0.2,
        HQ.frontZ - 0.2,
      ),
    ],
    feather: 4,
  },
}

function distanceOutside(p: Vec3, b: Box): number {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX)
  const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY)
  const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function membership(p: Vec3, shape: ZoneShape): number {
  let nearest = Infinity
  for (const b of shape.boxes) nearest = Math.min(nearest, distanceOutside(p, b))
  return smoothstep(1 - nearest / shape.feather)
}

/**
 * How much each ambience bed applies at a world position. Always sums to 1.
 *
 * The boulevard is the base bed rather than a shape: it is whatever is left
 * once the named districts and interiors have taken their share, which is what
 * makes the whole city covered without authoring an outdoor volume the size of
 * the map.
 */
export function zoneWeights(p: Vec3): ZoneMix {
  const raw: ZoneMix = { boulevard: 0, market: 0, park: 0, lobby: 0, hq: 0 }

  let strongest = 0
  for (const id of ZONE_IDS) {
    if (id === 'boulevard') continue
    const m = membership(p, ZONE_SHAPES[id])
    raw[id] = m
    if (m > strongest) strongest = m
  }
  raw.boulevard = 1 - strongest

  let total = 0
  for (const id of ZONE_IDS) total += raw[id]
  if (total <= 0) return { boulevard: 1, market: 0, park: 0, lobby: 0, hq: 0 }

  const out: ZoneMix = { boulevard: 0, market: 0, park: 0, lobby: 0, hq: 0 }
  for (const id of ZONE_IDS) out[id] = raw[id] / total
  return out
}

/**
 * Amplitudes for a constant-power crossfade between the beds.
 *
 * The beds are uncorrelated noise, so their powers add rather than their
 * amplitudes. Fading them linearly dips ~3 dB in the middle of every
 * transition and you hear the city get quiet in every doorway; taking the root
 * keeps the sum of squares at 1 throughout.
 */
export function zoneGains(mix: ZoneMix): ZoneMix {
  return {
    boulevard: Math.sqrt(Math.max(0, mix.boulevard)),
    market: Math.sqrt(Math.max(0, mix.market)),
    park: Math.sqrt(Math.max(0, mix.park)),
    lobby: Math.sqrt(Math.max(0, mix.lobby)),
    hq: Math.sqrt(Math.max(0, mix.hq)),
  }
}

export function dominantZone(mix: ZoneMix): ZoneId {
  let best: ZoneId = 'boulevard'
  let bestWeight = -Infinity
  for (const id of ZONE_IDS) {
    if (mix[id] > bestWeight) {
      best = id
      bestWeight = mix[id]
    }
  }
  return best
}

/** 0 fully outdoors, 1 fully enclosed. Drives reverb and the muffling filter. */
export function interiorAmount(mix: ZoneMix): number {
  return clamp01(mix.lobby + mix.hq)
}

// ── Room character ───────────────────────────────────────────────────────────

export interface RoomTone {
  /** Convolution send for positional sounds, 0 to 1. */
  reverbSend: number
  /** Low-pass on the ambience bed sum. Walls eat the top end. */
  bedCutoffHz: number
  /** Low-pass on the reverb return. A dark tail reads as a small dead room. */
  wetCutoffHz: number
}

/**
 * Interiors differ from exteriors by reverb and filtering, not by level.
 *
 * Turning the street down when you walk indoors is the cheap version and it
 * always sounds like a mute rather than a building. Floor 45 is drier *and*
 * darker than the lobby: same convolver, but a short-sounding tail.
 */
export const ZONE_ROOM: Record<ZoneId, RoomTone> = {
  boulevard: { reverbSend: 0.05, bedCutoffHz: 18000, wetCutoffHz: 5200 },
  market: { reverbSend: 0.09, bedCutoffHz: 16000, wetCutoffHz: 4200 },
  park: { reverbSend: 0.04, bedCutoffHz: 18000, wetCutoffHz: 6000 },
  lobby: { reverbSend: 0.42, bedCutoffHz: 2200, wetCutoffHz: 3200 },
  hq: { reverbSend: 0.16, bedCutoffHz: 1400, wetCutoffHz: 900 },
}

/**
 * Blend the room parameters for a given mix.
 *
 * Cutoffs are blended in the log domain. Interpolating 18 kHz to 1.4 kHz
 * linearly spends most of the walk through the door still sounding outdoors and
 * then collapses at the end; a geometric mean moves at a constant number of
 * octaves per metre, which is what the ear measures.
 */
export function blendRoom(mix: ZoneMix): RoomTone {
  let total = 0
  for (const id of ZONE_IDS) total += Math.max(0, mix[id])
  if (total <= 0) return ZONE_ROOM.boulevard

  let send = 0
  let bedLog = 0
  let wetLog = 0
  for (const id of ZONE_IDS) {
    const w = Math.max(0, mix[id]) / total
    if (w <= 0) continue
    const room = ZONE_ROOM[id]
    send += w * room.reverbSend
    bedLog += w * Math.log(room.bedCutoffHz)
    wetLog += w * Math.log(room.wetCutoffHz)
  }

  return {
    reverbSend: send,
    bedCutoffHz: Math.exp(bedLog),
    wetCutoffHz: Math.exp(wetLog),
  }
}

// ── Ambience beds ────────────────────────────────────────────────────────────

/** Local aliases so this file never names a Web Audio type. */
export type BedFilter = 'lowpass' | 'bandpass' | 'highpass'
export type BedWave = 'sine' | 'triangle' | 'sawtooth'

export interface NoiseVoice {
  kind: 'noise'
  filter: BedFilter
  hz: number
  q: number
  gain: number
  /** Depth in Hz of the slow drift applied to `hz`. 0 disables it. */
  driftHz: number
  /** Rate of that drift, in Hz. Well below 1 — this is weather, not tremolo. */
  driftRate: number
}

export interface ToneVoice {
  kind: 'tone'
  wave: BedWave
  hz: number
  gain: number
  /** Offset of a second partial. The beating is what reads as machinery. */
  beatHz: number
}

export type BedVoice = NoiseVoice | ToneVoice

/**
 * The five beds, as data.
 *
 * Every bed runs continuously and is crossfaded by gain alone, so no bed can
 * start or stop mid-transition and click. Five beds of two or three voices is
 * roughly sixty always-live nodes, which is nothing next to one frame of
 * three.js — and `setEnabled(false)` suspends the context outright rather than
 * leaving them running at zero.
 */
export const BED_VOICES: Record<ZoneId, readonly BedVoice[]> = {
  boulevard: [
    { kind: 'noise', filter: 'lowpass', hz: 260, q: 0.7, gain: 0.34, driftHz: 40, driftRate: 0.043 },
    { kind: 'noise', filter: 'bandpass', hz: 850, q: 0.5, gain: 0.075, driftHz: 300, driftRate: 0.071 },
    { kind: 'tone', wave: 'sine', hz: 55, gain: 0.022, beatHz: 0.7 },
  ],
  market: [
    { kind: 'noise', filter: 'bandpass', hz: 520, q: 0.45, gain: 0.24, driftHz: 130, driftRate: 0.13 },
    { kind: 'noise', filter: 'bandpass', hz: 1500, q: 0.8, gain: 0.075, driftHz: 400, driftRate: 0.19 },
    { kind: 'noise', filter: 'lowpass', hz: 200, q: 0.7, gain: 0.13, driftHz: 20, driftRate: 0.05 },
    { kind: 'tone', wave: 'triangle', hz: 98, gain: 0.03, beatHz: 0.5 },
  ],
  park: [
    { kind: 'noise', filter: 'lowpass', hz: 220, q: 0.7, gain: 0.075, driftHz: 30, driftRate: 0.037 },
    { kind: 'noise', filter: 'bandpass', hz: 3200, q: 0.6, gain: 0.03, driftHz: 900, driftRate: 0.09 },
  ],
  lobby: [
    { kind: 'noise', filter: 'lowpass', hz: 150, q: 0.6, gain: 0.2, driftHz: 12, driftRate: 0.031 },
    { kind: 'noise', filter: 'bandpass', hz: 420, q: 0.9, gain: 0.035, driftHz: 60, driftRate: 0.053 },
    { kind: 'tone', wave: 'sine', hz: 112, gain: 0.028, beatHz: 0.35 },
  ],
  hq: [
    { kind: 'noise', filter: 'highpass', hz: 2600, q: 0.5, gain: 0.014, driftHz: 300, driftRate: 0.07 },
    { kind: 'tone', wave: 'sine', hz: 231, gain: 0.016, beatHz: 1.3 },
    { kind: 'tone', wave: 'triangle', hz: 77, gain: 0.01, beatHz: 0.4 },
  ],
}

/** Headroom for the summed beds, leaving the one-shots room to land on top. */
export const BED_BUS_LEVEL = 0.55

// ── Listener and positional sources ──────────────────────────────────────────

export interface ListenerPose {
  pos: Vec3
  /** Camera forward on the ground plane, normalised. Shape of `rt.player`. */
  forward: { x: number; z: number }
}

export interface PlayerPose extends ListenerPose {
  grounded: boolean
}

export interface SourcePlacement {
  /** Amplitude 0 to 1, before the source's own level. */
  gain: number
  /** Stereo panner position, -1 hard left to 1 hard right. */
  pan: number
}

/** Inside this radius a source is at full level. Roughly "in the same room". */
export const REFERENCE_DISTANCE = 3
/** Beyond this a source is silent and not worth building a voice for. */
export const MAX_DISTANCE = 90
export const ROLLOFF = 1
/**
 * A source closer than this has no meaningful direction.
 *
 * Without it, a footstep at your own feet picks up whatever sign the rounding
 * error lands on and the world lurches left and right as you turn.
 */
const NEAR_FIELD = 1.2

/**
 * Distance attenuation and panning for one source, relative to the listener.
 *
 * Inverse-distance, the same curve a PannerNode would use, but computed here so
 * it can be tested and so a one-shot that is out of earshot never allocates
 * nodes at all. The final quarter is tapered to zero: an inverse curve is still
 * at about -30 dB when it hits the cutoff, and cutting there ticks.
 */
export function placeSource(source: Vec3, listener: ListenerPose): SourcePlacement {
  const dx = source.x - listener.pos.x
  const dy = source.y - listener.pos.y
  const dz = source.z - listener.pos.z
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

  if (distance >= MAX_DISTANCE) return { gain: 0, pan: 0 }

  const inverse =
    REFERENCE_DISTANCE /
    (REFERENCE_DISTANCE + ROLLOFF * Math.max(0, distance - REFERENCE_DISTANCE))
  const taper = clamp01((MAX_DISTANCE - distance) / (MAX_DISTANCE * 0.25))

  const flen = Math.hypot(listener.forward.x, listener.forward.z) || 1
  // Right-hand vector on the ground plane, matching GameLoop's movement basis.
  const rx = -listener.forward.z / flen
  const rz = listener.forward.x / flen

  const horizontal = Math.hypot(dx, dz)
  const side = horizontal < 1e-4 ? 0 : (dx * rx + dz * rz) / horizontal
  const spread = horizontal / (horizontal + NEAR_FIELD)

  return {
    gain: clamp01(inverse * taper),
    pan: Math.max(-1, Math.min(1, side * spread)),
  }
}

/**
 * Fader position to amplitude.
 *
 * A linear master fader puts every useful setting in its top fifth and the
 * bottom half of the slider does nothing audible. Squaring restores a taper you
 * can actually mix with.
 */
export function masterGain(volume: number): number {
  const v = clamp01(volume)
  return v * v
}

// ── Footsteps ────────────────────────────────────────────────────────────────

/**
 * Metres per footfall.
 *
 * Cadence is driven by distance, not by a timer: tying steps to a fixed
 * interval makes walking and sprinting sound identical, and tying them to
 * frames machine-guns on a fast machine. At walk (4.3 m/s) this is about three
 * steps a second, at sprint (7.1 m/s) about five.
 */
export const STRIDE_LENGTH = 1.5
/**
 * Hard floor on the gap between two steps.
 *
 * The stride accumulator is the real mechanism; this only catches the
 * pathological cases — a frame hitch, or `resetPlayer` moving the player a
 * hundred metres between two samples.
 */
export const MIN_STEP_INTERVAL = 0.19
/** Below this the player is shuffling against a wall, not walking. */
export const MIN_STEP_SPEED = 0.4
/** Speeds above this are a teleport, not locomotion. */
export const MAX_TRACKED_SPEED = 9

export interface FootstepState {
  /** Metres walked since the last footfall. */
  stride: number
  /** Seconds since the last footfall. */
  since: number
}

/**
 * Start part-way through a stride so the first step lands almost immediately
 * on moving off, rather than a metre and a half later.
 */
export const initialFootsteps = (): FootstepState => ({
  stride: STRIDE_LENGTH * 0.65,
  since: MIN_STEP_INTERVAL,
})

export function advanceFootsteps(
  state: FootstepState,
  speed: number,
  dt: number,
  grounded: boolean,
): { state: FootstepState; fired: boolean } {
  const since = state.since + dt

  if (!grounded || speed < MIN_STEP_SPEED) {
    // Reset the accumulator rather than banking it, or stopping and starting
    // fires a step the instant you touch a key again.
    return { state: { stride: STRIDE_LENGTH * 0.65, since }, fired: false }
  }

  const tracked = Math.min(speed, MAX_TRACKED_SPEED)
  const stride = Math.min(state.stride + tracked * dt, STRIDE_LENGTH * 2)

  if (stride < STRIDE_LENGTH || since < MIN_STEP_INTERVAL) {
    return { state: { stride, since }, fired: false }
  }
  return { state: { stride: 0, since: 0 }, fired: true }
}

export interface FootstepVoice {
  /** Multiplier on the step's frequencies. */
  pitch: number
  /** Multiplier on its level. */
  gain: number
}

/**
 * Per-step variation.
 *
 * Identical samples repeated three times a second are the single most obvious
 * tell that footsteps are synthetic. `random` is injectable so the spread can
 * be tested at its bounds.
 */
export function footstepVoice(random: () => number = Math.random): FootstepVoice {
  const p = random()
  const g = random()
  return { pitch: 0.9 + p * 0.22, gain: 0.72 + g * 0.28 }
}

// ── One-shots ────────────────────────────────────────────────────────────────

/** What the integrator can trigger. */
export type AudioEvent =
  | 'doorOpen'
  | 'doorClose'
  | 'elevatorStart'
  | 'elevatorStop'
  | 'elevatorArrive'
  | 'footstep'

/**
 * The voices behind those events.
 *
 * `elevatorStart` and `elevatorStop` are not in here: a seven-second ride needs
 * a sustained motor, so they ramp `MOTOR` instead. `elevatorSettle` is the
 * thunk the stop ramp leaves behind, and is not triggerable on its own.
 */
export type ShotId = 'doorOpen' | 'doorClose' | 'elevatorArrive' | 'elevatorSettle' | 'footstep'

export interface ShotPartial {
  hz: number
  level: number
  /** Seconds after the trigger that this partial is struck. */
  delay: number
  /** Seconds from strike to silence. */
  decay: number
}

export interface OneShotSpec {
  /** Peak amplitude before distance attenuation. */
  level: number
  /** Seconds to peak. */
  attack: number
  /** Seconds from trigger to teardown. Every layer is silent by then. */
  duration: number
  /** Filtered noise layer, swept from `fromHz` to `toHz` across `duration`. */
  noise: { filter: BedFilter; fromHz: number; toHz: number; q: number; level: number } | null
  /** Tonal layer. `fromHz === toHz` for a steady note. */
  tone: { wave: BedWave; fromHz: number; toHz: number; level: number } | null
  /** Struck partials, for bells and late mechanical knocks. */
  partials: readonly ShotPartial[]
}

export const ONE_SHOTS: Record<ShotId, OneShotSpec> = {
  // Glass leaves parting: a rising rush that runs out of energy at the end of
  // travel, over the soft thump of the mechanism taking up slack.
  doorOpen: {
    level: 0.5,
    attack: 0.03,
    duration: 0.9,
    noise: { filter: 'bandpass', fromHz: 240, toHz: 1400, q: 1.2, level: 0.55 },
    tone: { wave: 'sine', fromHz: 60, toHz: 84, level: 0.16 },
    partials: [],
  },
  // The mirror of it, finished by the latch rather than by fading out.
  doorClose: {
    level: 0.5,
    attack: 0.03,
    duration: 0.95,
    noise: { filter: 'bandpass', fromHz: 1300, toHz: 200, q: 1.2, level: 0.5 },
    tone: { wave: 'sine', fromHz: 84, toHz: 52, level: 0.18 },
    partials: [{ hz: 150, level: 0.28, delay: 0.72, decay: 0.18 }],
  },
  // Two-note lift bell. Slightly inharmonic upper partials keep it from
  // sounding like a test tone.
  elevatorArrive: {
    level: 0.5,
    attack: 0.004,
    duration: 2.4,
    noise: null,
    tone: { wave: 'sine', fromHz: 987.77, toHz: 987.77, level: 0.34 },
    partials: [
      { hz: 1975.5, level: 0.06, delay: 0, decay: 0.6 },
      { hz: 1318.51, level: 0.3, delay: 0.42, decay: 1.5 },
      { hz: 2635.02, level: 0.05, delay: 0.42, decay: 0.7 },
    ],
  },
  // The car sitting down on its guides once the motor has spun off.
  elevatorSettle: {
    level: 0.4,
    attack: 0.006,
    duration: 0.7,
    noise: { filter: 'lowpass', fromHz: 400, toHz: 120, q: 0.8, level: 0.3 },
    tone: { wave: 'sine', fromHz: 96, toHz: 74, level: 0.3 },
    partials: [],
  },
  footstep: {
    level: 0.34,
    attack: 0.004,
    duration: 0.26,
    noise: { filter: 'bandpass', fromHz: 420, toHz: 190, q: 1.1, level: 0.5 },
    tone: { wave: 'sine', fromHz: 78, toHz: 58, level: 0.22 },
    partials: [],
  },
}

export interface MotorSpec {
  wave: BedWave
  /** Pitch at rest and under load. The ramp between them is the spool-up. */
  idleHz: number
  runHz: number
  level: number
  /** Low-passed noise over the tone, so it is a machine and not an organ. */
  noiseIdleHz: number
  noiseRunHz: number
  noiseQ: number
  noiseLevel: number
  rampUp: number
  rampDown: number
}

/** Sustained while the car is in the shaft. `TRAVEL_TIME` is seven seconds. */
export const MOTOR: MotorSpec = {
  wave: 'sawtooth',
  idleHz: 38,
  runHz: 61,
  level: 0.34,
  noiseIdleHz: 120,
  noiseRunHz: 300,
  noiseQ: 0.7,
  noiseLevel: 0.3,
  rampUp: 0.9,
  rampDown: 1.1,
}

/**
 * Exponential ramps cannot reach zero, so this is the floor everything decays
 * to. Low enough to be silent at any sane master level.
 */
export const SILENCE = 0.0001

/**
 * Where the world's own sounds come from, so the integrator does not have to
 * re-derive the geometry it already has.
 */
export const AUDIO_ANCHORS = {
  entranceDoor: { x: 0, y: 1.6, z: ENTRANCE.z } as Vec3,
  /** The car doors travel with the car, so this needs the current car height. */
  elevatorDoor: (carY: number): Vec3 => ({ x: 0, y: carY + 1.6, z: SHAFT.doorZ }),
} as const

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Smoothstep, so a crossfade has no corner at either end of the feather. */
function smoothstep(t: number): number {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}
