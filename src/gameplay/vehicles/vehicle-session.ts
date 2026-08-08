/**
 * The live vehicle session: the singleton the game loop drives.
 *
 * `vehicleSim` is the authoritative vehicle world — the same state the tests
 * build themselves, but module-level because there is one game. The step
 * driver subdivides the frame delta into the fixed physics substep so frame
 * hitching never changes a trajectory that the determinism test pins down.
 */
import {
  createVehicleSim,
  stepVehicleSim,
  VEHICLE_SUBSTEP,
  type PlayerVehicleInput,
  type SimEvent,
  type VehicleSimState,
} from './vehicle-control'
import type { VehicleWorld } from './vehicle-collision'
import { setLaneTable, type LaneProvider } from './vehicle-lanes'
import { vehicleSpec } from './vehicle-specs'

export {
  snapshotOwnedVehicle,
  restoreOwnedVehicle,
  type SavedVehicle,
} from './vehicle-control'

export const vehicleSim: VehicleSimState = createVehicleSim()

/**
 * A braking obstacle for the LION city traffic sim, in its lane space:
 * numeric lane id, metres along the lane, speed, body length.
 */
export interface TrafficGhost {
  lane: number
  s: number
  v: number
  length: number
  ghost: true
}

/**
 * Install the street graph as the live lane source. Called once the city
 * pipeline has built the LION lanes (`Traffic.load`). AI cars launched on
 * the drawn boulevard loop before the graph arrived are projected onto the
 * graph's nearest lane so they drive real streets immediately; parked cars
 * (including the player's) stay where they are.
 */
export function installLaneProvider(
  sim: VehicleSimState,
  provider: LaneProvider,
): void {
  sim.provider = provider
  setLaneTable(provider.lanes)
  for (const entity of sim.registry.vehicles.values()) {
    if (entity.state !== 'AI_CONTROLLED' || !entity.ai) continue
    const hit = provider.project(entity.pose.pos.x, entity.pose.pos.z, 60)
    if (!hit) continue
    entity.ai.laneId = hit.lane.id
    entity.ai.distance = hit.distance
    entity.ai.targetSpeed = hit.lane.speedLimit * 0.8
  }
}

/**
 * Project every live sim vehicle onto the graph as ghosts for
 * `Traffic.setGhosts`: the city sim brakes for them and never spawns over
 * them. AI cars report their routed lane position directly; parked and
 * player-controlled cars project onto the nearest lane. Only graph lanes
 * have numeric LION ids, so the loop provider yields no ghosts.
 */
export function trafficGhosts(
  sim: VehicleSimState,
  provider: LaneProvider | null,
): TrafficGhost[] {
  if (!provider?.graph) return []
  const out: TrafficGhost[] = []
  for (const entity of sim.registry.vehicles.values()) {
    if (entity.state === 'DISABLED' || entity.state === 'UNAVAILABLE') continue
    const spec = vehicleSpec(entity.kind)
    const laneId = entity.ai?.laneId ?? null
    const onLane = laneId ? (provider.lanes[laneId] ?? null) : null
    const hit = onLane
      ? { lane: onLane, distance: entity.ai!.distance }
      : provider.project(entity.pose.pos.x, entity.pose.pos.z, 60)
    if (!hit) continue
    out.push({
      lane: Number(hit.lane.id),
      s: hit.distance,
      v: entity.motion.speed,
      length: spec.halfLength * 2,
      ghost: true,
    })
  }
  return out
}

/**
 * Advance the session by a frame of `dt` seconds. The frame is subdivided
 * into fixed {@link VEHICLE_SUBSTEP} steps (plus a deterministic remainder),
 * so the simulation sees the same integration size regardless of the frame
 * rate.
 */
export function stepVehicleSession(
  world: VehicleWorld,
  input: PlayerVehicleInput,
  dt: number,
  clockHour: number,
): SimEvent[] {
  const frames = Math.max(1, Math.ceil(dt / VEHICLE_SUBSTEP))
  const sub = dt / frames
  let events: SimEvent[] = []
  for (let i = 0; i < frames; i++) {
    // stepVehicleSim clears its own event array each step, so the frame-level
    // result must accumulate across substeps — dropping all but the last
    // would lose edge-emitted events (horn, enter, exit, the enter prompt)
    // on exactly the substeps they fire on.
    events = events.concat(stepVehicleSim(vehicleSim, world, input, sub, clockHour))
  }
  return events
}
