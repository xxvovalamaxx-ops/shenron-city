/**
 * The handoff wired into the session, rather than the arithmetic of it.
 *
 * vehicle-handoff.test.ts covers promoteTrafficCar and demoteToTraffic as
 * functions. This covers the thing that was actually missing: nothing called
 * them. The sim held 399 LION cars the enter prompt could not see, because
 * updateEnterPrompt iterated the registry only, so the player walked through
 * every car in Manhattan (OPUS-015).
 *
 * These drive the real step function, so they fail if the wiring is removed
 * even when the arithmetic still passes.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createVehicleSim,
  stepVehicleSim,
  NO_VEHICLE_INPUT,
  STATIONARY_TRAFFIC_SPEED,
  type VehicleSimState,
} from './vehicle-control'
import { AabbVehicleWorld } from './vehicle-collision'
import { countRepresentations, type CityTrafficPool, type HandoffLane, type TrafficCar } from './vehicle-handoff'

const ROAD_Y = 0

/** A straight lane running due east, so a car at `s` sits at world x = s. */
function eastLane(len = 200, speed = 11): HandoffLane {
  return { pts: [[0, 0], [len, 0]], cum: [0, len], len, speed }
}

function trafficCar(over: Partial<TrafficCar> = {}): TrafficCar {
  return { lane: 0, s: 50, v: 0, seed: 7001, alive: true, ...over }
}

function pool(cars: TrafficCar[]): CityTrafficPool {
  return { cars, lanes: [eastLane()], roadY: ROAD_Y }
}

/** An empty world: flat ground everywhere, nothing in the way. */
function openWorld() {
  return new AabbVehicleWorld([], 0)
}

const INTERACT = { ...NO_VEHICLE_INPUT, interact: true }

/** Midday: headlights off, and nothing in these tests depends on the hour. */
const NOON = 12

/**
 * Put the player next to a car and run one step.
 *
 * The registry's own default cars are moved far away first. They are legal
 * enter targets too, and a test that let one of them win the prompt would pass
 * while proving nothing about city traffic.
 */
function sitPlayerBeside(sim: VehicleSimState, x: number, z: number) {
  for (const entity of sim.registry.vehicles.values()) {
    entity.pose.pos = { x: 5000, y: 0, z: 5000 }
  }
  sim.player.pos = { x, y: 0, z }
}

describe('city traffic is enterable', () => {
  let sim: VehicleSimState
  let cars: TrafficCar[]

  beforeEach(() => {
    sim = createVehicleSim()
    cars = [trafficCar({ s: 50 })]
    sim.cityTraffic = pool(cars)
    sitPlayerBeside(sim, 50, 0)
  })

  it('offers a prompt for a stationary city car, which it could not before', () => {
    stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)
    expect(sim.prompt).not.toBeNull()
    expect(sim.prompt?.trafficCar).toBe(cars[0])
  })

  it('offers nothing when the city car is moving', () => {
    // The registry branch gets this from isStationary; a LION car carries only
    // a scalar v, so the same threshold has to be applied by hand.
    cars[0].v = STATIONARY_TRAFFIC_SPEED + 1
    stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)
    expect(sim.prompt).toBeNull()
  })

  it('offers nothing when the car is across town', () => {
    cars[0].s = 190
    stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)
    expect(sim.prompt).toBeNull()
  })

  it('ignores a dead car and a car on a lane that does not exist', () => {
    cars.push(trafficCar({ s: 50, alive: false, seed: 2 }))
    cars.push(trafficCar({ s: 50, lane: 99, seed: 3 }))
    cars[0].alive = false
    stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)
    expect(sim.prompt).toBeNull()
  })

  it('works with no city traffic at all, which is every test and the arena', () => {
    sim.cityTraffic = null
    expect(() => stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)).not.toThrow()
    expect(sim.prompt).toBeNull()
  })
})

