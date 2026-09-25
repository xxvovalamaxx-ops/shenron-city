/**
 * The player's vehicle session: enter prompt, carjacks, transitions,
 * driving, collisions, exit validation, parking and the per-frame
 * orchestration of every subsystem.
 *
 * `stepVehicleSim` is the one pure function the game loop calls for the
 * whole vehicle world — player car, the cars the player has touched, the
 * nearby traffic snapshot, camera. It owns the authoritative player pose
 * while a vehicle session is active; the game loop mirrors it to
 * `rt.player` and back. Because the step is pure and uses a fixed substep,
 * replaying an identical recorded input stream (and traffic snapshot)
 * reproduces position, heading, speed and the event stream exactly (see
 * docs/phase3/PHASE3A.md for the documented tolerances).
 *
 * Two configurations share the code:
 * - `createVehicleSim` builds the Phase 3A boulevard world (a hand-authored
 *   loop with AI cars and two crossers) that the tests and the replay gate
 *   use as a hermetic arena.
 * - `createLiveVehicleSim` is the game: no placeholder loop, no box
 *   pedestrians. Ambient traffic comes from the LION road graph through
 *   {@link VehicleSimState.traffic}; any of those cars can be taken.
 */
import type { Vec3 } from '../collision'
import {
  applyVelocity,
  isStationary,
  motionVelocity,
  stepLooseVehicle,
  stepVehicle,
  vehicleForward,
  type VehicleInput,
  type VehicleMotion,
  type VehiclePose,
} from './vehicle-model'
import { vehicleSpec } from './vehicle-specs'
import { BOULEVARD_LOOP, nearestLanePoint, type Lane } from './vehicle-lanes'
import {
  ENTER_PROMPT_RADIUS,
  nearestEnterableDoor,
  parkedMotion,
  seatWorld,
  spawnVehicle,
  transitionVehicle,
  vehicleDoors,
  exitCandidates,
  createRegistry,
  type VehicleEntity,
  type VehicleRegistry,
} from './vehicle-entities'
import {
  vehiclePedestrianResponse,
  type Pedestrian,
  type VehicleWorld,
} from './vehicle-collision'
import { stepAiVehicle, updatePedestrians, updateTrafficDirector, resolveVehiclePairs } from './vehicle-traffic'
import {
  computeVehicleCamera,
  easeVehicleCamera,
  initialVehicleCamera,
  kickVehicleCamera,
  type VehicleCameraMode,
  type VehicleCameraState,
} from './vehicle-camera'
import { createDefaultLayout } from './vehicle-entities'
import { contactImpulse } from './vehicle-impulse'
import {
  JACK_MAX_SPEED,
  entityBody,
  integrateKnockedView,
  updateParkedCars,
  viewBody,
  type TrafficCarView,
} from './vehicle-world-link'

export const ENTER_DURATION = 0.6
export const EXIT_DURATION = 0.45
export const HORN_DURATION = 0.45
export const VEHICLE_SUBSTEP = 1 / 120
/** Closing speeds below this are scrapes, not crashes (no event), m/s. */
export const IMPACT_EVENT_SPEED = 0.6

/** Player input for one fixed step. Edge flags are true for exactly one step. */
export interface PlayerVehicleInput {
  throttle: number
  brake: number
  steer: number
  handbrake: boolean
  /** Edge: pressed this step. */
  horn: boolean
  /** Edge: pressed this step. */
  interact: boolean
  /** Held: swing the chase camera round to look backwards. */
  lookBehind?: boolean
  /** Held: the horn sounds for as long as this is down (audio only). */
  hornHeld?: boolean
}

export const NO_VEHICLE_INPUT: PlayerVehicleInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  horn: false,
  interact: false,
  lookBehind: false,
  hornHeld: false,
}

export type SimEvent =
  | { type: 'enter'; vehicleId: number }
  | { type: 'exit'; vehicleId: number }
  | { type: 'exit-blocked'; vehicleId: number }
  | { type: 'horn'; vehicleId: number }
  | { type: 'collision-world'; vehicleId: number; impact?: number }
  | { type: 'collision-vehicle'; vehicleId: number; impact?: number }
  | { type: 'collision-traffic'; vehicleId: number; trafficId: number; impact: number }
  | { type: 'collision-pedestrian'; vehicleId: number; pedestrianId: number }
  | { type: 'return-to-ai'; vehicleId: number }
  | { type: 'promote'; vehicleId: number; trafficId: number }
  | { type: 'despawn'; vehicleId: number }
  | { type: 'prompt'; label: string | null }

