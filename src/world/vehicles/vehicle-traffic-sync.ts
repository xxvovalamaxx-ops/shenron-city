/**
 * Frame glue between the vehicle session and the LION traffic sim.
 *
 * The session and traffic are both pure-ish simulations that know nothing of
 * each other; this module is the only place that holds both. Once a frame,
 * around the session step:
 *
 *   before  hand the session the traffic cars near the player
 *           (`sim.traffic`), and park the starter car at a real kerb the
 *           first time traffic is ready;
 *   after   remove carjacked cars from traffic, free knocked cars from their
 *           lanes with the pose and velocity the session gave them, and tell
 *           traffic what it must not drive through (the session's cars and
 *           the player on foot).
 */
import { cityWorld } from '../../city/registry.js'
import type { Vec3 } from '../../gameplay/collision'
import { manhattanCollision } from '../manhattan-collision'
import { rt } from '../../gameplay/runtime'
import { placeParkedCar, type SimEvent, type VehicleSimState } from '../../gameplay/vehicles/vehicle-control'
import { motionVelocity } from '../../gameplay/vehicles/vehicle-model'
import { vehicleSpec } from '../../gameplay/vehicles/vehicle-specs'
import type { TrafficObstacle } from '../../gameplay/vehicles/traffic-bridge'

/** Traffic cars closer than this are handed to the session each frame. */
export const TRAFFIC_QUERY_RADIUS = 48
/** The starter car's paint: a deep red. */
export const STARTER_PAINT = 0x7d1219

let starterPlaced = false

/** Before the session step. */
export function syncTrafficIntoSession(sim: VehicleSimState, playerPos: Vec3): void {
  const traffic = cityWorld.traffic
  if (!traffic || !cityWorld.ready) {
    sim.traffic = []
    return
  }
  const centre = sim.registry.playerVehicleId !== null
    ? sim.registry.vehicles.get(sim.registry.playerVehicleId)?.pose.pos ?? playerPos
    : playerPos
  sim.traffic = traffic.queryNear(centre.x, centre.z, TRAFFIC_QUERY_RADIUS, [])
  ensureStarterCar(sim, playerPos)
}

/** How far ahead of the player the starter car is looked for, metres. */
export const STARTER_AHEAD = 20

/**
 * The first time traffic is ready, a player with no car of their own gets
 * one parked at the kerb a short walk ahead of them, facing the way the
 * street runs. It follows wherever the spawn is: at the 5th Avenue spawn
 * (about x=-824, z=2481, facing downtown) that is the one-way 5th Ave kerb
 * some 20 m down the block, heading downtown.
 */
function ensureStarterCar(sim: VehicleSimState, playerPos: Vec3): void {
  if (starterPlaced) return
  const traffic = cityWorld.traffic
  if (!traffic) return
  starterPlaced = true
  for (const entity of sim.registry.vehicles.values()) {
    if (entity.owned) return
  }
  const f = rt.player.forward
  const len = Math.hypot(f.x, f.z) || 1
  const ax = playerPos.x + (f.x / len) * STARTER_AHEAD
  const az = playerPos.z + (f.z / len) * STARTER_AHEAD
  const spot = traffic.parkingSpotNear(ax, az, 60) ?? traffic.parkingSpotNear(playerPos.x, playerPos.z, 120)
  if (!spot) return
  const ground = manhattanCollision.groundHeightAt(spot.x, spot.z) ?? playerPos.y
  placeParkedCar(sim, 'sedan', { pos: { x: spot.x, y: ground, z: spot.z }, heading: spot.heading }, STARTER_PAINT, {
    owned: true,
    origin: 'layout',
  })
}

/** After the session step, with every event of the frame. */
export function syncSessionIntoTraffic(sim: VehicleSimState, events: readonly SimEvent[], playerPos: Vec3, onFoot: boolean): void {
  const traffic = cityWorld.traffic
  if (!traffic) return
  for (const event of events) {
    if (event.type === 'promote') traffic.claim(event.trafficId)
  }
  for (const view of sim.traffic) {
    if (view.hit) traffic.knock(view.id, view)
  }
  const obstacles: TrafficObstacle[] = []
  for (const entity of sim.registry.vehicles.values()) {
    if (entity.state === 'DISABLED') continue
    const spec = vehicleSpec(entity.kind)
    const v = motionVelocity(entity.pose.heading, entity.motion)
    obstacles.push({
      x: entity.pose.pos.x,
      z: entity.pose.pos.z,
      heading: entity.pose.heading,
      halfLength: spec.halfLength,
      halfWidth: spec.halfWidth,
      vx: v.x,
      vz: v.z,
    })
  }
  if (onFoot) {
    obstacles.push({ x: playerPos.x, z: playerPos.z, heading: 0, halfLength: 0.45, halfWidth: 0.45, vx: 0, vz: 0 })
  }
  traffic.setObstacles(obstacles)
}