describe('entering a city car promotes it exactly once', () => {
  let sim: VehicleSimState
  let cars: TrafficCar[]

  beforeEach(() => {
    sim = createVehicleSim()
    cars = [trafficCar({ s: 50 })]
    sim.cityTraffic = pool(cars)
    sitPlayerBeside(sim, 50, 0)
    stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)
  })

  it('never leaves two of the same car in the world', () => {
    // The whole point. countRepresentations is the only direct statement of
    // "there is one of it", which is why the module exports it.
    const before = sim.registry.vehicles.size
    stepVehicleSim(sim, openWorld(), INTERACT, 1 / 60, NOON)

    const promoted = sim.events.find((e) => e.type === 'promoted')
    expect(promoted, 'no promotion happened').toBeTruthy()

    expect(cars).toHaveLength(0)
    expect(sim.registry.vehicles.size).toBe(before + 1)
    if (promoted && 'vehicleId' in promoted) {
      expect(countRepresentations(cars, sim.registry, promoted.vehicleId)).toBe(1)
    }
  })

  it('carries the car speed across rather than stopping it dead', () => {
    cars[0].v = 0.15 // under the stationary threshold, but not zero
    stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)
    stepVehicleSim(sim, openWorld(), INTERACT, 1 / 60, NOON)
    const promoted = sim.events.find((e) => e.type === 'promoted')
    expect(promoted).toBeTruthy()
  })

  it('places the promoted car where the instanced one was', () => {
    stepVehicleSim(sim, openWorld(), INTERACT, 1 / 60, NOON)
    const promoted = sim.events.find((e) => e.type === 'promoted')
    const id = promoted && 'vehicleId' in promoted ? promoted.vehicleId : -1
    const entity = sim.registry.vehicles.get(id)
    expect(entity).toBeTruthy()
    // Lane runs east from the origin, so s = 50 is world x = 50, z = -0.
    expect(entity!.pose.pos.x).toBeCloseTo(50, 6)
    expect(entity!.pose.pos.z).toBeCloseTo(0, 6)
  })

  it('does not promote anything when interact is not pressed', () => {
    stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)
    expect(cars).toHaveLength(1)
    expect(sim.events.some((e) => e.type === 'promoted')).toBe(false)
  })

  it('survives LION replacing its whole array, which it does twice a frame', () => {
    // The failure this pins was found in the running game, not here: the first
    // wiring captured `traffic.vehicles` once at install. Traffic reassigns
    // that field wholesale — `this.vehicles = keep` when it rebuilds the
    // in-scope set, `this.vehicles = this.vehicles.filter(...)` when it reaps
    // dead cars — so the captured array went stale and the pool reported 0
    // cars against a fleet of 399. Worse than empty: a promotion would have
    // spliced the abandoned array and left the live car circulating, which is
    // the duplicate the whole module exists to prevent, reported as success.
    //
    // A getter-backed pool re-reads, so it must keep working across a swap.
    let live: TrafficCar[] = [trafficCar({ s: 50 })]
    const swapping: CityTrafficPool = {
      get cars() {
        return live
      },
      get lanes() {
        return [eastLane()]
      },
      get roadY() {
        return ROAD_Y
      },
    }
    sim.cityTraffic = swapping
    sitPlayerBeside(sim, 50, 0)

    // LION rebuilds the array, as it does every frame it changes scope.
    live = [...live]
    stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)
    expect(sim.prompt?.trafficCar, 'prompt lost across an array swap').toBe(live[0])

    const target = live[0]
    live = [...live]
    stepVehicleSim(sim, openWorld(), INTERACT, 1 / 60, NOON)

    const promoted = sim.events.find((e) => e.type === 'promoted')
    expect(promoted, 'promotion did not happen after a swap').toBeTruthy()
    // The car left the array LION is actually using, not a stale one.
    expect(live).toHaveLength(0)
    expect(target.alive).toBe(false)
    if (promoted && 'vehicleId' in promoted) {
      expect(countRepresentations(live, sim.registry, promoted.vehicleId)).toBe(1)
    }
  })

  it('promotes one car, not every car the player walked past', () => {
    cars.push(trafficCar({ s: 51, seed: 7002 }))
    cars.push(trafficCar({ s: 52, seed: 7003 }))
    stepVehicleSim(sim, openWorld(), NO_VEHICLE_INPUT, 1 / 60, NOON)
    stepVehicleSim(sim, openWorld(), INTERACT, 1 / 60, NOON)
    expect(cars).toHaveLength(2)
    expect(sim.events.filter((e) => e.type === 'promoted')).toHaveLength(1)
  })
})
