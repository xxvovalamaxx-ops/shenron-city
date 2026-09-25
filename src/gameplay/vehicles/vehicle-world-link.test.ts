import { describe, expect, it } from 'vitest'
import { aabb } from '../collision'
import { AabbVehicleWorld } from './vehicle-collision'
import {
  createLiveVehicleSim,
  placeParkedCar,
  stepVehicleSim,
  NO_VEHICLE_INPUT,
  type PlayerVehicleInput,
  type SimEvent,
} from './vehicle-control'
import { contactImpulse } from './vehicle-impulse'
import {
  JACK_MAX_SPEED,
  MAX_ABANDONED_CARS,
  PARKED_DESPAWN_DELAY,
  PARKED_DESPAWN_DISTANCE,
  updateParkedCars,
  type TrafficCarView,
} from './vehicle-world-link'
import { createRegistry, parkedMotion, spawnVehicle } from './vehicle-entities'
import { blockSpeedCap, laneBlocks, projectOnLane, type LaneLike } from './traffic-bridge'
import { gearboxFor, initialGearbox, stepGearbox } from './vehicle-gearbox'
import { vehicleSpec } from './vehicle-specs'

const DT = 1 / 120
const world = new AabbVehicleWorld([aabb(0, 0, 0, 800, 1, 800)])

function view(overrides: Partial<TrafficCarView> = {}): TrafficCarView {
  return {
    id: 42,
    kind: 'taxi',
    x: 0,
    y: 0.5,
    z: 0,
    heading: 0,
    speed: 0,
    vx: 0,
    vz: 0,
    yawRate: 0,
    paint: 0xf2b736,
    ...overrides,
  }
}

function step(sim: ReturnType<typeof createLiveVehicleSim>, input: Partial<PlayerVehicleInput>, steps = 1): SimEvent[] {
  const all: SimEvent[] = []
  for (let i = 0; i < steps; i++) {
    all.push(...stepVehicleSim(sim, world, { ...NO_VEHICLE_INPUT, ...(i === 0 ? input : { ...input, interact: false }) }, DT, 12))
  }
  return all
}

describe('carjacking a traffic car', () => {
  it('offers a slow traffic car and promotes it at its exact pose and velocity', () => {
    const sim = createLiveVehicleSim()
    // A taxi heading +X, creeping at 2 m/s; the player stands by its left door.
    sim.traffic = [view({ x: 10, z: 5, heading: Math.PI / 2, speed: 2, vx: 2, vz: 0 })]
    sim.player.pos = { x: 10.3, y: 0.5, z: 6.9 }
    step(sim, {})
    expect(sim.prompt?.trafficId).toBe(42)
    expect(sim.prompt?.label).toContain('Oriel Cab')

    sim.traffic = [view({ x: 10, z: 5, heading: Math.PI / 2, speed: 2, vx: 2, vz: 0 })]
    const events = step(sim, { interact: true })
    const promote = events.find((e) => e.type === 'promote')
    expect(promote).toBeDefined()
    if (promote?.type !== 'promote') return
    expect(promote.trafficId).toBe(42)
    const car = sim.registry.vehicles.get(promote.vehicleId)!
    expect(car.kind).toBe('taxi')
    expect(car.paint).toBe(0xf2b736)
    expect(car.origin).toBe('traffic')
    expect(car.pose.pos.x).toBe(10)
    expect(car.motion.speed).toBeCloseTo(2, 9)
    expect(car.pose.heading).toBeCloseTo(Math.PI / 2, 6)
    expect(car.state).toBe('ENTERING')
    expect(car.owned).toBe(true)
    // the traffic car is no longer an obstacle to itself
    expect(sim.traffic.find((v) => v.id === 42)).toBeUndefined()

    // It coasts to rest while the player climbs in, then it is theirs.
    const rest = step(sim, {}, 120)
    expect(rest.some((e) => e.type === 'enter')).toBe(true)
    expect(car.state).toBe('PLAYER_CONTROLLED')
    expect(Math.abs(car.motion.speed)).toBeLessThan(0.1)
  })

  it('refuses a car moving faster than walking-into-traffic speed', () => {
    const sim = createLiveVehicleSim()
    sim.traffic = [view({ x: 10, z: 5, heading: Math.PI / 2, speed: JACK_MAX_SPEED + 3, vx: JACK_MAX_SPEED + 3 })]
    sim.player.pos = { x: 10.3, y: 0.5, z: 6.9 }
    step(sim, {})
    expect(sim.prompt).toBeNull()
  })

  it('a taken car becomes the owned one; the previous car is released to the parking rules', () => {
    const sim = createLiveVehicleSim()
    const first = placeParkedCar(sim, 'sedan', { pos: { x: 50, y: 0.5, z: 50 }, heading: 0 }, 0x7d1219, { owned: true })
    sim.traffic = [view({ x: 10, z: 5, heading: Math.PI / 2 })]
    sim.player.pos = { x: 10.3, y: 0.5, z: 6.9 }
    step(sim, {})
    step(sim, { interact: true })
    expect(first.owned).toBe(false)
    const owned = [...sim.registry.vehicles.values()].filter((v) => v.owned)
    expect(owned).toHaveLength(1)
    expect(owned[0].kind).toBe('taxi')
  })
})