export interface Transition {
  vehicleId: number
  phase: 'entering' | 'exiting'
  t: number
  duration: number
  from: Vec3
  to: Vec3
  /** Final exit placement, used when the transition completes. */
  exitSpot: Vec3 | null
}

export interface VehicleSimConfig {
  /** The Phase 3A boulevard loop: AI cars circulate and abandoned owned
   * cars are returned to it. Off in the live game. */
  boulevard: boolean
}

export interface VehiclePrompt {
  /** Session entity to enter, or -1 for a traffic car. */
  vehicleId: number
  /** Traffic car to jack, when the prompt came from the traffic snapshot. */
  trafficId: number | null
  label: string
}

export interface VehicleSimState {
  config: VehicleSimConfig
  registry: VehicleRegistry
  lane: Lane
  /** Authoritative player pose while a vehicle session is active. */
  player: {
    pos: Vec3
    forward: { x: number; z: number }
    velocityY: number
    grounded: boolean
  }
  /** False while the avatar is attached to a seat or mid-transition. */
  playerVisible: boolean
  transition: Transition | null
  /** Current enter prompt, recomputed every step. */
  prompt: VehiclePrompt | null
  cameraMode: VehicleCameraMode
  camera: VehicleCameraState
  /** Seconds of horn remaining, for visuals/audio. */
  hornTimer: number
  headlightsOn: boolean
  /** Events produced by the last step, in order. */
  events: SimEvent[]
  returnClocks: Map<number, number>
  parkClocks: Map<number, number>
  pedestrians: Pedestrian[]
  /** Nearby ambient traffic, replaced by the game loop every frame. */
  traffic: TrafficCarView[]
  simTime: number
  /** True once the player has actually driven a vehicle this session; gates
   * whether the owned car is persisted into the save file. */
  ownedPersisted: boolean
}

function baseSim(config: VehicleSimConfig, registry: VehicleRegistry, lane: Lane, pedestrians: Pedestrian[]): VehicleSimState {
  return {
    config,
    registry,
    lane,
    player: {
      pos: { x: 0, y: 0, z: 0 },
      forward: { x: 0, z: -1 },
      velocityY: 0,
      grounded: true,
    },
    playerVisible: true,
    transition: null,
    prompt: null,
    cameraMode: 'chase',
    camera: initialVehicleCamera(),
    hornTimer: 0,
    headlightsOn: true,
    events: [],
    returnClocks: new Map(),
    parkClocks: new Map(),
    pedestrians,
    traffic: [],
    simTime: 0,
    ownedPersisted: false,
  }
}

/** The Phase 3A boulevard arena (tests, replay). */
export function createVehicleSim(budget?: number): VehicleSimState {
  const { registry, lane } = createDefaultLayout(budget)
  return baseSim({ boulevard: true }, registry, lane, defaultPedestrians())
}

/** The live game: an empty session fed by the LION traffic snapshot. */
export function createLiveVehicleSim(): VehicleSimState {
  return baseSim({ boulevard: false }, createRegistry(), BOULEVARD_LOOP, [])
}

/** A clean registry for tests and replays that want an exact arena. */
export function emptyRegistry(): VehicleRegistry {
  return { vehicles: new Map(), nextId: 1, playerVehicleId: null }
}

/**
 * Park a car for the player (the starter car near the spawn, a dev spawn).
 * The session never owns more than one car; `owned` marks the one kept in
 * the save and exempt from the parking rules.
 */
export function placeParkedCar(
  sim: VehicleSimState,
  kind: string,
  pose: VehiclePose,
  paint: number | null,
  options: { owned?: boolean; origin?: VehicleEntity['origin'] } = {},
): VehicleEntity {
  const entity = spawnVehicle(sim.registry, kind, { pos: { ...pose.pos }, heading: pose.heading }, 'PARKED', parkedMotion())
  entity.paint = paint
  entity.origin = options.origin ?? 'spawn'
  if (options.owned) {
    for (const other of sim.registry.vehicles.values()) other.owned = false
    entity.owned = true
  }
  return entity
}

// ── Pedestrians ──────────────────────────────────────────────────────────────

/**
 * Two deterministic crossers on the boulevard loop, at quarter distances,
 * walking perpendicular to the lane and bouncing within a bound. Their whole
 * behaviour is a pure function of elapsed time.
 */
