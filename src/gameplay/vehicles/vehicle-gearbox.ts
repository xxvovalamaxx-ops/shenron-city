/**
 * A simple automatic gearbox, for the engine note and the HUD's gear and
 * rev readouts. It never feeds back into the driving model — the arcade sim
 * accelerates the same whichever gear is showing — so it can live outside
 * the replay contract. It is still pure: same inputs, same shifts.
 *
 * Each gear covers the speed range up to `tops[g]` at the redline; the
 * engine speed is idle plus the fraction of that range. It shifts up near
 * the redline under power, down when the revs sag, and every shift takes a
 * short beat during which the revs swing to the new gear — that swing is
 * what makes the shift audible.
 */
import type { VehicleSpec } from './vehicle-model'

export interface GearboxSpec {
  /** Road speed at the redline in each forward gear, m/s. */
  tops: number[]
  idleRpm: number
  redlineRpm: number
}

export interface GearboxState {
  /** -1 reverse, 0 neutral, 1..n forward. */
  gear: number
  rpm: number
  /** Seconds left in the current shift. */
  shiftTimer: number
  /** Edge flags for the frame a shift starts (audio). */
  shiftedUp: boolean
  shiftedDown: boolean
}

export const SHIFT_TIME = 0.2
export const UPSHIFT_AT = 0.9
export const DOWNSHIFT_AT = 0.38

export function gearboxFor(spec: VehicleSpec): GearboxSpec {
  const gears = spec.maxForwardSpeed > 50 ? 6 : spec.maxForwardSpeed < 34 ? 4 : 5
  const tops: number[] = []
  for (let g = 1; g <= gears; g++) {
    // Short low gears, long top gear: a gentle geometric spread.
    const t = Math.pow(g / gears, 0.82)
    tops.push(spec.maxForwardSpeed * 1.04 * t)
  }
  const sporty = spec.maxForwardSpeed > 50
  return {
    tops,
    idleRpm: 850,
    redlineRpm: sporty ? 7400 : spec.mass > 2000 ? 5200 : 6400,
  }
}

export function initialGearbox(spec: GearboxSpec): GearboxState {
  return { gear: 1, rpm: spec.idleRpm, shiftTimer: 0, shiftedUp: false, shiftedDown: false }
}

function rpmFor(spec: GearboxSpec, gear: number, speed: number): number {
  const top = gear < 0 ? spec.tops[0] * 0.8 : spec.tops[Math.max(0, gear - 1)]
  return spec.idleRpm + (Math.abs(speed) / top) * (spec.redlineRpm - spec.idleRpm)
}

/**
 * Advance the gearbox. `speed` is the signed road speed, `throttle` 0..1.
 */
export function stepGearbox(
  state: GearboxState,
  spec: GearboxSpec,
  speed: number,
  throttle: number,
  dt: number,
): GearboxState {
  let { gear, shiftTimer } = state
  let shiftedUp = false
  let shiftedDown = false
  const n = spec.tops.length

  if (speed < -0.3) {
    gear = -1
  } else if (gear <= 0 && speed >= -0.05) {
    gear = 1
  }

  if (shiftTimer > 0) {
    shiftTimer = Math.max(0, shiftTimer - dt)
  } else if (gear >= 1) {
    const r = (rpmFor(spec, gear, speed) - spec.idleRpm) / (spec.redlineRpm - spec.idleRpm)
    if (gear < n && r > UPSHIFT_AT && throttle > 0.05) {
      gear += 1
      shiftTimer = SHIFT_TIME
      shiftedUp = true
    } else if (gear > 1) {
      const below = (rpmFor(spec, gear - 1, speed) - spec.idleRpm) / (spec.redlineRpm - spec.idleRpm)
      // Drop a gear when the revs sag and the lower gear has room.
      if (r < DOWNSHIFT_AT && below < UPSHIFT_AT * 0.85) {
        gear -= 1
        shiftTimer = SHIFT_TIME * 0.8
        shiftedDown = true
      }
    }
  }

  // Engine speed: road-locked in gear, free-revving with the clutch in at a
  // standstill, and swinging toward the new gear during a shift.
  let target = rpmFor(spec, gear, speed)
  if (Math.abs(speed) < 1.5 && gear >= 1) {
    target = Math.max(target, spec.idleRpm + throttle * (spec.redlineRpm - spec.idleRpm) * 0.45)
  }
  target = Math.min(spec.redlineRpm, Math.max(spec.idleRpm, target))
  const rate = shiftTimer > 0 ? 14 : 22
  const rpm = state.rpm + (target - state.rpm) * (1 - Math.exp(-rate * Math.max(0, dt)))

  return { gear, rpm, shiftTimer, shiftedUp, shiftedDown }
}

/** Normalised revs 0 (idle) … 1 (redline). */
export function revFraction(spec: GearboxSpec, state: GearboxState): number {
  return Math.min(1, Math.max(0, (state.rpm - spec.idleRpm) / (spec.redlineRpm - spec.idleRpm)))
}

/** 'R', 'N' or the gear number, as the HUD shows it. */
export function gearLabel(gear: number): string {
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(gear)
}
