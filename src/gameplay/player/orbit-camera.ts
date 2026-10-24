/**
 * The on-foot orbit camera, as arithmetic.
 *
 * GTA's walk camera is not "the eye pushed back along the view": it is a boom
 * that orbits a pivot at the player's head. The mouse owns the boom's yaw and
 * pitch, the body turns underneath it on its own, and the camera sits a
 * little to the right of the head so the player stands just left of centre
 * and the road ahead stays readable. Everything here is pure so the angles,
 * the offsets and the clamps are unit tested instead of eyeballed.
 *
 * Conventions match three's camera Euler in YXZ order, which is what the
 * first-person view writes:
 *   yaw   0 looks down -Z; positive yaw turns left (counter-clockwise from above)
 *   pitch 0 is level; positive looks up
 * so `forward = (-sin(yaw)·cos(pitch), sin(pitch), -cos(yaw)·cos(pitch))` and
 * the camera's right is `(cos(yaw), 0, -sin(yaw))`.
 */

const DEG = Math.PI / 180

/** Looking down on the player: the boom rises to put the camera overhead. */
export const ORBIT_PITCH_MIN = -60 * DEG
/** Looking up past the player: the boom drops until the ground stops it. */
export const ORBIT_PITCH_MAX = 70 * DEG
/** First person may look further, but never through vertical. */
export const FIRST_PERSON_PITCH_LIMIT = 89 * DEG

/** Radians per pixel of mouse movement at sensitivity 1 (three's PointerLockControls). */
export const ORBIT_RADIANS_PER_PIXEL = 0.002

/** Where the camera wants to sit, metres behind the pivot. */
export const ORBIT_DISTANCE = 3.2
/** Aiming (or hugging a wall) pulls the camera in to this. */
export const ORBIT_AIM_DISTANCE = 2.2
/** Right-shoulder offset: the player stands a little left of centre. */
export const ORBIT_SHOULDER = 0.42
export const ORBIT_AIM_SHOULDER = 0.62
/** Pivot height above the feet — just under the eyes, so the head stays in frame. */
export const ORBIT_PIVOT_HEIGHT = 1.55
/** The boom never gets shorter than this, or the camera enters the head. */
export const ORBIT_MIN_DISTANCE = 0.35
/** Clearance kept between the camera and whatever the boom hit. */
export const ORBIT_WALL_PADDING = 0.3
/** Clearance kept above the ground when the boom swings low. */
export const ORBIT_GROUND_CLEARANCE = 0.25

export interface OrbitAngles {
  yaw: number
  pitch: number
}

export interface V3 {
  x: number
  y: number
  z: number
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/** Keep yaw in (-π, π] so it never grows without bound over a long session. */
export function wrapAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  let a = angle % (Math.PI * 2)
  if (a > Math.PI) a -= Math.PI * 2
  if (a <= -Math.PI) a += Math.PI * 2
  return a
}

/** Signed shortest turn from `from` to `to`, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from)
}

export function clampPitch(pitch: number, min = ORBIT_PITCH_MIN, max = ORBIT_PITCH_MAX): number {
  return Math.max(min, Math.min(max, finiteOr(pitch, 0)))
}

/**
 * Fold one mouse movement into the orbit. Moving the mouse right turns the
 * view right (negative yaw); moving it down looks down (negative pitch) —
 * the same convention as PointerLockControls, so the two feel identical.
 */
export function applyOrbitDelta(
  angles: OrbitAngles,
  dx: number,
  dy: number,
  sensitivity = 1,
  pitchMin = ORBIT_PITCH_MIN,
  pitchMax = ORBIT_PITCH_MAX,
): OrbitAngles {
  const scale = ORBIT_RADIANS_PER_PIXEL * finiteOr(sensitivity, 1)
  const safeDx = finiteOr(dx, 0)
  const safeDy = finiteOr(dy, 0)
  return {
    yaw: wrapAngle(angles.yaw - safeDx * scale),
    pitch: clampPitch(angles.pitch - safeDy * scale, pitchMin, pitchMax),
  }
}

/** Unit view direction for a yaw/pitch pair. */
export function orbitForward(yaw: number, pitch: number): V3 {
  const cp = Math.cos(pitch)
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp }
}

/** Horizontal camera right for a yaw. */
export function orbitRight(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) }
}

/** The yaw whose flat forward is (x, z); used to face the camera along a heading. */
export function yawFromForward(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) < 1e-9) return 0
  return Math.atan2(-x, -z)
}

/**
 * The unobstructed boom: where the camera would sit with nothing in the way.
 * Returns the camera position and the point it looks at (a point far ahead
 * along the view ray through the shoulder, so the aim line is parallel to the
 * boom and the crosshair sits at screen centre).
 */