export function defaultPedestrians(): Pedestrian[] {
  const lane = BOULEVARD_LOOP
  const crossers: Pedestrian[] = []
  const quarter = laneDistanceAt(lane, 0.25)
  const threeQuarter = laneDistanceAt(lane, 0.75)
  for (const [index, distance] of [quarter, threeQuarter].entries()) {
    const sample = nearestLanePoint(lane, distance.point.x, distance.point.z)
    const heading = sample.heading
    const dir = { x: Math.cos(heading), z: -Math.sin(heading) }
    crossers.push({
      id: index + 1,
      pos: { x: sample.point.x + dir.x * 4, y: 0, z: sample.point.z + dir.z * 4 },
      radius: 0.3,
      displaced: false,
      downTimer: 0,
      dir,
      speed: 1.2,
      anchor: { x: sample.point.x, y: 0, z: sample.point.z },
      offset: 4,
      bound: 4,
    })
  }
  return crossers
}

function laneDistanceAt(lane: Lane, fraction: number): { point: { x: number; z: number } } {
  const n = lane.points.length
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = lane.points[i]
    const b = lane.points[(i + 1) % n]
    total += Math.hypot(b.x - a.x, b.z - a.z)
  }
  const target = total * fraction
  let travelled = 0
  for (let i = 0; i < n; i++) {
    const a = lane.points[i]
    const b = lane.points[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (travelled + len >= target || i === n - 1) {
      const t = len > 1e-9 ? (target - travelled) / len : 0
      return { point: { x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) } }
    }
    travelled += len
  }
  return { point: { ...lane.points[0] } }
}

// ── Exit placement validation ────────────────────────────────────────────────

/**
 * Find a legal exit spot for the given vehicle: a candidate at one of its
 * doors that is on solid ground, clear of world obstacles and not inside
 * another vehicle (session or traffic). Returns null when the player is
 * boxed in.
 */
export function findExitSpot(
  sim: VehicleSimState,
  world: VehicleWorld,
  vehicleId: number,
): Vec3 | null {
  const entity = sim.registry.vehicles.get(vehicleId)
  if (!entity) return null
  const spec = vehicleSpec(entity.kind)
  const pose = entity.pose
  const ground = world.groundHeightAt(pose.pos.x, pose.pos.z)
  if (ground === null) return null

  // Driver's door first (the left, index 1), then the passenger side.
  const doors = vehicleDoors(spec, pose)
  const ordered = doors.length > 1 ? [doors[1], doors[0], ...doors.slice(2)] : doors
  for (const door of ordered) {
    for (const candidate of exitCandidates(pose, door)) {
      if (!spotIsClear(sim, world, candidate, ground)) continue
      return { ...candidate, y: ground }
    }
  }
  return null
}

function insideFootprint(
  px: number,
  pz: number,
  pos: { x: number; z: number },
  heading: number,
  halfLength: number,
  halfWidth: number,
  margin: number,
): boolean {
  const f = vehicleForward(heading)
  const r = { x: -f.z, z: f.x }
  const dx = px - pos.x
  const dz = pz - pos.z
  const along = Math.abs(dx * f.x + dz * f.z)
  const across = Math.abs(dx * r.x + dz * r.z)
  return along < halfLength + margin && across < halfWidth + margin
}

function spotIsClear(
  sim: VehicleSimState,
  world: VehicleWorld,
  spot: Vec3,
  ground: number,
): boolean {
  const probe = { ...spot, y: ground + 1 }
  if (!world.isCircleClear(probe.x, probe.z, 0.55)) return false
  if (Math.abs((world.groundHeightAt(probe.x, probe.z) ?? ground) - ground) > 0.6) return false
  for (const other of sim.registry.vehicles.values()) {
    if (other.state === 'DISABLED') continue
    const spec = vehicleSpec(other.kind)
    if (insideFootprint(probe.x, probe.z, other.pose.pos, other.pose.heading, spec.halfLength, spec.halfWidth, 0.5)) {
      return false
    }
  }
  for (const view of sim.traffic) {
    const spec = vehicleSpec(view.kind)
    if (insideFootprint(probe.x, probe.z, view, view.heading, spec.halfLength, spec.halfWidth, 0.5)) return false
  }
  return true
}

// ── The step ─────────────────────────────────────────────────────────────────

/**
 * Advance the whole vehicle world by `dt` (already fixed; callers that get
 * variable frames subdivide to {@link VEHICLE_SUBSTEP}). `clockHour` drives
 * the headlights (night lighting), `cameraMode` selects chase/cockpit.
 */
