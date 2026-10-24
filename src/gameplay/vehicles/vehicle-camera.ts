/**
 * Vehicle cameras: a GTA-style chase camera and the cockpit, both
 * collision-aware.
 *
 * The chase camera sits low and a little behind the car and *trails* it:
 * its orbit yaw chases the car's heading with a lag, so on a turn the car
 * swings across the frame before the camera catches up, and while the car is
 * sliding the camera leans toward the direction of travel rather than the
 * nose. Distance and field of view grow with speed; holding look-behind
 * swings the camera round to face backwards; a crash adds a decaying shake.
 * The boom casts against the vehicle world so the camera never ends up
 * inside a building.
 *
 * Pure and renderer-free: it returns positions, a target and an extra FOV,
 * and the game loop applies them to the THREE camera. The shake is a
 * function of accumulated simulation time, never wall-clock or random.
 */
import type { Vec3 } from '../collision'
import { BOOM_PADDING, MIN_BOOM, smoothBoom } from '../camera-boom'
import { localToWorld, vehicleForward, type VehicleMotion, type VehiclePose, type VehicleSpec } from './vehicle-model'
import type { VehicleWorld } from './vehicle-collision'

export type VehicleCameraMode = 'chase' | 'cockpit'

export interface VehicleCameraState {
  pos: Vec3
  target: Vec3
  /** Current eased boom length; chase mode only. */
  boom: number
  /** Orbit yaw of the chase camera (heading convention). */
  yaw: number
  /** Extra field of view over the player's setting, degrees. */
  fov: number
  /** Shake amplitude, metres; decays on its own. */
  shake: number
  /** 0 looking ahead … 1 looking behind. */
  lookBack: number
  /** Accumulated camera time, seconds (drives the shake pattern). */
  time: number
  /** False until the first chase frame snaps the rig behind the car. */
  initialized: boolean
}

export interface VehicleCameraInput {
  lookBehind: boolean
}

/** Driver eye height above the seat, metres. */
export const COCKPIT_EYE_HEIGHT = 0.42
/** Chase height above the ground, as a function of the car's height. */
export const CHASE_HEIGHT_BASE = 0.8
export const CHASE_HEIGHT_PER_METRE = 0.72
/** Chase distance behind the car's centre at rest, before the speed stretch. */
export const CHASE_DISTANCE_BASE = 3.9
export const CHASE_DISTANCE_PER_HALF_LENGTH = 0.85
/** Extra distance at top speed, metres. */
export const CHASE_SPEED_STRETCH = 1.7
/** How fast the orbit yaw chases the car, 1/s. Lower swings wider. */
export const CHASE_YAW_RATE = 3.2
/** The trailing lag never exceeds this, radians. */
export const CHASE_MAX_LAG = 0.85
/** Extra FOV at top speed, degrees. */
export const CHASE_MAX_FOV = 13
/** Kept for compatibility: the old fixed chase eye height. */
export const CHASE_EYE_HEIGHT = 2.4

export function initialVehicleCamera(): VehicleCameraState {
  return {
    pos: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    boom: chaseDistance(null, 0),
    yaw: 0,
    fov: 0,
    shake: 0,
    lookBack: 0,
    time: 0,
    initialized: false,
  }
}

export interface CameraFrame {
  pos: Vec3
  target: Vec3
  boom: number
  yaw: number
  fov: number
  shake: number
  lookBack: number
  time: number
}

