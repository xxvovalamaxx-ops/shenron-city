/**
 * Vehicle entities, the seven-state machine and the deterministic spawn
 * layout.
 *
 * A vehicle is always in exactly one of seven states. Every state change goes
 * through {@link transitionVehicle}, which consults the explicit transition
 * table — the table is the authority on what may happen, and the tests pin it
 * down. The two authority transfers the game actually needs are both first
 * class:
 *
 * - AI → player: `AI_CONTROLLED → ENTERING → PLAYER_CONTROLLED`. The player
 *   may take an AI vehicle that has slowed to a stop near them; the AI state
 *   is dropped at the moment of the transfer.
 * - player → AI: `PLAYER_CONTROLLED → EXITING → PARKED`, then
 *   `PARKED → AI_CONTROLLED` when the parked car is left behind long enough
 *   for the traffic director to send it back out. The reverse (player →
 *   AI) never bypasses PARKED.
 *
 * Nothing in this module touches a renderer. The spawn layout is seeded so
 * every run — and every replay — starts from the same world.
 */
import type { Vec3 } from '../collision'
import { localToWorld, type VehicleMotion, type VehiclePose, type VehicleSpec } from './vehicle-model'
import { SPAWN_KINDS } from './vehicle-specs'
import { BOULEVARD_LOOP, laneLength, nearestLanePoint, pointAlongLane, type Lane } from './vehicle-lanes'
import { MANHATTAN_SPAWN_POINT } from '../../world/manhattan-collision'

export type VehicleState =
  | 'UNAVAILABLE'
  | 'PARKED'
  | 'ENTERING'
  | 'PLAYER_CONTROLLED'
  | 'EXITING'
  | 'AI_CONTROLLED'
  | 'DISABLED'

export const VEHICLE_STATES: readonly VehicleState[] = [
  'UNAVAILABLE',
  'PARKED',
  'ENTERING',
  'PLAYER_CONTROLLED',
  'EXITING',
  'AI_CONTROLLED',
  'DISABLED',
]

/** State machine. Read-only; `transitionVehicle` is the only writer. */
export const VEHICLE_TRANSITIONS: Readonly<Record<VehicleState, readonly VehicleState[]>> = {
  UNAVAILABLE: ['PARKED', 'AI_CONTROLLED'],
  PARKED: ['ENTERING', 'AI_CONTROLLED'],
  ENTERING: ['PLAYER_CONTROLLED', 'PARKED'],
  PLAYER_CONTROLLED: ['EXITING', 'DISABLED'],
  EXITING: ['PARKED', 'PLAYER_CONTROLLED'],
  AI_CONTROLLED: ['ENTERING', 'PARKED', 'DISABLED'],
  DISABLED: [],
}

export interface AiState {
  laneId: string
  /** Distance along the lane, metres. */
  distance: number
  /** Cruise speed target, m/s. */
  targetSpeed: number
  /** Seconds until the AI stops reacting to a slow leader (released). */
  reactionClock: number
}

export interface VehicleEntity {
  id: number
  kind: string
  state: VehicleState
  controller: 'none' | 'player' | 'ai'
  pose: VehiclePose
  motion: VehicleMotion
  /** The player's car. Persisted across sessions; parked cars may be
   * returned to the AI by the traffic director once abandoned. */
  owned: boolean
  ai: AiState | null
}

export interface VehicleRegistry {
  vehicles: Map<number, VehicleEntity>
  nextId: number
  /** Which entity the player is inside, entering, or exiting. */
  playerVehicleId: number | null
}

export function createRegistry(): VehicleRegistry {
  return { vehicles: new Map(), nextId: 1, playerVehicleId: null }
}

export function getVehicle(registry: VehicleRegistry, id: number): VehicleEntity | null {
  return registry.vehicles.get(id) ?? null
}

// ── Seeded PRNG (deterministic spawn layout) ─────────────────────────────────