export function stepVehicleSim(
  sim: VehicleSimState,
  world: VehicleWorld,
  input: PlayerVehicleInput,
  dt: number,
  clockHour: number,
): SimEvent[] {
  sim.events.length = 0
  sim.simTime += dt
  sim.headlightsOn = clockHour < 6.5 || clockHour >= 18.5

  // ── Pedestrians walk ────────────────────────────────────────────────────
  if (sim.pedestrians.length > 0) sim.pedestrians = updatePedestrians(sim.pedestrians, dt)

  // ── Player transitions ──────────────────────────────────────────────────
  if (sim.transition) {
    const transition = sim.transition
    transition.t += dt
    // Climbing into a car that is still rolling: the seat moves with it.
    if (transition.phase === 'entering') {
      const target = sim.registry.vehicles.get(transition.vehicleId)
      if (target) transition.to = seatWorld(vehicleSpec(target.kind), target.pose)
    }
    const t = Math.min(1, transition.t / transition.duration)
    const eased = t * t * (3 - 2 * t)
    const pos = sim.player.pos
    pos.x = transition.from.x + (transition.to.x - transition.from.x) * eased
    pos.z = transition.from.z + (transition.to.z - transition.from.z) * eased
    pos.y = transition.from.y + (transition.to.y - transition.from.y) * eased

    if (transition.t >= transition.duration) {
      sim.player.pos = { ...transition.to }
      sim.transition = null
      if (transition.phase === 'entering') {
        const result = transitionVehicle(sim.registry, transition.vehicleId, 'PLAYER_CONTROLLED')
        if (!result.ok) sim.events.push({ type: 'prompt', label: 'Could not enter' })
        else sim.events.push({ type: 'enter', vehicleId: transition.vehicleId })
      } else {
        const result = transitionVehicle(sim.registry, transition.vehicleId, 'PARKED')
        if (!result.ok) {
          // The machine refuses; keep the player seated rather than orphaned.
          transitionVehicle(sim.registry, transition.vehicleId, 'PLAYER_CONTROLLED')
        } else {
          sim.playerVisible = true
          if (transition.exitSpot) sim.player.pos = { ...transition.exitSpot }
          sim.events.push({ type: 'exit', vehicleId: transition.vehicleId })
        }
      }
    }
  }

  const playerVehicle = sim.registry.playerVehicleId
    ? sim.registry.vehicles.get(sim.registry.playerVehicleId) ?? null
    : null

  // ── Player driving ──────────────────────────────────────────────────────
  if (playerVehicle && playerVehicle.state === 'PLAYER_CONTROLLED') {
    drivePlayerVehicle(sim, world, input, dt)
  }

  // ── Cars nobody is driving slide to rest ────────────────────────────────
  stepLooseVehicles(sim, world, dt)

  // ── AI traffic (the boulevard arena) ────────────────────────────────────
  stepTraffic(sim, world, dt)

  // ── Knocked traffic cars keep sliding within the frame ──────────────────
  for (const view of sim.traffic) {
    if (view.hit) integrateKnockedView(view, dt)
  }

  // ── Session cars vs the traffic snapshot ────────────────────────────────
  resolveTrafficContacts(sim)

  // ── Vehicle vs vehicle ──────────────────────────────────────────────────
  const hits = resolveVehiclePairs(sim.registry)
  for (const hit of hits) {
    sim.events.push({ type: 'collision-vehicle', vehicleId: hit.id, impact: hit.impact })
    if (hit.id === sim.registry.playerVehicleId) kickVehicleCamera(sim.camera, hit.impact)
  }

  // ── Pedestrians vs moving vehicles ──────────────────────────────────────
  if (sim.pedestrians.length > 0) {
    const reportedPeds = new Set<number>()
    for (const entity of sim.registry.vehicles.values()) {
      if (entity.state !== 'PLAYER_CONTROLLED' && entity.state !== 'AI_CONTROLLED') continue
      const spec = vehicleSpec(entity.kind)
      const result = vehiclePedestrianResponse(
        entity.pose,
        spec,
        sim.pedestrians,
        dt,
        entity.motion.speed,
      )
      sim.pedestrians = result.pedestrians
      entity.motion.speed = result.speed
      if (result.hits > 0) {
        for (const ped of sim.pedestrians) {
          if (ped.displaced && !reportedPeds.has(ped.id)) {
            reportedPeds.add(ped.id)
            sim.events.push({ type: 'collision-pedestrian', vehicleId: entity.id, pedestrianId: ped.id })
          }
        }
      }
    }
  }

  // ── Enter prompt + entry (and carjacks) ─────────────────────────────────
  updateEnterPrompt(sim, world)
  if (!playerVehicle && sim.prompt && input.interact) {
    let target: VehicleEntity | null = null
    if (sim.prompt.trafficId !== null) {
      const view = sim.traffic.find((candidate) => candidate.id === sim.prompt!.trafficId)
      if (view) target = promoteTrafficCar(sim, view)
    } else {
      target = sim.registry.vehicles.get(sim.prompt.vehicleId) ?? null
    }
    if (target) {
      const result = transitionVehicle(sim.registry, target.id, 'ENTERING')
      if (result.ok) {
        const spec = vehicleSpec(target.kind)
        sim.playerVisible = false
        sim.ownedPersisted = true
        sim.transition = {
          vehicleId: target.id,
          phase: 'entering',
          t: 0,
          duration: ENTER_DURATION,
          from: { ...sim.player.pos },
          to: seatWorld(spec, target.pose),
          exitSpot: null,
        }
        sim.prompt = null
        sim.events.push({ type: 'prompt', label: null })
      }
    }
  }

  // ── Abandoned cars ──────────────────────────────────────────────────────
  if (sim.config.boulevard) {
    // Only cars the player has actually driven are reclaimable — the
    // untouched default car stays parked where the player can find it.
    const returned = sim.ownedPersisted
      ? updateTrafficDirector(sim.registry, sim.player.pos, dt, sim.returnClocks)
      : []
    for (const id of returned) {
      sim.events.push({ type: 'return-to-ai', vehicleId: id })
    }
  }
  for (const id of updateParkedCars(sim.registry, sim.player.pos, dt, sim.parkClocks)) {
    sim.events.push({ type: 'despawn', vehicleId: id })
  }

  // ── Camera ──────────────────────────────────────────────────────────────
  updateCamera(sim, world, dt, input)

  return sim.events
}