describe('collisions push traffic', () => {
  it('ramming a stopped traffic car knocks it forward and bleeds the rammer', () => {
    const sim = createLiveVehicleSim()
    const car = placeParkedCar(sim, 'sedan', { pos: { x: 0, y: 0.5, z: 0 }, heading: 0 }, null, { owned: true })
    sim.player.pos = { x: 1.2, y: 0.5, z: 0.3 }
    step(sim, { interact: true })
    step(sim, {}, 90)
    expect(car.state).toBe('PLAYER_CONTROLLED')
    car.motion.speed = 14
    // a stopped taxi dead ahead
    sim.traffic = [view({ x: 0, z: 5.2, heading: 0 })]
    const events = step(sim, { throttle: 1 }, 30)
    const hit = events.find((e) => e.type === 'collision-traffic')
    expect(hit).toBeDefined()
    const knocked = sim.traffic[0]
    expect(knocked.hit).toBe(true)
    expect(knocked.vz).toBeGreaterThan(3)
    expect(knocked.z).toBeGreaterThan(5.2)
    expect(car.motion.speed).toBeLessThan(14)
  })

  it('momentum exchange: a heavy van shoves a sedan more than the reverse', () => {
    const van = vehicleSpec('van')
    const sedan = vehicleSpec('sedan')
    const body = (spec: typeof van, z: number, vz: number) => ({
      x: 0, z, heading: 0, vx: 0, vz, mass: spec.mass, halfLength: spec.halfLength, halfWidth: spec.halfWidth,
    })
    const vanHits = contactImpulse(body(van, 0, 10), body(sedan, 4.9, 0))!
    const sedanHits = contactImpulse(body(sedan, 0, 10), body(van, 4.9, 0))!
    expect(vanHits.dvB.z).toBeGreaterThan(sedanHits.dvB.z)
    expect(vanHits.closingSpeed).toBeCloseTo(10, 6)
    // momentum is conserved along the normal
    expect(van.mass * vanHits.dvA.z + sedan.mass * vanHits.dvB.z).toBeCloseTo(0, 6)
  })
})

describe('parking rules', () => {
  function parked(registry: ReturnType<typeof createRegistry>, x: number, owned = false) {
    const e = spawnVehicle(registry, 'sedan', { pos: { x, y: 0, z: 0 }, heading: 0 }, 'PARKED', parkedMotion())
    e.owned = owned
    return e
  }

  it('abandoned cars stay put nearby and are towed once the player is far for long enough', () => {
    const registry = createRegistry()
    const near = parked(registry, 10)
    const far = parked(registry, PARKED_DESPAWN_DISTANCE + 50)
    const clocks = new Map<number, number>()
    const player = { x: 0, y: 0, z: 0 }
    const removed: number[] = []
    for (let t = 0; t < PARKED_DESPAWN_DELAY + 1; t += 0.5) removed.push(...updateParkedCars(registry, player, 0.5, clocks))
    expect(removed).toEqual([far.id])
    expect(registry.vehicles.has(near.id)).toBe(true)
    expect(near.pose.pos.x).toBe(10)
  })

  it('never removes the owned car, however far', () => {
    const registry = createRegistry()
    const mine = parked(registry, 5000, true)
    const clocks = new Map<number, number>()
    for (let t = 0; t < 60; t += 1) updateParkedCars(registry, { x: 0, y: 0, z: 0 }, 1, clocks)
    expect(registry.vehicles.has(mine.id)).toBe(true)
  })

  it('caps the number of abandoned cars, farthest first, never close ones', () => {
    const registry = createRegistry()
    const cars = []
    for (let i = 0; i < MAX_ABANDONED_CARS + 3; i++) cars.push(parked(registry, 20 + i * 30))
    const removed = updateParkedCars(registry, { x: 0, y: 0, z: 0 }, 0.1, new Map())
    expect(removed).toHaveLength(3)
    const kept = [...registry.vehicles.values()].map((v) => v.pose.pos.x).sort((a, b) => a - b)
    expect(kept[0]).toBe(20)
    expect(Math.max(...kept)).toBeLessThan(20 + (MAX_ABANDONED_CARS + 0) * 30)
  })
})