export function orbitCameraPose(
  pivot: V3,
  angles: OrbitAngles,
  distance: number,
  shoulder: number,
): { position: V3; target: V3; forward: V3 } {
  const forward = orbitForward(angles.yaw, angles.pitch)
  const right = orbitRight(angles.yaw)
  const d = Math.max(0, finiteOr(distance, ORBIT_DISTANCE))
  const s = finiteOr(shoulder, 0)
  const position = {
    x: pivot.x + right.x * s - forward.x * d,
    y: pivot.y - forward.y * d,
    z: pivot.z + right.z * s - forward.z * d,
  }
  const target = {
    x: position.x + forward.x * 10,
    y: position.y + forward.y * 10,
    z: position.z + forward.z * 10,
  }
  return { position, target, forward }
}

/**
 * How far along the pivot→camera segment the camera may sit, given the first
 * thing a sweep along it hit (`hit`, metres from the pivot; null for a clear
 * boom). Padding keeps the near plane out of the wall; the minimum keeps the
 * camera out of the player's head.
 */
export function boomReach(length: number, hit: number | null, padding = ORBIT_WALL_PADDING): number {
  const full = Math.max(0, finiteOr(length, 0))
  if (hit === null || !Number.isFinite(hit) || hit >= full) return full
  return Math.min(full, Math.max(ORBIT_MIN_DISTANCE, hit - padding))
}

/**
 * The boom shortened so the camera stays `clearance` above `groundY`.
 *
 * Looking up swings the camera under the pivot; GTA slides it along the
 * pavement rather than through it, which reads as the camera getting closer.
 * `from` is the pivot, `to` the wanted camera position.
 */
export function groundLimitedReach(
  from: V3,
  to: V3,
  groundY: number | null,
  clearance = ORBIT_GROUND_CLEARANCE,
): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const length = Math.hypot(dx, dy, dz)
  if (groundY === null || !Number.isFinite(groundY) || length < 1e-9) return length
  const floor = groundY + clearance
  if (to.y >= floor) return length
  if (from.y <= floor) return Math.min(length, ORBIT_MIN_DISTANCE)
  // Parametric distance at which the segment crosses the floor.
  const t = (from.y - floor) / (from.y - to.y)
  return Math.max(ORBIT_MIN_DISTANCE, Math.min(length, length * t))
}

/** Frame-rate independent exponential approach. `rate` is 1/seconds. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  if (!Number.isFinite(current)) return target
  if (!Number.isFinite(target)) return current
  const t = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, finiteOr(dt, 0)))
  return current + (target - current) * t
}

/** `damp` for an angle, along the shortest way round. */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return wrapAngle(current + angleDelta(current, target) * (1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt))))
}

/** Rotate `current` toward `target` by at most `maxStep` radians. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const delta = angleDelta(current, target)
  const step = Math.max(0, finiteOr(maxStep, 0))
  if (Math.abs(delta) <= step) return wrapAngle(target)
  return wrapAngle(current + Math.sign(delta) * step)
}

/**
 * Where the pivot should be: the head, lagging the body a little.
 *
 * A camera glued to the player reads as a first-person camera on a stick. A
 * short exponential lag lets the player pull ahead when they break into a
 * sprint and settles back when they stop — the weight GTA's camera has. The
 * vertical axis gets a slower rate so a jump lifts the body in frame instead
 * of throwing the whole view upward.
 */
export function followPivot(
  current: V3,
  target: V3,
  dt: number,
  horizontalRate = 14,
  verticalRate = 8,
  snapDistance = 12,
): V3 {
  const gap = Math.hypot(target.x - current.x, target.y - current.y, target.z - current.z)
  // A teleport (respawn, dev menu, exiting a car across the street) must not
  // become a camera flight.
  if (!Number.isFinite(gap) || gap > snapDistance) return { ...target }
  return {
    x: damp(current.x, target.x, horizontalRate, dt),
    y: damp(current.y, target.y, verticalRate, dt),
    z: damp(current.z, target.z, horizontalRate, dt),
  }
}

/**
 * Field of view for the current movement. Sprinting widens the lens a few
 * degrees (speed reads as speed); aiming narrows it.
 */
export function orbitFov(baseFov: number, sprintBlend: number, aimBlend: number): number {
  const sprint = Math.max(0, Math.min(1, finiteOr(sprintBlend, 0)))
  const aim = Math.max(0, Math.min(1, finiteOr(aimBlend, 0)))
  return baseFov + 6 * sprint - 12 * aim
}

/**
 * A small, smooth head-bob while running: vertical at twice the stride
 * frequency, a touch of sideways sway at the stride frequency. Amplitude is
 * scaled by `intensity` (0 standing, 1 flat-out sprint).
 */
export function headBob(phase: number, intensity: number): { x: number; y: number } {
  const k = Math.max(0, Math.min(1, finiteOr(intensity, 0)))
  return {
    x: Math.sin(phase) * 0.018 * k,
    y: Math.abs(Math.sin(phase)) * 0.045 * k - 0.02 * k,
  }
}