/**
 * Carjack: take a traffic car into the session at its exact pose and
 * velocity. The caller removes it from traffic on the `promote` event.
 */
export function promoteTrafficCar(sim: VehicleSimState, view: TrafficCarView): VehicleEntity {
  const motion: VehicleMotion = { ...parkedMotion(), braking: true }
  const entity = spawnVehicle(
    sim.registry,
    view.kind,
    { pos: { x: view.x, y: view.y, z: view.z }, heading: view.heading },
    'AI_CONTROLLED',
    motion,
  )
  applyVelocity(view.heading, entity.motion, view.vx, view.vz)
  entity.paint = view.paint
  entity.origin = 'traffic'
  entity.spin = view.yawRate
  sim.traffic = sim.traffic.filter((candidate) => candidate.id !== view.id)
  sim.events.push({ type: 'promote', vehicleId: entity.id, trafficId: view.id })
  return entity
}

function drivePlayerVehicle(
  sim: VehicleSimState,
  world: VehicleWorld,
  input: PlayerVehicleInput,
  dt: number,
): void {
  const entity = sim.registry.vehicles.get(sim.registry.playerVehicleId!)!
  const spec = vehicleSpec(entity.kind)

  if (input.horn && sim.hornTimer <= 0) {
    sim.hornTimer = HORN_DURATION
    sim.events.push({ type: 'horn', vehicleId: entity.id })
  }
  if (sim.hornTimer > 0) sim.hornTimer = Math.max(0, sim.hornTimer - dt)

  // Exit request — validated before the state leaves PLAYER_CONTROLLED.
  if (input.interact) {
    const spot = findExitSpot(sim, world, entity.id)
    if (spot === null) {
      sim.events.push({ type: 'exit-blocked', vehicleId: entity.id })
    } else {
      const result = transitionVehicle(sim.registry, entity.id, 'EXITING')
      if (result.ok) {
        sim.transition = {
          vehicleId: entity.id,
          phase: 'exiting',
          t: 0,
          duration: EXIT_DURATION,
          from: seatWorld(spec, entity.pose),
          to: spot,
          exitSpot: spot,
        }
      }
      return
    }
  }

  const vehicleInput: VehicleInput = {
    throttle: input.throttle,
    brake: input.brake,
    steer: input.steer,
    handbrake: input.handbrake,
  }
  const groundY = world.groundHeightAt(entity.pose.pos.x, entity.pose.pos.z)
  const before = { ...entity.pose }
  const speedBefore = entity.motion.speed
  const stepped = stepVehicle(spec, entity.pose, entity.motion, vehicleInput, dt, groundY)
  entity.pose = stepped.pose
  entity.motion = stepped.motion
  // A collision spin fades out of the player's heading.
  if (entity.spin !== 0) {
    entity.pose.heading += entity.spin * dt
    entity.spin *= Math.exp(-6 * dt)
    if (Math.abs(entity.spin) < 1e-3) entity.spin = 0
  }

  // World collision: sweep, bleed speed on hard contact.
  const dx = entity.pose.pos.x - before.pos.x
  const dz = entity.pose.pos.z - before.pos.z
  const radius = spec.halfWidth * 0.85
  const moved = world.moveCircle(before.pos, dx, dz, radius)
  const travelled = Math.hypot(moved.x - before.pos.x, moved.z - before.pos.z)
  const intended = Math.hypot(dx, dz)
  if (intended > 1e-4 && travelled < intended * 0.99) {
    const keep = spec.collisionSpeedKeep
    const ratio = Math.max(0, Math.min(1, travelled / intended))
    entity.motion.speed *= keep + (1 - keep) * ratio
    entity.motion.lateral = 0
    entity.pose.pos.x = moved.x
    entity.pose.pos.z = moved.z
    if (groundY !== null) entity.pose.pos.y = groundY
    const impact = Math.abs(speedBefore - entity.motion.speed)
    sim.events.push({ type: 'collision-world', vehicleId: entity.id, impact })
    kickVehicleCamera(sim.camera, impact)
  }

  // The player's body rides the seat.
  const seat = seatWorld(spec, entity.pose)
  sim.player.pos = seat
  sim.player.forward = vehicleForward(entity.pose.heading)
  sim.player.velocityY = 0
  sim.player.grounded = true
  sim.playerVisible = false
}