describe('traffic obstacle rule', () => {
  // A straight lane running east along y = 0, 200 m long.
  const lane: LaneLike = { pts: [[0, 0], [100, 0], [200, 0]], cum: [0, 100, 200], len: 200 }

  it('projects world points onto the lane (world z = -local y)', () => {
    const p = projectOnLane(lane, 50, -1.5)
    expect(p.s).toBeCloseTo(50, 9)
    // right of eastward travel is south (-y)
    expect(p.lateral).toBeCloseTo(1.5, 9)
  })

  it("the player's car in the lane becomes a block at its near edge", () => {
    const sedan = vehicleSpec('sedan')
    // stopped in the lane at x = 80, pointing east with the traffic
    const blocks = laneBlocks(lane, [{ x: 80, z: 0, heading: Math.PI / 2, halfLength: sedan.halfLength, halfWidth: sedan.halfWidth, vx: 0, vz: 0 }], 1.675)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].s).toBeCloseTo(80 - sedan.halfLength, 6)
    expect(blocks[0].speed).toBe(0)
  })

  it('a car parked at the kerb beside the lane does not block it', () => {
    const blocks = laneBlocks(lane, [{ x: 80, z: 4.5, heading: Math.PI / 2, halfLength: 2.39, halfWidth: 0.93, vx: 0, vz: 0 }], 1.675)
    expect(blocks).toHaveLength(0)
  })

  it('followers brake for a block and stop short of it', () => {
    const blocks = [{ s: 60, speed: 0 }]
    expect(blockSpeedCap(10, 2.4, 12, blocks)).toBe(Infinity)
    const closing = blockSpeedCap(45, 2.4, 12, blocks)
    expect(closing).toBeLessThan(12)
    expect(blockSpeedCap(56.6, 2.4, 1, blocks)).toBe(0)
    // a block the car is already past does not hold it
    expect(blockSpeedCap(61, 2.4, 5, blocks)).toBe(Infinity)
  })

  it('a block on the next lane is seen across the junction', () => {
    const next = [{ s: 5, speed: 0 }]
    // 8 m before the end of a 100 m lane, block 5 m into the next one
    expect(blockSpeedCap(92, 2.4, 10, next, 2.2, 1.15, 100)).toBeLessThan(10)
  })
})

describe('gearbox', () => {
  it('shifts up through the gears under power and back down when slowing', () => {
    const spec = gearboxFor(vehicleSpec('sedan'))
    let s = initialGearbox(spec)
    let ups = 0
    for (let v = 0; v <= 43; v += 0.05) {
      s = stepGearbox(s, spec, v, 1, 1 / 60)
      if (s.shiftedUp) ups++
      expect(s.rpm).toBeGreaterThanOrEqual(spec.idleRpm - 1e-6)
      expect(s.rpm).toBeLessThanOrEqual(spec.redlineRpm + 1e-6)
    }
    expect(ups).toBe(spec.tops.length - 1)
    expect(s.gear).toBe(spec.tops.length)
    let downs = 0
    for (let v = 43; v >= 1; v -= 0.05) {
      s = stepGearbox(s, spec, v, 0, 1 / 60)
      if (s.shiftedDown) downs++
    }
    expect(downs).toBeGreaterThan(2)
    expect(s.gear).toBeLessThanOrEqual(2)
  })

  it('selects reverse when backing up', () => {
    const spec = gearboxFor(vehicleSpec('sedan'))
    const s = stepGearbox(initialGearbox(spec), spec, -3, 0, 1 / 60)
    expect(s.gear).toBe(-1)
  })
})