function wrap(a: number): number {
  let x = a
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/** Chase distance for a spec at a speed. */
export function chaseDistance(spec: VehicleSpec | null, speed: number): number {
  const half = spec?.halfLength ?? 2.4
  const top = spec?.maxForwardSpeed ?? 44
  return CHASE_DISTANCE_BASE + half * CHASE_DISTANCE_PER_HALF_LENGTH + CHASE_SPEED_STRETCH * clamp01(Math.abs(speed) / top)
}

/** Chase eye height above the car's ground plane. */
export function chaseHeight(spec: VehicleSpec): number {
  return CHASE_HEIGHT_BASE + spec.height * CHASE_HEIGHT_PER_METRE
}

/** Extra FOV (degrees) for a speed: nothing in town traffic, the full stretch flat out. */
export function speedFov(spec: VehicleSpec, speed: number): number {
  const t = clamp01((Math.abs(speed) - 9) / Math.max(1, spec.maxForwardSpeed - 9))
  return CHASE_MAX_FOV * Math.pow(t, 1.25)
}

/**
 * The yaw the chase camera wants: the heading, bent toward the direction of
 * travel while the car slides, and flipped for look-behind. Reversing keeps
 * the camera behind the car rather than swinging round.
 */
export function chaseYawTarget(heading: number, motion: Pick<VehicleMotion, 'speed' | 'lateral'> | null): number {
  if (!motion || motion.speed < 3) return heading
  // Right of travel is -d(forward)/dh, so a slide to the right bends the
  // velocity heading down.
  const slip = Math.atan2(motion.lateral, Math.abs(motion.speed))
  return heading - slip * 0.6
}

/**
 * Compute the camera frame for one step.
 *
 * Chase: the orbit yaw eases toward {@link chaseYawTarget} (lag clamped),
 * the boom sweeps back along it against the world, eases outward and snaps
 * inward like the walk boom. Cockpit: fixed at the seat, looking along the
 * heading.
 */
export function computeVehicleCamera(
  pose: VehiclePose,
  spec: VehicleSpec,
  mode: VehicleCameraMode,
  previous: VehicleCameraState,
  world: VehicleWorld,
  dt: number,
  motion: Pick<VehicleMotion, 'speed' | 'lateral'> | null = null,
  input: VehicleCameraInput = { lookBehind: false },
): CameraFrame {
  const f = vehicleForward(pose.heading)
  const time = previous.time + Math.max(0, dt)
  const shake = previous.shake * Math.exp(-5.5 * Math.max(0, dt))

  if (mode === 'cockpit') {
    const seat = localToWorld(pose.heading, spec.seat, pose.pos)
    const pos: Vec3 = {
      x: seat.x,
      y: seat.y + COCKPIT_EYE_HEIGHT,
      z: seat.z,
    }
    const back = input.lookBehind ? -1 : 1
    return {
      pos,
      target: { x: pos.x + f.x * 20 * back, y: pos.y - 0.4, z: pos.z + f.z * 20 * back },
      boom: 0,
      yaw: pose.heading,
      fov: speedFov(spec, motion?.speed ?? 0) * 0.6,
      shake,
      lookBack: input.lookBehind ? 1 : 0,
      time,
    }
  }

  const speed = motion?.speed ?? 0
  const lookBack = previous.initialized
    ? previous.lookBack + ((input.lookBehind ? 1 : 0) - previous.lookBack) * (1 - Math.exp(-14 * dt))
    : input.lookBehind ? 1 : 0

  // Orbit yaw: trail the target, never by more than CHASE_MAX_LAG.
  const wanted = chaseYawTarget(pose.heading, motion)
  let yaw = previous.initialized ? previous.yaw : wanted
  const t = 1 - Math.exp(-CHASE_YAW_RATE * Math.max(0, dt))
  yaw = yaw + wrap(wanted - yaw) * t
  const lag = wrap(yaw - pose.heading)
  if (Math.abs(lag) > CHASE_MAX_LAG) yaw = pose.heading + Math.sign(lag) * CHASE_MAX_LAG
  yaw = wrap(yaw)
  const viewYaw = yaw + lookBack * Math.PI
  const dir = { x: Math.sin(viewYaw), z: Math.cos(viewYaw) }

  const height = chaseHeight(spec)
  const pivot: Vec3 = { x: pose.pos.x, y: pose.pos.y + spec.height * 0.85, z: pose.pos.z }
  const desired = chaseDistance(spec, speed)
  // Cast along the boom from the pivot toward where the camera wants to be.
  const bx = -dir.x * desired
  const bz = -dir.z * desired
  const by = height - spec.height * 0.85
  const len = Math.hypot(bx, by, bz)
  let hit = world.castDistance(pivot, { x: bx / len, y: by / len, z: bz / len }, len)
  if (!Number.isFinite(hit)) hit = len
  const wantedBoom = hit >= len - 1e-9 ? desired : Math.max(MIN_BOOM, (hit - BOOM_PADDING) * (desired / len))
  const boom = previous.initialized ? smoothBoom(previous.boom, wantedBoom, dt, 3) : wantedBoom
  const k = boom / desired

  const wobble = shake
  const sx = Math.sin(time * 37.3) * wobble + Math.sin(time * 61.1) * wobble * 0.5
  const sy = Math.sin(time * 43.7 + 1.3) * wobble * 0.8
  const pos: Vec3 = {
    x: pivot.x + bx * k + sx * dir.z,
    y: pivot.y + by * k + sy,
    z: pivot.z + bz * k - sx * dir.x,
  }
  // Look past the car, a little further ahead at speed.
  const lead = (2.2 + Math.min(10, Math.abs(speed) * 0.18)) * (1 - 2 * lookBack)
  const target: Vec3 = {
    x: pose.pos.x + f.x * lead,
    y: pose.pos.y + spec.height * 0.62 + sy * 0.5,
    z: pose.pos.z + f.z * lead,
  }
  const fovWanted = speedFov(spec, speed)
  const fov = previous.initialized ? previous.fov + (fovWanted - previous.fov) * (1 - Math.exp(-2.2 * dt)) : fovWanted

  return { pos, target, boom, yaw, fov, shake, lookBack, time }
}

/**
 * Ease the camera toward its frame. The chase rig already trails through
 * its yaw, so the position follows quickly; the first frame snaps.
 */
export function easeVehicleCamera(
  current: VehicleCameraState,
  frame: CameraFrame,
  dt: number,
  rate = 14,
): VehicleCameraState {
  const t = current.initialized ? 1 - Math.exp(-rate * Math.max(0, dt)) : 1
  return {
    pos: {
      x: current.pos.x + (frame.pos.x - current.pos.x) * t,
      y: current.pos.y + (frame.pos.y - current.pos.y) * t,
      z: current.pos.z + (frame.pos.z - current.pos.z) * t,
    },
    target: frame.target,
    boom: frame.boom,
    yaw: frame.yaw,
    fov: frame.fov,
    shake: frame.shake,
    lookBack: frame.lookBack,
    time: frame.time,
    initialized: true,
  }
}

/** Kick the shake (a crash). Strength in m/s of closing speed. */
export function kickVehicleCamera(state: VehicleCameraState, closingSpeed: number): void {
  const amp = Math.min(0.35, closingSpeed * 0.022)
  if (amp > state.shake) state.shake = amp
}
