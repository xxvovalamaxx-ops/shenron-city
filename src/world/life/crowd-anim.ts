/**
 * Frame math for the baked crowd animation.
 *
 * Every clip is sampled at a fixed rate into consecutive rows of one bone
 * texture per body (see crowd-renderer.ts). A pedestrian's pose is then just
 * two row indices and a blend weight, written per instance each frame:
 *
 *   aAnim = (rowA, rowB, w, prop)
 *
 * Within a clip rowA/rowB are neighbouring frames and w is the fraction
 * between them. During a clip change rowA is the old clip's frame, rowB the
 * new one's and w the crossfade — the shader does not care which it is.
 *
 * Pure functions, no three.js, unit tested in crowd-anim.test.ts.
 */

export const BAKE_FPS = 30

export interface ClipInfo {
  name: string
  /** First row in the bone texture. */
  start: number
  /** Distinct sampled frames; a looping clip does not repeat frame 0. */
  frames: number
  duration: number
  loop: boolean
}

export interface ClipLayout {
  clips: Record<string, ClipInfo>
  rows: number
}

/** Rows needed for a clip of `duration` seconds. */
export function framesFor(duration: number, loop: boolean, fps = BAKE_FPS): number {
  const n = Math.max(1, Math.round(duration * fps))
  // A one-shot clip keeps its last frame; a loop's last frame IS frame 0.
  return loop ? n : n + 1
}

/** Stack clips into the rows of one texture, in the given order. */
export function layoutClips(
  list: ReadonlyArray<{ name: string; duration: number; loop?: boolean }>,
  fps = BAKE_FPS,
): ClipLayout {
  const clips: Record<string, ClipInfo> = {}
  let rows = 0
  for (const c of list) {
    const loop = c.loop !== false
    const frames = framesFor(c.duration, loop, fps)
    clips[c.name] = { name: c.name, start: rows, frames, duration: c.duration, loop }
    rows += frames
  }
  return { clips, rows }
}

export interface RowSample {
  a: number
  b: number
  w: number
}

/**
 * Rows bracketing normalised clip time `phase` (cycles; 1 = one full clip).
 * Loops wrap, one-shots clamp to their final frame.
 */
export function sampleRows(clip: ClipInfo, phase: number, out: RowSample = { a: 0, b: 0, w: 0 }): RowSample {
  if (clip.loop) {
    const p = phase - Math.floor(phase)
    const pos = p * clip.frames
    const i = Math.floor(pos) % clip.frames
    out.a = clip.start + i
    out.b = clip.start + ((i + 1) % clip.frames)
    out.w = pos - Math.floor(pos)
  } else {
    const last = clip.frames - 1
    const pos = Math.min(Math.max(phase, 0), 1) * last
    const i = Math.min(last, Math.floor(pos))
    out.a = clip.start + i
    out.b = clip.start + Math.min(last, i + 1)
    out.w = pos - i
  }
  return out
}

/** Nearest single row, used on each side of a crossfade. */
export function nearestRow(clip: ClipInfo, phase: number): number {
  const s = sampleRows(clip, phase, { a: 0, b: 0, w: 0 })
  return s.w < 0.5 ? s.a : s.b
}

export interface AnimState {
  clip: string
  /** Cycles into the current clip. */
  phase: number
  /** Clip being faded out, if any. */
  prev: string | null
  prevPhase: number
  /** Remaining crossfade, 1 → 0. */
  fade: number
}

export const FADE_SECONDS = 0.3

export function newAnimState(clip: string, phase = 0): AnimState {
  return { clip, phase, prev: null, prevPhase: 0, fade: 0 }
}

/** Switch clip with a short crossfade; a no-op when already playing it. */
export function playClip(s: AnimState, clip: string, phase = 0): void {
  if (s.clip === clip) return
  s.prev = s.clip
  s.prevPhase = s.phase
  s.clip = clip
  s.phase = phase
  s.fade = 1
}

/**
 * Advance by `dt` seconds. `rate` is cycles per second for the current clip,
 * so a walker's legs keep time with their actual ground speed. The fading-out
 * clip is frozen: a 0.3 s fade is too short to see it stop.
 */
export function stepAnim(s: AnimState, dt: number, rate: number): void {
  s.phase += dt * rate
  if (s.phase > 1e4) s.phase -= Math.floor(s.phase)
  if (s.fade > 0) {
    s.fade = Math.max(0, s.fade - dt / FADE_SECONDS)
    if (s.fade === 0) s.prev = null
  }
}

/** The per-instance (rowA, rowB, w) for a state. */
export function animRows(
  s: AnimState,
  clips: Record<string, ClipInfo>,
  out: RowSample = { a: 0, b: 0, w: 0 },
): RowSample {
  const cur = clips[s.clip]
  if (!cur) {
    out.a = out.b = 0
    out.w = 0
    return out
  }
  const prev = s.prev ? clips[s.prev] : undefined
  if (prev && s.fade > 0) {
    out.a = nearestRow(prev, s.prevPhase)
    out.b = nearestRow(cur, s.phase)
    // smoothstep so the fade has no velocity kink at either end
    const t = 1 - s.fade
    out.w = t * t * (3 - 2 * t)
    return out
  }
  return sampleRows(cur, s.phase, out)
}

/**
 * Walk-cycle playback rate. `cycleMetres` is how far the source body travels
 * in one full clip at its authored cadence; a person scaled down by `scale`
 * covers proportionally less ground per cycle, so short people take more
 * steps at the same speed, as they do.
 */
export function cycleRate(speed: number, cycleMetres: number, scale = 1): number {
  const per = Math.max(0.05, cycleMetres * scale)
  return Math.max(0, speed) / per
}

/**
 * Ground distance per cycle, measured from a foot's forward position over one
 * loop of the walk: the foot drifts backward relative to the hips while it is
 * planted. `z` is the foot's forward coordinate per frame.
 */
export function strideFromFoot(z: ArrayLike<number>): number {
  const n = z.length
  if (n < 3) return 0
  let back = 0
  let backFrames = 0
  for (let i = 0; i < n; i++) {
    const d = z[(i + 1) % n] - z[i]
    if (d < 0) {
      back -= d
      backFrames++
    }
  }
  if (!backFrames) return 0
  // Speed while planted times the cycle time: the body moves at the planted
  // foot's backward speed, for the whole cycle.
  const perFrame = back / backFrames
  return perFrame * n
}
