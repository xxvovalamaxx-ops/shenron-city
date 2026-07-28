/**
 * Match animation playback to ground speed, so feet do not slide.
 *
 * A locomotion clip is authored for one speed: the rate at which the planted
 * foot travels backward exactly as fast as the body travels forward. Play it
 * at any other rate and the foot skates over the ground, which is the single
 * most obvious tell that a character is fake — and one of the defects the
 * project's own quality bar calls out by name.
 *
 * The ambient crowd was playing the Kenney citizen's Run clip at a hardcoded
 * 0.44–0.515 while walking at 0.82–1.26 m/s. The clip wants 1.723 m/s, so the
 * correct rate was 0.476–0.731: the fastest pedestrians were sliding by more
 * than 40%.
 *
 * Measured from the asset rather than guessed. Stepping the Run clip through
 * one cycle and tracking LeftFoot against Hips gives a 0.61 m stride at a
 * 1.75 m character height over a 0.708 s cycle. Stride is stored per unit of
 * body height so the figure survives a change to DEFAULT_CHARACTER_HEIGHT —
 * a taller character covers proportionally more ground per step.
 */

/** Kenney citizen "Run", measured from the shipped GLB. */
export const RUN_CLIP_DURATION = 0.708
/** Stride in body-heights: 0.61 m at a 1.75 m character. */
export const RUN_STRIDE_PER_HEIGHT = 0.61 / 1.75

/**
 * Playback rates outside this look worse than the slide they fix — a clip at
 * 0.15 reads as slow motion, and one at 3 as a twitching blur.
 */
export const MIN_TIME_SCALE = 0.25
export const MAX_TIME_SCALE = 2.2

/**
 * Ground speed a locomotion clip is authored for, at a given body height.
 *
 * A run cycle is two steps, so the body must cover two strides per cycle.
 */
export function clipReferenceSpeed(
  height: number,
  stridePerHeight = RUN_STRIDE_PER_HEIGHT,
  duration = RUN_CLIP_DURATION,
): number {
  if (!Number.isFinite(height) || height <= 0) return 0
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return (2 * stridePerHeight * height) / duration
}

/**
 * Playback rate that plants the feet for `groundSpeed`.
 *
 * Clamped rather than exact at the extremes: a character that has stopped
 * should settle into a slow shuffle instead of freezing mid-stride, which
 * reads as a hung animation rather than as standing still.
 */
export function locomotionTimeScale(groundSpeed: number, height: number): number {
  const reference = clipReferenceSpeed(height)
  if (reference <= 0) return 1
  if (!Number.isFinite(groundSpeed) || groundSpeed <= 0) return MIN_TIME_SCALE

  const exact = groundSpeed / reference
  return Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, exact))
}

/**
 * How far a planted foot slips per second at a given playback rate. Zero is
 * correct; this is what the tests assert against.
 */
export function footSlipRate(
  groundSpeed: number,
  height: number,
  timeScale: number,
): number {
  return Math.abs(groundSpeed - clipReferenceSpeed(height) * timeScale)
}
