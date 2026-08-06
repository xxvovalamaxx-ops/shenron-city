/**
 * AI traffic: deterministic lane followers sharing the arcade vehicle model.
 *
 * Traffic never uses a different motion model than the player — every
 * AI-controlled vehicle runs {@link stepVehicle} with an input produced by a
 * pure steering/longitudinal controller. Lane follow is a lookahead point on
 * the lane plus the nearest-point lateral error; longitudinal control is
 * cruise target speed, curvature cap and a leader gap. All gains and
 * thresholds are constants here, so the AI's behaviour is a pure function of
 * the world state — required for the replay test to reproduce collisions.
 */
import type { Vec3 } from '../collision'
import { stepVehicle } from './vehicle-model'
import { vehicleSpec } from './vehicle-specs'
import { BOULEVARD_LOOP, LANES, nearestLanePoint, pointAlongLane, wrapLaneDistance, type Lane } from './vehicle-lanes'
import {
  rectContact,
  type Pedestrian,
  type VehicleWorld,
} from './vehicle-collision'
import type { RectContact } from './vehicle-collision'
import {
  type VehicleEntity,
  type VehicleRegistry,
  transitionVehicle,
} from './vehicle-entities'

export const AI_LOOKAHEAD = 7
export const AI_LEADER_GAP = 10
export const AI_EMERGENCY_GAP = 3.5
export const AI_PED_BRAKE_RANGE = 7
/** Pure-pursuit gain: steer proportional to the angle to the lookahead point. */
export const AI_STEER_PURSUIT = 2

/** Smallest signed angle from `from` to `to`, radians. */
export function wrapAngle(from: number, to: number): number {
  let diff = to - from
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return diff
}

export interface AiControllerInput {
  throttle: number
  brake: number
  steer: number
  handbrake: boolean
}

/**
 * Longitudinal and lateral commands for one AI vehicle. `leaders` supplies
 * the pose of any vehicle ahead on the same lane so the gap rule can brake.
 */
export function aiInputFor(
  vehicle: VehicleEntity,
  lane: Lane,
  leaders: ReadonlyArray<{ pose: { pos: Vec3; heading: number }; speed: number }>,
  pedestrians: ReadonlyArray<Pick<Pedestrian, 'pos' | 'radius'>>,
): AiControllerInput {
  const ai = vehicle.ai!
  const sample = nearestLanePoint(lane, vehicle.pose.pos.x, vehicle.pose.pos.z)

  // Pure pursuit: steer toward the point on the centre-line AI_LOOKAHEAD
  // metres ahead, scaled by the angle between the heading and that point.
  // This converges where a lateral P controller on a limited-steer car
  // hunts, because the pursuit point leads the car into the line instead of
  // pushing it sideways.
  const ahead = pointAlongLane(lane, ai.distance + AI_LOOKAHEAD)
  const toTarget = Math.atan2(
    ahead.point.x - vehicle.pose.pos.x,
    ahead.point.z - vehicle.pose.pos.z,
  )
  const steer = clamp11(AI_STEER_PURSUIT * wrapAngle(vehicle.pose.heading, toTarget))

  // Speed: cruise, curve-limited, leader-limited, pedestrian-limited.
  let desired = ai.targetSpeed
  const curveCap = laneCurveSpeedCap(ai.targetSpeed, sample.curvature, 3.5)
  desired = Math.min(desired, curveCap)

  for (const leader of leaders) {
    const gap = leaderGap(vehicle, lane, leader.pose)
    if (gap === null) continue
    if (gap < AI_LEADER_GAP) desired = Math.min(desired, Math.abs(leader.speed) * Math.max(0, gap / AI_LEADER_GAP))
    if (gap < AI_EMERGENCY_GAP) desired = 0
  }

  const f = { x: Math.sin(vehicle.pose.heading), z: Math.cos(vehicle.pose.heading) }
  for (const ped of pedestrians) {
    const dx = ped.pos.x - vehicle.pose.pos.x
    const dz = ped.pos.z - vehicle.pose.pos.z
    const along = dx * f.x + dz * f.z
    const across = Math.abs(dx * (-f.z) + dz * f.x)
    if (along > 0 && along < AI_PED_BRAKE_RANGE && across < 1.2) {
      desired = Math.min(desired, 0.8)
    }
  }

  const speed = vehicle.motion.speed
  if (speed < desired - 0.4) return { throttle: 1, brake: 0, steer, handbrake: false }
  if (speed > desired + 0.4) {
    return {
      throttle: 0,
      brake: Math.min(1, (speed - desired) / 4),
      steer,
      handbrake: false,
    }
  }
  return { throttle: 0, brake: 0, steer, handbrake: false }
}

