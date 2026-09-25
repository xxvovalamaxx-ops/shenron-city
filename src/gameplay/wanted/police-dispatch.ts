/**
 * Police dispatch: puts cruisers on the road when the player is wanted and
 * drives them.
 *
 * Units spawn out of the way on the real street graph (a couple of hundred
 * metres of road from the player), follow an A* route along the streets
 * toward the suspect, and switch to direct pursuit once they are close —
 * leading the target, ramming, and backing out when wedged (pursuit.ts). They
 * are ordinary session vehicles under the 'pursuit' controller, so they
 * collide, get knocked around and can even be stolen like any other car.
 *
 * Deterministic: no clock and no random source; spawn choice rotates through
 * the candidate nodes by a counter.
 */
import type { VehicleSimState } from '../vehicles/vehicle-control'
import type { VehicleWorld } from '../vehicles/vehicle-collision'
import { spawnVehicle } from '../vehicles/vehicle-entities'
import { initialVehicleMotion } from '../vehicles/vehicle-model'
import type { StreetData } from '../../ui/radar/street-data'
import { findRoute, nearestNode } from '../../ui/radar/route'
import { roadDistances } from '../director/mission-catalog'
import { createPursuitMemory, pursuitInput, type PursuitMemory } from './pursuit'
import { MAX_STARS, POLICE_UNITS, type Observer, type Vec2 } from './wanted'

/** Never more than this many cruisers at once, whatever the level. */
export const MAX_UNITS = 5
/** Seconds between spawns while under strength. */
export const SPAWN_INTERVAL = 2.5
/** Road-distance band for spawning, metres. */
export const SPAWN_MIN = 170
export const SPAWN_MAX = 290
/** A unit this far from the player is recycled. */
export const DESPAWN_DISTANCE = 480
/** Inside this range a unit drives straight at the suspect. */
export const DIRECT_RANGE = 55
/** Route refresh period per unit, seconds. */
export const ROUTE_REFRESH = 1.1
/** A cop this close to a player on foot, nearly stopped, for BUST_TIME: busted. */
export const BUST_RANGE = 10
export const BUST_TIME = 2.2

export interface PoliceUnit {
  id: number
  memory: PursuitMemory
  route: Vec2[]
  routeAge: number
}

export interface DispatchState {
  units: Map<number, PoliceUnit>
  spawnClock: number
  spawnCount: number
  bustClock: number
}

export function createDispatch(): DispatchState {
  return { units: new Map(), spawnClock: 0, spawnCount: 0, bustClock: 0 }
}

export function desiredUnits(stars: number): number {
  return Math.min(MAX_UNITS, POLICE_UNITS[Math.max(0, Math.min(MAX_STARS, stars))])
}

export interface DispatchStep {
  stars: number
  /** Police can currently see the suspect. */
  spotted: boolean
  player: Vec2
  playerVel: Vec2
  /** Player is on foot (not in or entering a car). */
  onFoot: boolean
  dt: number
}

export interface DispatchResult {
  /** Set when a unit has arrested a player on foot this step. */
  busted: boolean
}

/** Pick a spawn node: a drivable node in the road-distance band, rotated by counter. */
export function pickSpawnNode(data: StreetData, player: Vec2, counter: number): number | null {
  const g = data.graph
  const home = nearestNode(g, player.x, player.z, true)
  if (home < 0) return null
  const dist = roadDistances(g, home, SPAWN_MAX, false)
  const candidates: number[] = []
  for (let n = 0; n < g.nodeCount; n++) {
    if (dist[n] >= SPAWN_MIN && dist[n] <= SPAWN_MAX) candidates.push(n)
  }
  if (candidates.length === 0) return null
  return candidates[(counter * 7919) % candidates.length]
}

function routeTo(data: StreetData, from: Vec2, to: Vec2): Vec2[] {
  const g = data.graph
  const a = nearestNode(g, from.x, from.z, true)
  const b = nearestNode(g, to.x, to.z, true)
  if (a < 0 || b < 0) return []
  // Police ignore one-way streets, like every movie cop.
  const route = findRoute(g, a, b, { maxExpansions: 20000 })
  if (!route) return []
  return route.nodes.map((n) => ({ x: g.nodeX[n], z: g.nodeZ[n] }))
}

/** The next route point at least `ahead` metres from the car. */
export function nextWaypoint(route: readonly Vec2[], car: Vec2, ahead = 14): Vec2 | null {
  // Skip points behind: start from the closest one.
  let start = 0
  let best = Infinity
  for (let i = 0; i < route.length; i++) {
    const d = Math.hypot(route[i].x - car.x, route[i].z - car.z)
    if (d < best) {
      best = d
      start = i
    }
  }
  // Already past the closest point (it lies behind along the route): the
  // route continues from the next one. Without this a car that has just
  // driven by a node keeps turning back to it and circles.
  if (start + 1 < route.length) {
    const a = route[start]
    const b = route[start + 1]
    if ((car.x - a.x) * (b.x - a.x) + (car.z - a.z) * (b.z - a.z) > 0) start += 1
  }
  for (let i = start; i < route.length; i++) {
    if (Math.hypot(route[i].x - car.x, route[i].z - car.z) >= ahead) return route[i]
  }
  return route.length > 0 ? route[route.length - 1] : null
}