/**
 * Parked cars that were shoved, and a jacked car still rolling while the
 * player climbs in, slide to rest against tyre scrub and the world.
 */
function stepLooseVehicles(sim: VehicleSimState, world: VehicleWorld, dt: number): void {
  for (const entity of sim.registry.vehicles.values()) {
    const loose =
      entity.state === 'PARKED' ||
      entity.state === 'ENTERING' ||
      entity.state === 'EXITING' ||
      (entity.state === 'AI_CONTROLLED' && !entity.ai)
    if (!loose) continue
    const m = entity.motion
    if (m.speed === 0 && m.lateral === 0 && entity.spin === 0) continue
    const spec = vehicleSpec(entity.kind)
    const groundY = world.groundHeightAt(entity.pose.pos.x, entity.pose.pos.z)
    const before = entity.pose.pos
    const stepped = stepLooseVehicle(spec, entity.pose, entity.motion, dt, groundY)
    const dx = stepped.pose.pos.x - before.x
    const dz = stepped.pose.pos.z - before.z
    const moved = world.moveCircle(before, dx, dz, spec.halfWidth * 0.85)
    entity.pose = { pos: { ...stepped.pose.pos, x: moved.x, z: moved.z }, heading: stepped.pose.heading + entity.spin * dt }
    entity.motion = stepped.motion
    entity.spin *= Math.exp(-3 * dt)
    if (Math.abs(entity.spin) < 1e-3) entity.spin = 0
  }
}

/**
 * The session's moving cars against the traffic snapshot. The traffic car
 * takes the impulse into its view (velocity and spin) and is marked hit; the
 * session car is pushed out and loses what the impulse took.
 */
function resolveTrafficContacts(sim: VehicleSimState): void {
  if (sim.traffic.length === 0) return
  const ids = [...sim.registry.vehicles.keys()].sort((a, b) => a - b)
  for (const id of ids) {
    const entity = sim.registry.vehicles.get(id)!
    if (entity.state === 'DISABLED') continue
    const moving = !isStationary(entity.motion, 0.05) || entity.state === 'PLAYER_CONTROLLED'
    for (const view of sim.traffic) {
      if (!moving && !view.hit) continue
      const a = entityBody(entity)
      const b = viewBody(view)
      // Parked cars have the handbrake on: they resist like a heavier body.
      if (entity.state === 'PARKED') a.mass *= 1.6
      const hit = contactImpulse(a, b)
      if (!hit) continue
      entity.pose.pos.x += hit.pushA.x
      entity.pose.pos.z += hit.pushA.z
      view.x += hit.pushB.x
      view.z += hit.pushB.z
      if (hit.closingSpeed <= 0) continue
      const v = motionVelocity(entity.pose.heading, entity.motion)
      applyVelocity(entity.pose.heading, entity.motion, v.x + hit.dvA.x, v.z + hit.dvA.z)
      view.vx += hit.dvB.x
      view.vz += hit.dvB.z
      view.yawRate += hit.dwB
      if (entity.state !== 'PLAYER_CONTROLLED') entity.spin += hit.dwA
      view.hit = true
      if (hit.closingSpeed >= IMPACT_EVENT_SPEED) {
        sim.events.push({ type: 'collision-traffic', vehicleId: entity.id, trafficId: view.id, impact: hit.closingSpeed })
        if (entity.id === sim.registry.playerVehicleId) kickVehicleCamera(sim.camera, hit.closingSpeed)
      }
    }
  }
}

