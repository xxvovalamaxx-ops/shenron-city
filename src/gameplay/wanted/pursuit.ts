/**
 * Police pursuit driving: turns "where is the suspect" into pedal and wheel
 * input for the arcade vehicle model.
 *
 * Pure and deterministic. The caller owns routing: when the suspect is out of
 * sight or a building is in the way, it passes the next road waypoint as the
 * `goal`; with a clear line it passes the suspect itself. This module then
 * handles the driving: lead the target (aim where it will be, not where it
 * is), brake into corners the car cannot take at speed, ram when close, and
 * back out when wedged against a wall.
 */
import type { VehicleInput } from '../vehicles/vehicle-model'
import type { Vec2 } from './wanted'

export interface PursuitTarget {
  pos: Vec2
  /** Suspect velocity on the ground plane, m/s. */
  vel: Vec2
}

export interface PursuitCar {
  pos: Vec2
  heading: number
  /** Signed forward speed, m/s. */
  speed: number
}

export interface PursuitMemory {
  /** Seconds the car has been pushing without moving. */
  stuckFor: number
  /** Seconds left of the reverse-out manoeuvre. */
  reverseFor: number
}

export function createPursuitMemory(): PursuitMemory {
  return { stuckFor: 0, reverseFor: 0 }
}

/** Seconds of lead: how far ahead of the suspect the cruiser aims. */
export const MAX_LEAD_TIME = 1.6
/** Below this distance the cruiser commits to a ram. */
export const RAM_DISTANCE = 12
/** Top speed a pursuit will attempt, m/s (≈ 137 km/h). */
export const PURSUIT_TOP_SPEED = 38
/** Pushing this long below STUCK_SPEED means wedged. */
export const STUCK_TIME = 1.2
export const STUCK_SPEED = 0.8
/** How long the reverse-out lasts. */
export const REVERSE_TIME = 1.1

function wrapAngle(a: number): number {
  let x = a
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Where to aim: the target's position led by its velocity. */
export function interceptPoint(car: PursuitCar, target: PursuitTarget): Vec2 {
  const dx = target.pos.x - car.pos.x
  const dz = target.pos.z - car.pos.z
  const distance = Math.hypot(dx, dz)
  const closing = Math.max(8, Math.abs(car.speed))
  const lead = Math.min(MAX_LEAD_TIME, distance / closing)
  return { x: target.pos.x + target.vel.x * lead, z: target.pos.z + target.vel.z * lead }
}

export interface PursuitResult {
  input: VehicleInput
  memory: PursuitMemory
}

/**
 * One step of pursuit driving toward `goal` (a road waypoint or the suspect),
 * with `target` used for ramming decisions and lead.
 */
export function pursuitInput(
  car: PursuitCar,
  goal: Vec2,
  target: PursuitTarget,
  memory: PursuitMemory,
  dt: number,
): PursuitResult {
  // Reverse-out: back up with the wheel opposite to where we want to go, so
  // the nose swings toward the goal as the car rolls backwards.
  if (memory.reverseFor > 0) {
    const desired = Math.atan2(goal.x - car.pos.x, goal.z - car.pos.z)
    const error = wrapAngle(desired - car.heading)
    return {
      input: { throttle: 0, brake: 1, steer: -Math.sign(error) || 1, handbrake: false },
      memory: { stuckFor: 0, reverseFor: Math.max(0, memory.reverseFor - dt) },
    }
  }

  const toTarget = Math.hypot(target.pos.x - car.pos.x, target.pos.z - car.pos.z)
  const ramming = toTarget < RAM_DISTANCE
  const aim = ramming ? interceptPoint(car, target) : goal
  const desired = Math.atan2(aim.x - car.pos.x, aim.z - car.pos.z)
  const error = wrapAngle(desired - car.heading)
  const absError = Math.abs(error)

  // Proportional steering, saturating at about 35° of heading error.
  const steer = clamp(error * 1.65, -1, 1)

  // Corner speed: a car pointed the wrong way has no business at full chat.
  const cornerLimit = absError > 1.9 ? 6 : absError > 1.0 ? 11 : absError > 0.45 ? 20 : PURSUIT_TOP_SPEED
  const wanted = ramming ? Math.min(cornerLimit, 22) : cornerLimit
  let throttle = 0
  let brake = 0
  if (car.speed < wanted - 1) throttle = 1
  else if (car.speed > wanted + 3) brake = clamp((car.speed - wanted) / 10, 0.2, 1)
  else throttle = 0.35

  // Nearly backwards and slow: a hard handbrake turn is how cruisers flip round.
  const handbrake = absError > 2.2 && car.speed > 4 && car.speed < 16

  let stuckFor = memory.stuckFor
  if (throttle > 0.5 && Math.abs(car.speed) < STUCK_SPEED) stuckFor += dt
  else stuckFor = Math.max(0, stuckFor - dt * 2)
  if (stuckFor >= STUCK_TIME) {
    return {
      input: { throttle: 0, brake: 1, steer: -Math.sign(error) || 1, handbrake: false },
      memory: { stuckFor: 0, reverseFor: REVERSE_TIME },
    }
  }

  return { input: { throttle, brake, steer, handbrake }, memory: { stuckFor, reverseFor: 0 } }
}