/** Signed distance (metres) from the leader's lane position to the vehicle's. */
export function leaderGap(
  vehicle: VehicleEntity,
  lane: Lane,
  leaderPose: { pos: Vec3; heading: number },
): number | null {
  if (vehicle.ai === null) return null
  const me = nearestLanePoint(lane, vehicle.pose.pos.x, vehicle.pose.pos.z)
  const them = nearestLanePoint(lane, leaderPose.pos.x, leaderPose.pos.z)
  let gap = them.distance - me.distance
  if (lane.loop) {
    const length = laneLengthCached(lane)
    if (gap < 0) gap += length
  }
  return gap
}

function laneLengthCached(lane: Lane): number {
  const n = lane.points.length
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = lane.points[i]
    const b = lane.points[(i + 1) % n]
    total += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return total
}

/** Lateral-acceleration-limited speed on a curve, m/s. */
export function laneCurveSpeedCap(targetSpeed: number, curvature: number, maxLatAccel = 3.5): number {
  if (curvature <= 1e-6) return targetSpeed
  return Math.min(targetSpeed, Math.sqrt(maxLatAccel / curvature))
}

function clamp11(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v
}

/**
 * Advance every pedestrian one fixed step. Each pedestrian walks along its
 * segment and reflects at its bound. A pedestrian who was knocked aside by a
 * vehicle keeps their displaced position — the knock is absorbed into the
 * walking schedule (offset recomputed from the current position) and they
 * stay down for PED_DOWN_TIME without reflecting, so a hit happens at most
 * once per encounter instead of once per frame.
 */
export function updatePedestrians(
  pedestrians: ReadonlyArray<Pedestrian>,
  dt: number,
): Pedestrian[] {
  return pedestrians.map((ped) => {
    let displaced = ped.displaced
    let downTimer = ped.downTimer
    if (displaced) {
      downTimer -= dt
      if (downTimer <= 0) displaced = false
    }
    // Absorb any vehicle displacement into the walking schedule.
    const absorbed = (ped.pos.x - ped.anchor.x) * ped.dir.x + (ped.pos.z - ped.anchor.z) * ped.dir.z
    let offset = absorbed + ped.speed * dt
    let dir = ped.dir
    // While down the pedestrian does not reflect at the bound; recovery
    // snaps the schedule back into the segment on the next step.
    if (!displaced) {
      if (offset > ped.bound) {
        offset = 2 * ped.bound - offset
        dir = { x: -ped.dir.x, z: -ped.dir.z }
      } else if (offset < -ped.bound) {
        offset = -2 * ped.bound - offset
        dir = { x: -ped.dir.x, z: -ped.dir.z }
      }
    }
    return {
      ...ped,
      displaced,
      downTimer,
      dir,
      offset,
      pos: {
        x: ped.anchor.x + dir.x * offset,
        y: ped.anchor.y,
        z: ped.anchor.z + dir.z * offset,
      },
    }
  })
}

/**
 * Advance one AI vehicle one fixed step. `leaders` and `pedestrians` are the
 * current step's world view, supplied by the caller so the AI sees exactly
 * what the player sees. Returns whether this step collided with the world.
 */
export function stepAiVehicle(
  entity: VehicleEntity,
  world: VehicleWorld,
  dt: number,
  leaders: ReadonlyArray<{ pose: { pos: Vec3; heading: number }; speed: number }>,
  pedestrians: ReadonlyArray<Pick<Pedestrian, 'pos' | 'radius'>>,
): { collisionsWorld: boolean; pedHits: number } {
  const lane = LANES[entity.ai!.laneId] ?? BOULEVARD_LOOP
  const spec = vehicleSpec(entity.kind)
  const input = aiInputFor(entity, lane, leaders, pedestrians)

  const groundY = world.groundHeightAt(entity.pose.pos.x, entity.pose.pos.z)
  const before = { ...entity.pose }
  const stepped = stepVehicle(spec, entity.pose, entity.motion, input, dt, groundY)
  entity.pose = stepped.pose
  entity.motion = stepped.motion

  const dx = entity.pose.pos.x - before.pos.x
  const dz = entity.pose.pos.z - before.pos.z
  const radius = spec.halfWidth * 0.85
  const moved = world.moveCircle(before.pos, dx, dz, radius)
  const travelled = Math.hypot(moved.x - before.pos.x, moved.z - before.pos.z)
  const intended = Math.hypot(dx, dz)
  const collisionsWorld = intended > 1e-4 && travelled < intended * 0.99
  if (collisionsWorld) {
    const keep = spec.collisionSpeedKeep
    const ratio = Math.max(0, Math.min(1, travelled / intended))
    entity.motion.speed *= keep + (1 - keep) * ratio
    entity.motion.lateral = 0
    entity.pose.pos.x = moved.x
    entity.pose.pos.z = moved.z
    if (groundY !== null) entity.pose.pos.y = groundY
  }

  // Track progress along the lane for the follow logic.
  entity.ai!.distance = wrapLaneDistance(lane, entity.ai!.distance + entity.motion.speed * dt)

  return { collisionsWorld, pedHits: 0 }
}