/**
 * Advance dispatch by one frame: recycle, spawn, route and drive every unit.
 * Writes each unit's input into `sim.pursuitInputs`.
 */
export function stepDispatch(
  state: DispatchState,
  sim: VehicleSimState,
  world: VehicleWorld,
  data: StreetData | null,
  step: DispatchStep,
): DispatchResult {
  const { player, dt } = step
  const want = desiredUnits(step.stars)

  // ── Recycle ──────────────────────────────────────────────────────────────
  for (const id of [...state.units.keys()]) {
    const entity = sim.registry.vehicles.get(id)
    const gone = !entity || entity.controller !== 'pursuit' || entity.state !== 'AI_CONTROLLED'
    const far = entity ? Math.hypot(entity.pose.pos.x - player.x, entity.pose.pos.z - player.z) : Infinity
    // Once the heat is off, units peel away as soon as they are out of sight.
    const standDown = step.stars === 0 && far > 60
    if (gone || far > DESPAWN_DISTANCE || standDown || state.units.size > want + 2) {
      sim.pursuitInputs.delete(id)
      if (entity && !gone) sim.registry.vehicles.delete(id)
      state.units.delete(id)
    }
  }

  // ── Spawn ────────────────────────────────────────────────────────────────
  state.spawnClock = Math.max(0, state.spawnClock - dt)
  if (data && state.units.size < want && state.spawnClock === 0) {
    state.spawnClock = SPAWN_INTERVAL
    const node = pickSpawnNode(data, player, state.spawnCount++)
    if (node !== null) {
      const g = data.graph
      const at = { x: g.nodeX[node], z: g.nodeZ[node] }
      const route = routeTo(data, at, player)
      const next = nextWaypoint(route, at, 8) ?? player
      const heading = Math.atan2(next.x - at.x, next.z - at.z)
      const y = world.groundHeightAt(at.x, at.z) ?? 12.1
      const motion = initialVehicleMotion()
      motion.speed = 12
      const entity = spawnVehicle(sim.registry, 'police', { pos: { x: at.x, y, z: at.z }, heading }, 'AI_CONTROLLED', motion)
      entity.controller = 'pursuit'
      entity.origin = 'spawn'
      state.units.set(entity.id, { id: entity.id, memory: createPursuitMemory(), route, routeAge: 0 })
    }
  }

  // ── Drive ────────────────────────────────────────────────────────────────
  let closeAndSlow = false
  for (const unit of state.units.values()) {
    const entity = sim.registry.vehicles.get(unit.id)
    if (!entity) continue
    const car = { pos: { x: entity.pose.pos.x, z: entity.pose.pos.z }, heading: entity.pose.heading, speed: entity.motion.speed }
    const distance = Math.hypot(player.x - car.pos.x, player.z - car.pos.z)
    unit.routeAge += dt
    if (data && distance > DIRECT_RANGE && unit.routeAge >= ROUTE_REFRESH) {
      unit.routeAge = 0
      unit.route = routeTo(data, car.pos, player)
    }
    const goal = distance <= DIRECT_RANGE || unit.route.length === 0 ? player : nextWaypoint(unit.route, car.pos) ?? player
    const target = { pos: player, vel: step.playerVel }
    if (step.stars === 0) {
      sim.pursuitInputs.set(unit.id, { throttle: 0, brake: 1, steer: 0, handbrake: false })
      continue
    }
    const result = pursuitInput(car, goal, target, unit.memory, dt)
    unit.memory = result.memory
    // On foot, a cop slows on the approach and pulls up beside the suspect
    // instead of running them over.
    if (step.onFoot && distance < 30) {
      const approach = distance < 6 ? 0 : 2 + distance * 0.3
      if (entity.motion.speed > approach) {
        result.input.throttle = 0
        result.input.brake = distance < 6 ? 1 : 0.8
        result.input.handbrake = false
      }
    }
    sim.pursuitInputs.set(unit.id, result.input)
    if (distance <= BUST_RANGE && Math.abs(entity.motion.speed) < 3) closeAndSlow = true
  }

  // ── Arrest ───────────────────────────────────────────────────────────────
  if (step.onFoot && step.stars > 0 && step.spotted && closeAndSlow) state.bustClock += dt
  else state.bustClock = Math.max(0, state.bustClock - dt * 2)
  const busted = state.bustClock >= BUST_TIME
  if (busted) state.bustClock = 0
  return { busted }
}

/** Every unit as an observer for the sight test. */
export function unitObservers(state: DispatchState, sim: VehicleSimState): Observer[] {
  const out: Observer[] = []
  for (const unit of state.units.values()) {
    const e = sim.registry.vehicles.get(unit.id)
    if (!e) continue
    out.push({ pos: { x: e.pose.pos.x, z: e.pose.pos.z }, forward: { x: Math.sin(e.pose.heading), z: Math.cos(e.pose.heading) } })
  }
  return out
}

/** Remove every unit at once (busted, dev reset). */
export function clearDispatch(state: DispatchState, sim: VehicleSimState): void {
  for (const id of state.units.keys()) {
    sim.pursuitInputs.delete(id)
    sim.registry.vehicles.delete(id)
  }
  state.units.clear()
  state.spawnClock = 0
  state.bustClock = 0
}
