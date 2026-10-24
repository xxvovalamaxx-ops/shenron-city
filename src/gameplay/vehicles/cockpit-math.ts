/**
 * The arithmetic behind the cockpit view: wiper timing, how long ago a blade
 * last cleared a point of the windscreen, and gauge needle angles.
 *
 * The windscreen shader (world/vehicles/Cockpit.tsx) repeats
 * {@link timeSinceWipe} in GLSL; this copy is the tested reference.
 */

/** Wipers stay parked below this rain level. */
export const WIPER_RAIN_ON = 0.05
/** Blade sweep from rest to the top of the stroke, radians. */
export const WIPER_SWEEP = 2.35

/** Seconds per full wipe (up and back): slow in drizzle, fast in a downpour. */
export function wiperPeriod(rain: number): number {
  const r = Math.max(0, Math.min(1, rain))
  return 2.2 - 1.2 * r
}

/** Blade angle at a phase time `p` within one period `T`: 0 at rest, sweep at the top. */
export function wiperAngle(p: number, period: number, sweep = WIPER_SWEEP): number {
  const ph = ((p % period) + period) % period
  return (sweep * (1 - Math.cos((2 * Math.PI * ph) / period))) / 2
}

/**
 * Seconds since the blade last passed angle `phi` (0..sweep), at phase `p`.
 * The blade crosses each angle twice a period: once going up at t1 and once
 * coming down at T - t1.
 */
export function timeSinceWipe(phi: number, p: number, period: number, sweep = WIPER_SWEEP): number {
  const T = period
  const ph = ((p % T) + T) % T
  const c = Math.max(-1, Math.min(1, 1 - (2 * phi) / sweep))
  const t1 = (Math.acos(c) * T) / (2 * Math.PI)
  // A hair of slack so a point the blade is exactly on reads 0, not a period.
  const eps = 1e-9
  if (ph >= T - t1 - eps) return Math.max(0, ph - (T - t1))
  if (ph >= t1 - eps) return Math.max(0, ph - t1)
  return ph + t1
}

/** Needle angle for a dial: `from` at zero, `to` at `max`, clamped. Radians. */
export function gaugeAngle(value: number, max: number, from: number, to: number): number {
  const t = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return from + (to - from) * t
}

/** Steering wheel turn for a front-wheel angle (a ~14:1 rack). */
export const STEERING_RATIO = 14
export function wheelTurn(steerAngle: number): number {
  return steerAngle * STEERING_RATIO * 0.55
}
