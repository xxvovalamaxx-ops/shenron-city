/**
 * On-foot locomotion: input → velocity, with weight.
 *
 * The old walk code turned a held key straight into full speed along the
 * camera's forward and back to zero on release, and the body spun to face
 * whatever the displacement happened to be that frame. That reads as a
 * cursor, not a person. This is the GTA recipe instead:
 *
 *   - input is read relative to the camera (W runs away from the camera),
 *   - the body turns toward the input direction at a finite rate — quicker
 *     when slow, lazier in a flat-out sprint,
 *   - the player runs the way the body faces, so a reversal is a tight turn
 *     rather than an instant moonwalk,
 *   - speed ramps up and down at a finite acceleration, and a hard turn
 *     scrubs speed,
 *   - in the air there is only a little steering,
 *   - aiming (right mouse) strafes: the body faces the camera and moves in
 *     any direction at a walk.
 *
 * Pure and deterministic: a state in, a state out, unit tested.
 */
import { angleDelta, dampAngle, damp, wrapAngle } from './orbit-camera'

/** Default on-foot pace: GTA's jog. Matches WALK_SPEED in player-locomotion. */
export const RUN_SPEED = 4.3
/** Shift. Matches SPRINT_SPEED in player-locomotion. */
export const SPRINT_SPEED = 7.1
/** Moving while aiming. */
export const AIM_WALK_SPEED = 2.1

/** m/s² while speeding up. 0 → jog in about a third of a second. */
export const ACCELERATION = 13
/** m/s² while slowing. A sprint stops in about 0.4 s. */
export const DECELERATION = 18
/** m/s² of steering while airborne. */
export const AIR_CONTROL = 3.5

/** Body turn rates (1/s, exponential) at a standstill and flat out. */
export const TURN_RATE_SLOW = 13
export const TURN_RATE_FAST = 7

export interface FootState {
  /** World-space horizontal velocity, m/s. */
  vx: number
  vz: number
  /**
   * Body heading in the model's convention: facing = (sin yaw, cos yaw), so
   * yaw 0 faces +Z. Same as PlayerAvatar's `rotation.y`.
   */
  bodyYaw: number
  /** 0..1, how much of a sprint is under way (drives FOV and head-bob). */
  sprintBlend: number
  /** 0..1, how far into the aim pose. */
  aimBlend: number
}

export interface FootInput {
  /** -1..1, W/S. */
  forward: number
  /** -1..1, D/A. */
  strafe: number
  sprint: boolean
  aim: boolean
  grounded: boolean
  /** Camera yaw in the orbit convention (0 looks down -Z). */
  cameraYaw: number
  /** Dev speed multiplier. */
  speedScale?: number
  /**
   * First person: the body is the camera, so it faces the view and strafes
   * at full pace rather than turning to run where the keys point.
   */
  firstPerson?: boolean
}

export function createFootState(bodyYaw = 0): FootState {
  return { vx: 0, vz: 0, bodyYaw: wrapAngle(bodyYaw), sprintBlend: 0, aimBlend: 0 }
}

/** Model-convention yaw for a world direction (x, z). */
export function bodyYawFor(x: number, z: number): number {
  return Math.atan2(x, z)
}

/**
 * The input direction in world space, relative to the camera, normalised, or
 * null when no key is held. Diagonals are not faster than straight lines.
 */
export function cameraRelativeDirection(
  forward: number,
  strafe: number,
  cameraYaw: number,
): { x: number; z: number } | null {
  const f = Number.isFinite(forward) ? forward : 0
  const s = Number.isFinite(strafe) ? strafe : 0
  if (f === 0 && s === 0) return null
  // Camera forward (flat) and right for the orbit yaw convention.
  const fx = -Math.sin(cameraYaw)
  const fz = -Math.cos(cameraYaw)
  const rx = Math.cos(cameraYaw)
  const rz = -Math.sin(cameraYaw)
  const mx = fx * f + rx * s
  const mz = fz * f + rz * s
  const len = Math.hypot(mx, mz)
  if (len < 1e-9) return null
  return { x: mx / len, z: mz / len }
}

/** Move `value` toward `target` by at most `step`. */
function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step)
  return Math.max(target, value - step)
}

/**
 * Advance the on-foot state by `dt`. Returns a new state; the caller moves
 * the player by `(vx, vz) · dt` through collision and may feed the result back
 * through {@link reconcileBlocked}.
 */
