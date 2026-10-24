/**
 * Visual suspension: how the body moves on its springs.
 *
 * Purely cosmetic and outside the simulation: roll, pitch and heave are
 * three damped springs driven by the accelerations the (rigid, arcade)
 * vehicle sim produced this frame. Cornering leans the body outward,
 * braking dips the nose and acceleration squats the tail, and the springs
 * overshoot a little before settling — the bounce that sells weight. Heavy
 * vehicles lean less per m/s² but settle slower.
 */

export interface SuspensionState {
  roll: number
  rollVel: number
  pitch: number
  pitchVel: number
  heave: number
  heaveVel: number
  /** Distance travelled, for the road-texture bumps. */
  travelled: number
  /** Seconds simulated, for the burnout buzz. */
  time: number
}

export interface SuspensionInput {
  /** Forward acceleration, m/s² (negative braking). */
  longAccel: number
  /** Lateral acceleration toward the left of the car, m/s² (speed × yaw rate). */
  latAccel: number
  speed: number
  burnout: boolean
  dt: number
  mass: number
}

/** Radians of lean per m/s² of cornering (sedan). */
export const ROLL_PER_ACCEL = 0.0072
/** Radians of pitch per m/s² of braking/acceleration (sedan). */
export const PITCH_PER_ACCEL = 0.0042
export const MAX_ROLL = 0.085
export const MAX_PITCH = 0.06

export function createSuspension(): SuspensionState {
  return { roll: 0, rollVel: 0, pitch: 0, pitchVel: 0, heave: 0, heaveVel: 0, travelled: 0, time: 0 }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function spring(x: number, v: number, target: number, omega: number, zeta: number, dt: number): [number, number] {
  // semi-implicit Euler, sub-stepped for stability at low frame rates
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
  const h = dt / steps
  let px = x
  let pv = v
  for (let i = 0; i < steps; i++) {
    const a = -omega * omega * (px - target) - 2 * zeta * omega * pv
    pv += a * h
    px += pv * h
  }
  return [px, pv]
}

/** Advance the springs one frame; returns the same (mutated) state. */
export function stepSuspension(state: SuspensionState, input: SuspensionInput): SuspensionState {
  const { dt } = input
  if (dt <= 0) return state
  const heavy = clamp(input.mass / 1500, 0.7, 1.8)
  const soft = 1 / Math.sqrt(heavy)
  // Filter spikes (collisions) so a crash is a jolt, not a flip.
  const lat = clamp(input.latAccel, -14, 14)
  const lon = clamp(input.longAccel, -22, 16)
  // A left turn (positive lateral accel) leans the body right: +z rotation
  // lifts the left side.
  const rollTarget = clamp(lat * ROLL_PER_ACCEL * soft, -MAX_ROLL, MAX_ROLL)
  // Braking (negative accel) dips the nose: +x rotation lowers the front.
  const pitchTarget = clamp(-lon * PITCH_PER_ACCEL * soft, -MAX_PITCH, MAX_PITCH)
  const omega = 11 * soft
  ;[state.roll, state.rollVel] = spring(state.roll, state.rollVel, rollTarget, omega, 0.42, dt)
  ;[state.pitch, state.pitchVel] = spring(state.pitch, state.pitchVel, pitchTarget + (input.burnout ? -0.012 : 0), omega * 1.1, 0.45, dt)

  // Road texture: small bumps with distance, a buzz while burning out.
  state.travelled += Math.abs(input.speed) * dt
  state.time += dt
  const d = state.travelled
  const bump = (Math.sin(d * 1.7) * 0.5 + Math.sin(d * 4.3 + 1.1) * 0.3 + Math.sin(d * 9.1 + 2.3) * 0.2) * 0.006 * Math.min(1, Math.abs(input.speed) / 10)
  const buzz = input.burnout ? Math.sin(state.time * 90) * 0.004 : 0
  ;[state.heave, state.heaveVel] = spring(state.heave, state.heaveVel, bump + buzz, omega * 1.3, 0.5, dt)
  // A hard hit kicks the springs.
  if (Math.abs(input.longAccel) > 30) {
    state.pitchVel += clamp(-input.longAccel * 0.0012, -0.35, 0.35)
    state.heaveVel += 0.12
  }
  return state
}