/**
 * A tiny LCG. Not cryptographically anything — it only has to make the spawn
 * layout reproducible across runs and platforms, which Math.random does not.
 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function spawnVehicle(
  registry: VehicleRegistry,
  kind: string,
  pose: VehiclePose,
  state: VehicleState,
  motion: VehicleMotion,
): VehicleEntity {
  const entity: VehicleEntity = {
    id: registry.nextId,
    kind,
    state,
    controller: 'none',
    pose,
    motion,
    owned: false,
    ai: null,
  }
  registry.nextId += 1
  registry.vehicles.set(entity.id, entity)
  if (state === 'AI_CONTROLLED') {
    entity.controller = 'ai'
  }
  return entity
}

/**
 * The one explicit state transition. Returns `ok: false` (and a reason) for
 * anything outside the table — the machine never half-applies.
 */
export function transitionVehicle(
  registry: VehicleRegistry,
  id: number,
  to: VehicleState,
): { ok: true } | { ok: false; reason: string } {
  const vehicle = registry.vehicles.get(id)
  if (!vehicle) return { ok: false, reason: `no vehicle ${id}` }
  const allowed = VEHICLE_TRANSITIONS[vehicle.state]
  if (!allowed.includes(to)) {
    return { ok: false, reason: `${vehicle.state} → ${to} is not an allowed transition` }
  }

  const from = vehicle.state
  vehicle.state = to

  if (to === 'ENTERING' || to === 'PLAYER_CONTROLLED') {
    vehicle.controller = 'player'
    vehicle.ai = null
    registry.playerVehicleId = id
    vehicle.owned = true
    vehicle.motion = parkedMotion()
  }
  if (to === 'PARKED' || to === 'EXITING') {
    vehicle.controller = 'none'
    vehicle.motion = parkedMotion()
  }
  if (to === 'AI_CONTROLLED') {
    vehicle.controller = 'ai'
    vehicle.motion = parkedMotion()
    vehicle.ai = {
      laneId: BOULEVARD_LOOP.id,
      distance: 0,
      targetSpeed: BOULEVARD_LOOP.speedLimit,
      reactionClock: 0,
    }
    vehicle.owned = from === 'PLAYER_CONTROLLED' ? vehicle.owned : false
  }
  if (to === 'DISABLED') {
    vehicle.controller = 'none'
  }
  if (from === 'PLAYER_CONTROLLED' || from === 'ENTERING' || from === 'EXITING') {
    if (to !== 'PLAYER_CONTROLLED' && to !== 'ENTERING' && to !== 'EXITING') {
      if (registry.playerVehicleId === id) registry.playerVehicleId = null
    }
  }
  return { ok: true }
}

/** Standstill motion with the parking brake applied (brake lights on). */
export function parkedMotion(): VehicleMotion {
  const m = {
    speed: 0,
    lateral: 0,
    steerAngle: 0,
    wheelSpin: 0,
    braking: true,
    reversing: false,
  }
  return m
}

// ── Doors and exit spots ─────────────────────────────────────────────────────

export const ENTER_PROMPT_RADIUS = 2.1
/** How far out from a door the player is placed on exit, metres. */
export const EXIT_DISTANCE = 1.7

export interface DoorInfo {
  index: number
  world: Vec3
  out: { x: number; z: number }
}

export function vehicleDoors(spec: VehicleSpec, pose: VehiclePose): DoorInfo[] {
  return spec.doors.map((door, index) => ({
    index,
    world: localToWorld(pose.heading, door.offset, pose.pos),
    out: rotateOut(pose.heading, door.out),
  }))
}

function rotateOut(heading: number, out: { x: number; z: number }): { x: number; z: number } {
  // Door normals are authored in local space (x/z), same basis as the pose.
  return localToWorld(heading, { x: out.x, y: 0, z: out.z }, { x: 0, y: 0, z: 0 })
}

/** Nearest door on a parked/stopped vehicle within prompt radius. */
export function nearestEnterableDoor(
  spec: VehicleSpec,
  pose: VehiclePose,
  playerPos: Vec3,
): DoorInfo | null {
  let best: DoorInfo | null = null
  let bestDist = ENTER_PROMPT_RADIUS
  for (const door of vehicleDoors(spec, pose)) {
    const d = Math.hypot(door.world.x - playerPos.x, door.world.z - playerPos.z)
    if (d < bestDist) {
      bestDist = d
      best = door
    }
  }
  return best
}

