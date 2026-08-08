import { describe, expect, it } from 'vitest'
import { createVehicleSim, type VehicleSimState } from './vehicle-control'
import {
  installLaneProvider,
  trafficGhosts,
} from './vehicle-session'
import { transitionVehicle } from './vehicle-entities'
import {
  BOULEVARD_LOOP,
  nearestLanePoint,
  type Lane,
  type LaneProvider,
} from './vehicle-lanes'
import { vehicleSpec } from './vehicle-specs'

/**
 * A graph-like provider over a single lane. The default spawn layout
 * circulates cars on the boulevard loop, so the fake graph lane reuses the
 * loop's own geometry — every spawned car projects at distance ~0, which is
 * what the migration and ghost tests need to be deterministic.
 */
function fakeGraphProvider(lane: Lane): LaneProvider {
  const lanes: Record<string, Lane> = { [lane.id]: lane }
  return {
    graph: true,
    lanes,
    nearestLane(x, z, radius) {
      const sample = nearestLanePoint(lane, x, z)
      const d = Math.hypot(sample.point.x - x, sample.point.z - z)
      return d <= radius ? lane : null
    },
    project(x, z, radius) {
      const laneHit = this.nearestLane(x, z, radius)
      if (!laneHit) return null
      return { lane: laneHit, distance: nearestLanePoint(laneHit, x, z).distance }
    },
  }
}

const GRAPH_LANE: Lane = {
  id: '7',
  loop: true,
  speedLimit: 11,
  laneWidth: 1.6,
  points: [...BOULEVARD_LOOP.points],
}

function aiCars(sim: VehicleSimState) {
  return [...sim.registry.vehicles.values()].filter((v) => v.state === 'AI_CONTROLLED')
}

function parkedCars(sim: VehicleSimState) {
  return [...sim.registry.vehicles.values()].filter((v) => v.state === 'PARKED')
}

describe('trafficGhosts', () => {
  it('yields no ghosts without a graph provider', () => {
    const sim = createVehicleSim()
    expect(trafficGhosts(sim, null)).toEqual([])
    expect(trafficGhosts(sim, { ...fakeGraphProvider(GRAPH_LANE), graph: false })).toEqual([])
  })

  it('reports AI cars on their routed lane with full body length', () => {
    const sim = createVehicleSim()
    const provider = fakeGraphProvider(GRAPH_LANE)
    installLaneProvider(sim, provider)
    const ghosts = trafficGhosts(sim, provider)

    for (const car of aiCars(sim)) {
      const ghost = ghosts.find((g) =>
        g.lane === 7 &&
        Math.abs(g.s - car.ai!.distance) < 1e-9 &&
        Math.abs(g.v - car.motion.speed) < 1e-9,
      )
      expect(ghost).toBeDefined()
      expect(ghost!.length).toBeCloseTo(vehicleSpec(car.kind).halfLength * 2, 9)
      expect(ghost!.ghost).toBe(true)
    }
  })

  it('projects parked and player-controlled cars onto the nearest lane', () => {
    const sim = createVehicleSim()
    const provider = fakeGraphProvider(GRAPH_LANE)
    installLaneProvider(sim, provider)

    const parked = parkedCars(sim)[0]
    const expected = nearestLanePoint(GRAPH_LANE, parked.pose.pos.x, parked.pose.pos.z)
    const ghosts = trafficGhosts(sim, provider)
    expect(ghosts.some((g) => g.lane === 7 && g.v === 0 && Math.abs(g.s - expected.distance) < 1e-9)).toBe(true)

    const ok = transitionVehicle(sim.registry, parked.id, 'ENTERING')
    expect(ok.ok).toBe(true)
    expect(transitionVehicle(sim.registry, parked.id, 'PLAYER_CONTROLLED').ok).toBe(true)
    const entity = sim.registry.vehicles.get(parked.id)!
    entity.motion.speed = 5
    const driven = trafficGhosts(sim, provider).find((g) => g.lane === 7 && g.v === 5)!
    expect(driven.s).toBeCloseTo(expected.distance, 9)
    expect(driven.length).toBeCloseTo(vehicleSpec(entity.kind).halfLength * 2, 9)
  })
})

describe('installLaneProvider', () => {
  it('migrates circulating AI cars onto the graph lanes', () => {
    const sim = createVehicleSim()
    const provider = fakeGraphProvider(GRAPH_LANE)
    installLaneProvider(sim, provider)

    expect(sim.provider).toBe(provider)
    const cars = aiCars(sim)
    expect(cars.length).toBeGreaterThan(0)
    for (const car of cars) {
      expect(car.ai!.laneId).toBe(GRAPH_LANE.id)
      const expected = nearestLanePoint(GRAPH_LANE, car.pose.pos.x, car.pose.pos.z)
      expect(car.ai!.distance).toBeCloseTo(expected.distance, 9)
      expect(car.ai!.targetSpeed).toBeCloseTo(GRAPH_LANE.speedLimit * 0.8, 9)
    }
  })

  it('leaves parked cars (and the owned car) untouched', () => {
    const sim = createVehicleSim()
    const before = parkedCars(sim).map((v) => ({
      id: v.id, x: v.pose.pos.x, z: v.pose.pos.z, owned: v.owned, ai: v.ai,
    }))
    installLaneProvider(sim, fakeGraphProvider(GRAPH_LANE))
    const after = parkedCars(sim).map((v) => ({
      id: v.id, x: v.pose.pos.x, z: v.pose.pos.z, owned: v.owned, ai: v.ai,
    }))
    expect(after).toEqual(before)
    const owned = [...sim.registry.vehicles.values()].find((v) => v.owned)!
    expect(owned.state).toBe('PARKED')
  })

  it('is idempotent: a second install with the same provider changes nothing', () => {
    const sim = createVehicleSim()
    const provider = fakeGraphProvider(GRAPH_LANE)
    installLaneProvider(sim, provider)
    const first = aiCars(sim).map((v) => ({ id: v.id, laneId: v.ai!.laneId, d: v.ai!.distance }))
    installLaneProvider(sim, provider)
    const second = aiCars(sim).map((v) => ({ id: v.id, laneId: v.ai!.laneId, d: v.ai!.distance }))
    expect(second).toEqual(first)
  })
})