/**
 * Resolve overlaps between every moving vehicle and every other vehicle.
 * Parked vehicles are static obstacles (they never get pushed); two parked
 * vehicles never touch. Overlaps are separated by the full minimum-
 * translation depth — not a fixed nudge — so a car clipped from behind is
 * pushed cleanly out instead of grinding against the contact every frame.
 * Order is fixed by id so the outcome is a pure function of the state.
 * Returns the ids of vehicles that were in a hard hit this step.
 */
export function resolveVehiclePairs(
  registry: VehicleRegistry,
): number[] {
  const entities = [...registry.vehicles.values()].sort((a, b) => a.id - b.id)
  const hitIds = new Set<number>()
  for (let i = 0; i < entities.length; i++) {
    const a = entities[i]
    if (a.state === 'DISABLED') continue
    for (let j = i + 1; j < entities.length; j++) {
      const b = entities[j]
      if (b.state === 'DISABLED') continue
      const aStatic = a.state === 'PARKED'
      const bStatic = b.state === 'PARKED'
      if (aStatic && bStatic) continue
      const aSpec = vehicleSpec(a.kind)
      const bSpec = vehicleSpec(b.kind)
      const contact = rectContact(a.pose, aSpec, b.pose, bSpec)
      if (contact === null) continue

      if (aStatic) {
        b.motion.speed = b.motion.speed * bSpec.collisionSpeedKeep
        b.motion.lateral = 0
        separateFromStatic(b, contact)
        hitIds.add(b.id)
      } else if (bStatic) {
        a.motion.speed = a.motion.speed * aSpec.collisionSpeedKeep
        a.motion.lateral = 0
        separateFromStatic(a, contact)
        hitIds.add(a.id)
      } else {
        const aKeep = a.motion.speed * aSpec.collisionSpeedKeep
        const bKeep = b.motion.speed * bSpec.collisionSpeedKeep
        a.motion.speed = aKeep
        b.motion.speed = bKeep
        a.motion.lateral = 0
        b.motion.lateral = 0
        // Full-depth separation, half each side along the contact axis.
        const half = contact.depth / 2
        a.pose.pos.x -= contact.axis.x * half
        a.pose.pos.z -= contact.axis.z * half
        b.pose.pos.x += contact.axis.x * half
        b.pose.pos.z += contact.axis.z * half
        hitIds.add(a.id)
        hitIds.add(b.id)
      }
    }
  }
  return [...hitIds]
}

/** Push a moving vehicle out of a static one by the full contact depth. */
function separateFromStatic(
  moving: VehicleEntity,
  contact: RectContact,
): void {
  moving.pose.pos.x -= contact.axis.x * (contact.depth + 0.02)
  moving.pose.pos.z -= contact.axis.z * (contact.depth + 0.02)
}

/**
 * Traffic director: an owned parked car abandoned far from the player for
 * long enough returns to the loop through the explicit
 * `PARKED → AI_CONTROLLED` transition. This is the "return it safely to AI"
 * path required by Phase 3A.
 */
export function updateTrafficDirector(
  registry: VehicleRegistry,
  playerPos: Vec3,
  dt: number,
  clocks: Map<number, number>,
  returnDistance = 200,
  returnDelay = 20,
): number[] {
  const returned: number[] = []
  for (const entity of registry.vehicles.values()) {
    if (!entity.owned || entity.state !== 'PARKED') continue
    if (registry.playerVehicleId === entity.id) continue
    const dx = entity.pose.pos.x - playerPos.x
    const dz = entity.pose.pos.z - playerPos.z
    const dist = Math.hypot(dx, dz)
    const clock = (clocks.get(entity.id) ?? 0) + (dist > returnDistance ? dt : -dt)
    clocks.set(entity.id, Math.max(0, clock))
    if (clock >= returnDelay) {
      const transition = transitionVehicle(registry, entity.id, 'AI_CONTROLLED')
      if (transition.ok) {
        entity.owned = false
        const lane = BOULEVARD_LOOP
        const sample = nearestLanePoint(lane, entity.pose.pos.x, entity.pose.pos.z)
        entity.ai!.distance = sample.distance
        entity.ai!.targetSpeed = lane.speedLimit * 0.8
        returned.push(entity.id)
        clocks.delete(entity.id)
      }
    }
  }
  return returned
}