function stepTraffic(sim: VehicleSimState, world: VehicleWorld, dt: number): void {
  const registry = sim.registry
  for (const entity of registry.vehicles.values()) {
    if (entity.state !== 'AI_CONTROLLED' || !entity.ai) continue
    const lane = entity.ai.laneId === sim.lane.id ? sim.lane : BOULEVARD_LOOP
    const leaders = collectLaneLeaders(sim, entity, lane)
    const result = stepAiVehicle(entity, world, dt, leaders, sim.pedestrians)
    if (result.collisionsWorld) {
      sim.events.push({ type: 'collision-world', vehicleId: entity.id })
    }
  }
}

function collectLaneLeaders(
  sim: VehicleSimState,
  self: VehicleEntityLike,
  lane: Lane,
): Array<{ pose: VehiclePose; speed: number }> {
  const leaders: Array<{ pose: VehiclePose; speed: number }> = []
  const selfDistance = self.ai?.distance ?? 0
  for (const other of sim.registry.vehicles.values()) {
    if (other.id === self.id) continue
    if (other.state === 'DISABLED' || other.state === 'PARKED') continue
    const otherDistance = other.ai
      ? other.ai.laneId === lane.id
        ? other.ai.distance
        : nearestLanePoint(lane, other.pose.pos.x, other.pose.pos.z).distance
      : nearestLanePoint(lane, other.pose.pos.x, other.pose.pos.z).distance
    let gap = otherDistance - selfDistance
    if (lane.loop) {
      const length = laneTotalLength(lane)
      if (gap < 0) gap += length
    }
    if (gap > 0 && gap < 40) {
      leaders.push({ pose: other.pose, speed: other.motion.speed })
    }
  }
  return leaders
}

interface VehicleEntityLike {
  id: number
  ai: { laneId: string; distance: number } | null
}

function laneTotalLength(lane: Lane): number {
  const n = lane.points.length
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = lane.points[i]
    const b = lane.points[(i + 1) % n]
    total += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return total
}

function updateEnterPrompt(sim: VehicleSimState, world: VehicleWorld): void {
  if (sim.registry.playerVehicleId !== null) {
    if (sim.prompt) {
      sim.prompt = null
      sim.events.push({ type: 'prompt', label: null })
    }
    return
  }
  let best: VehiclePrompt | null = null
  let bestDist = ENTER_PROMPT_RADIUS
  for (const entity of sim.registry.vehicles.values()) {
    if (entity.state !== 'PARKED') {
      if (entity.state !== 'AI_CONTROLLED' || !isStationary(entity.motion, 0.2)) continue
    }
    const spec = vehicleSpec(entity.kind)
    const door = nearestEnterableDoor(spec, entity.pose, sim.player.pos)
    if (!door) continue
    if (!world.isCircleClear(door.world.x, door.world.z, 0.7)) continue
    if (doorBlockedByVehicle(sim, door.world, entity.id)) continue
    const dist = Math.hypot(
      door.world.x - sim.player.pos.x,
      door.world.z - sim.player.pos.z,
    )
    if (dist < bestDist) {
      bestDist = dist
      best = {
        vehicleId: entity.id,
        trafficId: null,
        label: `Press E to enter the ${spec.label}`,
      }
    }
  }
  for (const view of sim.traffic) {
    if (Math.abs(view.speed) > JACK_MAX_SPEED) continue
    const spec = vehicleSpec(view.kind)
    const pose = { pos: { x: view.x, y: view.y, z: view.z }, heading: view.heading }
    const door = nearestEnterableDoor(spec, pose, sim.player.pos)
    if (!door) continue
    if (!world.isCircleClear(door.world.x, door.world.z, 0.5)) continue
    const dist = Math.hypot(door.world.x - sim.player.pos.x, door.world.z - sim.player.pos.z)
    if (dist < bestDist) {
      bestDist = dist
      best = {
        vehicleId: -1,
        trafficId: view.id,
        label: `Press E to take the ${spec.label}`,
      }
    }
  }

  const previous = sim.prompt?.label ?? null
  const next = best?.label ?? null
  if (previous !== next) {
    sim.events.push({ type: 'prompt', label: next })
  }
  sim.prompt = best
}