export function stepFoot(state: FootState, input: FootInput, dt: number): FootState {
  const h = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1))
  const scale = input.speedScale && input.speedScale > 0 ? input.speedScale : 1
  const dir = cameraRelativeDirection(input.forward, input.strafe, input.cameraYaw)
  const speed = Math.hypot(state.vx, state.vz)

  let { vx, vz, bodyYaw } = state
  const aimBlend = damp(state.aimBlend, input.aim ? 1 : 0, 10, h)

  if (!input.grounded) {
    // Airborne: momentum carries, a little steering, the body keeps turning.
    if (dir) {
      const wantX = dir.x * Math.max(speed, RUN_SPEED * 0.6 * scale)
      const wantZ = dir.z * Math.max(speed, RUN_SPEED * 0.6 * scale)
      vx = approach(vx, wantX, AIR_CONTROL * h)
      vz = approach(vz, wantZ, AIR_CONTROL * h)
      bodyYaw = dampAngle(bodyYaw, bodyYawFor(dir.x, dir.z), 4, h)
    }
    return {
      vx,
      vz,
      bodyYaw,
      sprintBlend: damp(state.sprintBlend, 0, 3, h),
      aimBlend,
    }
  }

  if (input.aim || input.firstPerson) {
    // Aim / first person: strafe relative to the camera, body squared up to
    // the view.
    bodyYaw = dampAngle(bodyYaw, wrapAngle(input.cameraYaw + Math.PI), 16, h)
    const pace = input.aim ? AIM_WALK_SPEED : input.sprint ? SPRINT_SPEED : RUN_SPEED
    const target = dir ? pace * scale : 0
    const wantX = dir ? dir.x * target : 0
    const wantZ = dir ? dir.z * target : 0
    const rate = (dir ? ACCELERATION : DECELERATION) * scale
    vx = approach(vx, wantX, rate * h)
    vz = approach(vz, wantZ, rate * h)
    const sprinting = !input.aim && input.sprint && dir !== null && Math.hypot(vx, vz) > RUN_SPEED * scale + 0.4
    return {
      vx,
      vz,
      bodyYaw,
      sprintBlend: damp(state.sprintBlend, sprinting ? 1 : 0, sprinting ? 2.5 : 6, h),
      aimBlend,
    }
  }

  let targetSpeed = 0
  if (dir) {
    const wanted = bodyYawFor(dir.x, dir.z)
    const topSpeed = input.sprint ? SPRINT_SPEED : RUN_SPEED
    // Lazier turns at speed: a sprint arcs, a standing turn is quick.
    const fastness = Math.min(1, speed / SPRINT_SPEED)
    const turnRate = TURN_RATE_SLOW + (TURN_RATE_FAST - TURN_RATE_SLOW) * fastness
    bodyYaw = dampAngle(bodyYaw, wanted, turnRate, h)
    // A hard turn scrubs speed: running at 90° to where you face is a stumble.
    const align = Math.cos(angleDelta(bodyYaw, wanted))
    const alignScale = Math.max(0.3, Math.min(1, (align + 0.6) / 1.4))
    targetSpeed = topSpeed * scale * alignScale
  }

  const rate = (targetSpeed > speed ? ACCELERATION : DECELERATION) * scale
  const nextSpeed = approach(speed, targetSpeed, rate * h)
  // Travel follows the body, which is what makes a reversal a turn.
  vx = Math.sin(bodyYaw) * nextSpeed
  vz = Math.cos(bodyYaw) * nextSpeed

  const sprinting = input.sprint && dir !== null && nextSpeed > RUN_SPEED * scale + 0.4
  return {
    vx,
    vz,
    bodyYaw,
    sprintBlend: damp(state.sprintBlend, sprinting ? 1 : 0, sprinting ? 2.5 : 4, h),
    aimBlend,
  }
}

/**
 * After collision: a wall that stopped the player also stops the velocity,
 * or releasing the key after running into a wall would coast the player away
 * at full speed. `movedX/Z` is what the world actually allowed this frame.
 */
export function reconcileBlocked(
  state: FootState,
  movedX: number,
  movedZ: number,
  dt: number,
): FootState {
  if (!(dt > 0)) return state
  const wanted = Math.hypot(state.vx, state.vz)
  if (wanted < 1e-6) return state
  const achieved = Math.hypot(movedX, movedZ) / dt
  if (achieved >= wanted * 0.98) return state
  // Keep a little headroom so sliding along a wall still accelerates.
  const allowed = Math.min(wanted, achieved + 1.2)
  const k = allowed / wanted
  return { ...state, vx: state.vx * k, vz: state.vz * k }
}
