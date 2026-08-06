/**
 * Vehicle cameras: chase and cockpit, both collision-aware.
 *
 * The chase camera reuses the existing boom machinery — the same constants
 * (BOOM_DISTANCE, BOOM_PADDING, MIN_BOOM) and the same easing — but casts
 * against the vehicle world instead of an AABB list, so one interface serves
 * the AABB test arena and the Manhattan BVH. The cockpit camera sits at the
 * seat with the driver's eye height; no boom, nothing to collide with.
 *
 * Pure and renderer-free: it returns positions and target directions, and
 * the game loop applies them to the THREE camera.
 */
import type { Vec3 } from '../collision'
import { BOOM_DISTANCE, BOOM_PADDING, MIN_BOOM, smoothBoom } from '../camera-boom'
import { localToWorld, vehicleForward, type VehiclePose, type VehicleSpec } from './vehicle-model'
import type { VehicleWorld } from './vehicle-collision'

export type VehicleCameraMode = 'chase' | 'cockpit'

export interface VehicleCameraState {
  pos: Vec3
  target: Vec3
  /** Current eased boom length; chase mode only. */
  boom: number
}

/** Driver eye height above the seat, metres. */
export const COCKPIT_EYE_HEIGHT = 0.42
/** Height of the chase camera above the vehicle's axle plane, metres. */
export const CHASE_EYE_HEIGHT = 2.4

export function initialVehicleCamera(): VehicleCameraState {
  return {
    pos: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    boom: BOOM_DISTANCE,
  }
}

export interface CameraFrame {
  pos: Vec3
  target: Vec3
  boom: number
}

/**
 * Compute the camera frame for one step.
 *
 * Chase: boom sweeps back along -forward against the world; the camera eases
 * outward and snaps inward exactly like the walk boom. Cockpit: fixed at the
 * seat, looking along the heading.
 */
export function computeVehicleCamera(
  pose: VehiclePose,
  spec: VehicleSpec,
  mode: VehicleCameraMode,
  previous: VehicleCameraState,
  world: VehicleWorld,
  dt: number,
): CameraFrame {
  const f = vehicleForward(pose.heading)

  if (mode === 'cockpit') {
    const seat = localToWorld(pose.heading, spec.seat, pose.pos)
    const pos: Vec3 = {
      x: seat.x,
      y: seat.y + COCKPIT_EYE_HEIGHT,
      z: seat.z,
    }
    return {
      pos,
      target: { x: pos.x + f.x * 20, y: pos.y, z: pos.z + f.z * 20 },
      boom: 0,
    }
  }

  const eye: Vec3 = {
    x: pose.pos.x,
    y: pose.pos.y + CHASE_EYE_HEIGHT,
    z: pose.pos.z,
  }
  const back = { x: -f.x, y: 0, z: -f.z }
  let hit = world.castDistance(eye, back, BOOM_DISTANCE)
  if (!Number.isFinite(hit)) hit = BOOM_DISTANCE
  // Padding only applies to a real hit; a clear view keeps the full boom.
  const wanted =
    hit >= BOOM_DISTANCE - 1e-9
      ? BOOM_DISTANCE
      : Math.max(MIN_BOOM, hit - BOOM_PADDING)
  const boom = smoothBoom(previous.boom, wanted, dt)

  return {
    pos: { x: eye.x - f.x * boom, y: eye.y, z: eye.z - f.z * boom },
    target: {
      x: eye.x + f.x * 8,
      y: eye.y - 0.6,
      z: eye.z + f.z * 8,
    },
    boom,
  }
}

/** Ease the chase camera toward its frame (position only, keeps the boom). */
export function easeVehicleCamera(
  current: VehicleCameraState,
  frame: CameraFrame,
  dt: number,
  rate = 7,
): VehicleCameraState {
  const t = 1 - Math.exp(-rate * Math.max(0, dt))
  return {
    pos: {
      x: current.pos.x + (frame.pos.x - current.pos.x) * t,
      y: current.pos.y + (frame.pos.y - current.pos.y) * t,
      z: current.pos.z + (frame.pos.z - current.pos.z) * t,
    },
    target: frame.target,
    boom: frame.boom,
  }
}
