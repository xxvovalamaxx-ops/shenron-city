/**
 * Deterministic kinematic/arcade vehicle dynamics.
 *
 * Phase 3A deliberately starts with an arcade model rather than a rigid-body
 * engine: a bicycle model with a signed forward speed, a rate-limited steering
 * angle, an exponentially damped lateral velocity for traction and a handbrake
 * that trades grip for yaw. Every function in this module is pure — same
 * (spec, pose, motion, input, dt) produces the same result every time — so a
 * recorded input stream can be replayed and compared exactly. See
 * docs/phase3/PHASE3A.md for the documented replay tolerances.
 *
 * Conventions:
 * - Heading is the yaw in radians on the ground plane using the same basis as
 *   the rest of the build: forward = (sin h, cos h), right = (-cos h, sin h).
 *   `mapHeading` in the HUD is `atan2(forward.x, forward.z)`, so a positive
 *   heading is a clockwise turn viewed from above.
 * - `speed` is signed, metres per second along the vehicle's forward axis.
 *   Negative is reversing.
 * - `steer` is the signed steering *input* in [-1, 1]; the *angle* of the
 *   front wheels is `motion.steerAngle`, which chases `input * maxSteer` at a
 *   rate limit. Front wheels steer; the rear axle is fixed.
 * - The model is integrated with a fixed `dt`. Callers that receive variable
 *   frame deltas subdivide into fixed steps (see vehicle-control.ts).
 */
import type { Vec3 } from '../collision'

export interface VehicleSpec {
  /** Display name, e.g. 'sedan'. */
  label: string
  /** Bounding box half-extents, used for collision and camera framing. */
  halfLength: number
  halfWidth: number
  height: number
  /** Distance between front and rear axles, for the bicycle model. */
  wheelbase: number
  wheelRadius: number
  /** Signed speed ceiling, m/s. */
  maxForwardSpeed: number
  maxReverseSpeed: number
  /** Forward acceleration under full throttle, m/s². */
  acceleration: number
  /** Acceleration backwards while reversing, m/s². */
  reverseAcceleration: number
  /** Deceleration under the brake pedal, m/s². */
  brakeDeceleration: number
  /** Deceleration while the handbrake is held, m/s². */
  handbrakeDeceleration: number
  /** Constant drivetrain/rolling resistance, m/s². */
  rollingDrag: number
  /** Quadratic aerodynamic drag coefficient, 1/m. */
  airDrag: number
  /** Full steering angle of the front wheels, radians. */
  maxSteer: number
  /** How fast the front wheels reach their commanded angle, rad/s. */
  steerRate: number
  /** Lateral-velocity decay (tyre grip), 1/s. Higher is stickier. */
  grip: number
  /** Lateral-velocity decay while the handbrake is held, 1/s. */
  handbrakeGrip: number
  /** Extra lateral shove applied while handbraking and steering, m/s². */
  handbrakeLateralImpulse: number
  /** Steering authority multiplier while handbraking. */
  handbrakeYawBoost: number
  /** Fraction of forward speed kept after a hard body hit. */
  collisionSpeedKeep: number
  /** Seat position in local vehicle metres, origin at the axle midpoint. */
  seat: Vec3
  /**
   * Door handle positions in local metres. The nearest door within
   * `ENTER_PROMPT_RADIUS` produces the enter prompt; its companion exit spot
   * is the door position plus `exitOffset` along the outward normal.
   */
  doors: ReadonlyArray<{ offset: Vec3; out: { x: number; z: number } }>
}

export interface VehicleMotion {
  /** Signed forward speed, m/s. */
  speed: number
  /** Signed lateral velocity (slide), m/s, positive toward the right. */
  lateral: number
  /** Current front-wheel steering angle, radians. */
  steerAngle: number
  /** Accumulated wheel rotation, radians, for the visual wheels. */
  wheelSpin: number
  /** True while the brake/reverse/handbrake lights should be lit. */
  braking: boolean
  /** True while the vehicle is moving backwards. */
  reversing: boolean
}

export interface VehiclePose {
  pos: Vec3
  heading: number
}

export interface VehicleInput {
  /** 0..1 forward acceleration pedal. */
  throttle: number
  /** 0..1 brake pedal. Held from a standstill, this reverses the car. */
  brake: number
  /** -1..1 steering input; positive steers toward +heading. */
  steer: number
  /** Handbrake: strong decel, reduced grip, boosted yaw. */
  handbrake: boolean
}

export function initialVehicleMotion(): VehicleMotion {
  return {
    speed: 0,
    lateral: 0,
    steerAngle: 0,
    wheelSpin: 0,
    braking: false,
    reversing: false,
  }
}

// ── Ground-plane basis ───────────────────────────────────────────────────────

export function vehicleForward(heading: number): { x: number; z: number } {
  return { x: Math.sin(heading), z: Math.cos(heading) }
}

export function vehicleRight(heading: number): { x: number; z: number } {
  return { x: -Math.cos(heading), z: Math.sin(heading) }
}

/**
 * Local offset (rotated by `heading`) into world space.
 *
 * Local convention: `offset.x` is along the vehicle's RIGHT, `offset.z` is
 * along FORWARD — so a door at x=0.62 is on the right side of the car and a
 * negative z puts it behind the axle. Used for doors, the seat and the
 * camera eye.
 */
export function localToWorld(
  heading: number,
  offset: Vec3,
  origin: Vec3,
): Vec3 {
  const f = vehicleForward(heading)
  const r = vehicleRight(heading)
  return {
    x: origin.x + f.x * offset.z + r.x * offset.x,
    y: origin.y + offset.y,
    z: origin.z + f.z * offset.z + r.z * offset.x,
  }
}

// ── Speed-sensitive steering ─────────────────────────────────────────────────