function doorBlockedByVehicle(sim: VehicleSimState, door: Vec3, excludeId: number): boolean {
  for (const other of sim.registry.vehicles.values()) {
    if (other.id === excludeId) continue
    if (other.state === 'DISABLED') continue
    const spec = vehicleSpec(other.kind)
    if (insideFootprint(door.x, door.z, other.pose.pos, other.pose.heading, spec.halfLength, spec.halfWidth, 0.45)) {
      return true
    }
  }
  return false
}

function updateCamera(sim: VehicleSimState, world: VehicleWorld, dt: number, input: PlayerVehicleInput): void {
  const entity = sim.registry.playerVehicleId
    ? sim.registry.vehicles.get(sim.registry.playerVehicleId)
    : null
  if (!entity) {
    // Next time the player gets in, the rig snaps behind the new car.
    if (sim.camera.initialized) sim.camera = initialVehicleCamera()
    return
  }
  const spec = vehicleSpec(entity.kind)
  const frame = computeVehicleCamera(entity.pose, spec, sim.cameraMode, sim.camera, world, dt, entity.motion, {
    lookBehind: input.lookBehind ?? false,
  })
  sim.camera = easeVehicleCamera(sim.camera, frame, dt)
}

// ── Persistence helpers (used by the save adapter) ───────────────────────────

export interface SavedVehicle {
  kind: string
  pos: Vec3
  heading: number
}

/**
 * Snapshot of the player's car for the save file. Null when the player owns
 * nothing (a fresh session with the default layout owns the spawn car — see
 * createDefaultLayout — but ownership only enters the save once the player
 * has actually touched the vehicle or parked it somewhere custom).
 */
export function snapshotOwnedVehicle(sim: VehicleSimState): SavedVehicle | null {
  if (!sim.ownedPersisted) return null
  const entity = [...sim.registry.vehicles.values()].find((candidate) => candidate.owned) ?? null
  if (!entity) return null
  return {
    kind: entity.kind,
    pos: { ...entity.pose.pos },
    heading: entity.pose.heading,
  }
}

/**
 * Restore an owned car from a save: rebuild the session's layout (the
 * boulevard arena, or an empty live world), park the saved car and stand
 * the player at its door. Purely geometric — no world probe, because loading
 * happens before the island surface exists; the position was valid when it
 * was saved.
 */
export function restoreOwnedVehicle(sim: VehicleSimState, saved: SavedVehicle | null): void {
  if (sim.config.boulevard) {
    const { registry, lane } = createDefaultLayout(undefined)
    sim.registry = registry
    sim.lane = lane
    sim.pedestrians = defaultPedestrians()
  } else {
    sim.registry = createRegistry()
    sim.pedestrians = []
  }
  sim.transition = null
  sim.prompt = null
  sim.returnClocks = new Map()
  sim.parkClocks = new Map()
  sim.hornTimer = 0
  sim.traffic = []

  if (!saved) return

  let entity = [...sim.registry.vehicles.values()].find((candidate) => candidate.owned) ?? null
  if (entity) {
    entity.kind = saved.kind
    entity.pose = { pos: { ...saved.pos }, heading: saved.heading }
    entity.motion = parkedMotion()
  } else {
    entity = placeParkedCar(sim, saved.kind, { pos: saved.pos, heading: saved.heading }, null, {
      owned: true,
      origin: 'layout',
    })
  }
  const spec = vehicleSpec(entity.kind)
  const door = nearestEnterableDoor(spec, entity.pose, entity.pose.pos)
  if (door) {
    const f = { x: Math.sin(entity.pose.heading), z: Math.cos(entity.pose.heading) }
    const out = door.out
    sim.player.pos = {
      x: door.world.x + out.x * 1.7 + f.x * 0.4,
      y: saved.pos.y,
      z: door.world.z + out.z * 1.7 + f.z * 0.4,
    }
  }
  sim.player.forward = vehicleForward(entity.pose.heading)
  sim.playerVisible = true
  sim.ownedPersisted = true
}
