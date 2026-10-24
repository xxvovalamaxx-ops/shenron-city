/**
 * Frame step for the player simulation, with a dev-only fixed-step override.
 *
 * `?simStep=0.1` (dev builds only) makes every rendered frame advance the
 * walker, the camera and the body clips by exactly that many seconds,
 * whatever the wall clock did. The capture harness renders on a CPU
 * rasteriser at a fraction of a frame per second, where the usual 1/20 s cap
 * means a player holding W for fifteen seconds moves a few centimetres; with a
 * fixed step, "hold W for N frames" is a repeatable walk.
 */
export function parseSimStep(search: string, isDev: boolean): number | null {
  if (!isDev) return null
  const raw = new URLSearchParams(search).get('simStep')
  if (raw === null) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.min(0.25, Math.max(0.005, value))
}

const SIM_STEP =
  typeof location === 'undefined' ? null : parseSimStep(location.search, import.meta.env.DEV)

/** The step to integrate this frame: the fixed dev step, or the capped real one. */
export function stepDt(rawDt: number, maxDt: number): number {
  if (SIM_STEP !== null) return SIM_STEP
  return Math.min(Number.isFinite(rawDt) ? Math.max(0, rawDt) : 0, maxDt)
}