/**
 * Steering authority as a function of ground speed.
 *
 * Full authority while manoeuvring at walking pace (parking), tapering to a
 * highway-safe fraction at speed. The knee at 2 m/s keeps the car drivable
 * from rest; the taper between the knee and 14 m/s is linear, then it eases
 * toward the 0.32 floor at `maxForwardSpeed`.
 */
export function steeringFactor(speed: number, maxForwardSpeed: number): number {
  const v = Math.abs(speed)
  if (v <= 2) return 1
  const TAPER_START = 2
  const TAPER_END = 14
  const MID = 0.6
  const FLOOR = 0.32
  if (v <= TAPER_END) {
    return 1 - ((v - TAPER_START) / (TAPER_END - TAPER_START)) * (1 - MID)
  }
  return MID - Math.min(1, (v - TAPER_END) / Math.max(1e-6, maxForwardSpeed - TAPER_END)) * (MID - FLOOR)
}

// ── Integration ──────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Advance the vehicle by one fixed `dt`.
 *
 * Order of operations is fixed and documented so the replay comparison stays
 * meaningful: direction switching, longitudinal forces, speed clamp, steering
 * angle chase, yaw, lateral grip + handbrake slide, then translation. The pose
 * `y` is taken from `groundY` (wheels on the surface); when the world reports
 * no ground the previous height is kept rather than inventing one.
 */
export function stepVehicle(
  spec: VehicleSpec,
  pose: VehiclePose,
  motion: VehicleMotion,
  input: VehicleInput,
  dt: number,
  groundY: number | null,
): { pose: VehiclePose; motion: VehicleMotion } {
  const { speed: v0, lateral: l0, steerAngle: s0, wheelSpin: w0 } = motion
  let v = v0
  let l = l0
  let s = s0

  // ── Direction switching ──────────────────────────────────────────────────
  // Throttle pushed while reversing brakes the car out of reverse, then
  // drives forward once it crosses zero. The brake pedal is symmetric: it
  // brakes forward motion, then accelerates backwards from a standstill.
  if (input.throttle > 0) {
    if (v >= -0.05) v += spec.acceleration * input.throttle * dt
    else v += spec.brakeDeceleration * input.throttle * dt
  }
  if (input.brake > 0) {
    if (v > 0.2) v -= spec.brakeDeceleration * input.brake * dt
    else v -= spec.reverseAcceleration * input.brake * dt
  }

  // ── Handbrake deceleration ───────────────────────────────────────────────
  if (input.handbrake && v !== 0) {
    const step = spec.handbrakeDeceleration * dt
    v = v > 0 ? Math.max(0, v - step) : Math.min(0, v + step)
  }

  // ── Rolling + aerodynamic drag ───────────────────────────────────────────
  if (v !== 0) {
    const roll = spec.rollingDrag * dt
    v = v > 0 ? Math.max(0, v - roll) : Math.min(0, v + roll)
    v -= spec.airDrag * v * Math.abs(v) * dt
  }

  // ── Speed ceiling ────────────────────────────────────────────────────────
  v = clamp(v, -spec.maxReverseSpeed, spec.maxForwardSpeed)

  // ── Steering angle chase (front-wheel steering) ──────────────────────────
  const steerTarget = input.steer * spec.maxSteer
  const steerDelta = spec.steerRate * dt
  if (s < steerTarget) s = Math.min(steerTarget, s + steerDelta)
  else if (s > steerTarget) s = Math.max(steerTarget, s - steerDelta)

  // ── Yaw (bicycle model) ──────────────────────────────────────────────────
  let yawRate = (v / spec.wheelbase) * Math.tan(s * steeringFactor(v, spec.maxForwardSpeed))
  if (input.handbrake && Math.abs(v) > 0.8) {
    yawRate *= 1 + spec.handbrakeYawBoost
  }
  const heading = pose.heading + yawRate * dt

  // ── Lateral traction + handbrake slide ───────────────────────────────────
  const grip = input.handbrake ? spec.handbrakeGrip : spec.grip
  l *= Math.exp(-grip * dt)
  if (input.handbrake && Math.abs(v) > 0.8 && input.steer !== 0) {
    l += Math.sign(v) * input.steer * spec.handbrakeLateralImpulse * dt
  }
  l = clamp(l, -3.5, 3.5)

  // ── Translation ──────────────────────────────────────────────────────────
  const f = vehicleForward(heading)
  const r = vehicleRight(heading)
  const next = { ...pose.pos }
  next.x += (f.x * v + r.x * l) * dt
  next.z += (f.z * v + r.z * l) * dt
  if (groundY !== null) next.y = groundY

  return {
    pose: { pos: next, heading },
    motion: {
      speed: v,
      lateral: l,
      steerAngle: s,
      wheelSpin: w0 + (v / spec.wheelRadius) * dt,
      braking:
        input.brake > 0 && v > 0.05 ||
        input.handbrake ||
        v < -0.05 ||
        (input.throttle > 0 && v < -0.05),
      reversing: v < -0.1,
    },
  }
}

/** Reset the vehicle to a standstill at a given pose (parking, entering). */
export function parkVehicleMotion(): VehicleMotion {
  const m = initialVehicleMotion()
  m.braking = true
  return m
}

/** Is the vehicle effectively stationary? Used to gate prompt and exit logic. */
export function isStationary(motion: VehicleMotion, tolerance = 0.05): boolean {
  return Math.abs(motion.speed) < tolerance && Math.abs(motion.lateral) < tolerance
}

/**
 * Wall-clock readable speed in km/h. The HUD publishes this; the simulation
 * never reads it back, so it is safe to round for display.
 */
export function speedKmh(speed: number): number {
  return Math.abs(speed * 3.6)
}