/**
 * Candidate exit placements for one door: the outward spot and two
 * diagonals, so a kerb or another car on the direct line does not trap the
 * player. Validation happens in vehicle-control.ts against the world.
 */
export function exitCandidates(pose: VehiclePose, door: DoorInfo): Vec3[] {
  const f = { x: Math.sin(pose.heading), z: Math.cos(pose.heading) }
  const out = door.out
  return [
    { x: door.world.x + out.x * EXIT_DISTANCE, y: door.world.y, z: door.world.z + out.z * EXIT_DISTANCE },
    {
      x: door.world.x + out.x * EXIT_DISTANCE + f.x * 0.9,
      y: door.world.y,
      z: door.world.z + out.z * EXIT_DISTANCE + f.z * 0.9,
    },
    {
      x: door.world.x + out.x * EXIT_DISTANCE - f.x * 0.9,
      y: door.world.y,
      z: door.world.z + out.z * EXIT_DISTANCE - f.z * 0.9,
    },
  ]
}

/** Seat position in world space (player rests here while driving). */
export function seatWorld(spec: VehicleSpec, pose: VehiclePose): Vec3 {
  return localToWorld(pose.heading, spec.seat, pose.pos)
}

// ── Default deterministic spawn layout ───────────────────────────────────────

export const PARKED_COUNT = 3
export const AI_BUDGET = 5

export interface SpawnLayout {
  registry: VehicleRegistry
  lane: Lane
}

/**
 * Rebuild the default world: `PARKED_COUNT` cars at the kerb and the rest of
 * the budget circulating the boulevard loop. Identical seed, identical
 * layout, every run. The lane offsets park cars off the centre-line, facing
 * the direction of travel.
 */
export function createDefaultLayout(
  budget = PARKED_COUNT + AI_BUDGET,
  seed = 0x53a3,
): SpawnLayout {
  const registry = createRegistry()
  const lane = BOULEVARD_LOOP
  const parked = Math.min(PARKED_COUNT, budget)
  const ai = Math.max(0, budget - parked)
  const rand = seededRandom(seed)

  for (let i = 0; i < parked; i++) {
    const along = ((i + 0.5) / parked) * laneLength(lane)
    const { point, heading } = pointAlongLane(lane, along)
    const right = { x: -Math.cos(heading), z: Math.sin(heading) }
    const curb = 3.2
    const pos = {
      x: point.x + right.x * curb,
      y: 0,
      z: point.z + right.z * curb,
    }
    const kind = SPAWN_KINDS[i % SPAWN_KINDS.length]
    spawnVehicle(registry, kind, { pos, heading }, 'PARKED', parkedMotion())
  }

  for (let i = 0; i < ai; i++) {
    const along = ((i + 0.5) / ai) * laneLength(lane)
    const { point, heading } = pointAlongLane(lane, along)
    const kind = SPAWN_KINDS[(i + 1) % SPAWN_KINDS.length]
    const entity = spawnVehicle(
      registry,
      kind,
      { pos: { ...point, y: 0 }, heading },
      'AI_CONTROLLED',
      parkedMotion(),
    )
    if (entity.ai) {
      entity.ai.distance = along
      entity.ai.targetSpeed = lane.speedLimit * (0.62 + 0.34 * rand())
    }
  }

  // The player's car: parked closest to the default spawn point. It starts
  // owned but unattached — `playerVehicleId` only ever points at a vehicle
  // the player is entering or driving, so walk-mode prompts still work.
  const nearest = nearestLanePoint(lane, MANHATTAN_SPAWN_POINT.x, MANHATTAN_SPAWN_POINT.z)
  const right = { x: -Math.cos(nearest.heading), z: Math.sin(nearest.heading) }
  const kind = SPAWN_KINDS[0]
  const entity = spawnVehicle(
    registry,
    kind,
    {
      pos: { x: nearest.point.x + right.x * 3.2, y: 0, z: nearest.point.z + right.z * 3.2 },
      heading: nearest.heading,
    },
    'PARKED',
    parkedMotion(),
  )
  entity.owned = true

  return { registry, lane }
}

