/**
 * Traffic must never run the player over and never pile into itself.
 *
 * Those are the two ways moving vehicles turn a walking game into a bug
 * report, so they are what these cover — not the cosmetics.
 */
import { describe, expect, it } from 'vitest'
import { loopLength, sampleLoop } from '../agents/ambient-routes'
import { TRAFFIC_LOOP, VEHICLE } from '../world/city-data'
import {
  advanceTraffic,
  createTraffic,
  distanceToSegment,
  gapAhead,
  vehicleColliders,
  vehiclePose,
  yieldsToPlayer,
  type Vehicle,
} from './traffic'

const FAR_AWAY = { x: -60, y: 0, z: -40 }

describe('createTraffic', () => {
  it('is deterministic for a given seed', () => {
    expect(createTraffic(8)).toEqual(createTraffic(8))
  })

  it('returns nothing for a zero or negative count', () => {
    expect(createTraffic(0)).toEqual([])
    expect(createTraffic(-3)).toEqual([])
  })

  it('spaces vehicles so none start overlapping', () => {
    const cars = createTraffic(10)
    for (const car of cars) {
      expect(gapAhead(car, cars)).toBeGreaterThan(VEHICLE.length)
    }
  })

  it('keeps every vehicle on the loop', () => {
    const total = loopLength(TRAFFIC_LOOP)
    for (const car of createTraffic(12)) {
      expect(car.distance).toBeGreaterThanOrEqual(0)
      expect(car.distance).toBeLessThan(total)
    }
  })
})

describe('distanceToSegment', () => {
  it('measures perpendicular distance to the middle of a segment', () => {
    const d = distanceToSegment({ x: 3, z: 0 }, { x: 0, z: -5 }, { x: 0, z: 5 })
    expect(d).toBeCloseTo(3, 6)
  })

  it('clamps to the endpoints rather than the infinite line', () => {
    const d = distanceToSegment({ x: 0, z: 20 }, { x: 0, z: -5 }, { x: 0, z: 5 })
    expect(d).toBeCloseTo(15, 6)
  })

  it('handles a degenerate zero-length segment', () => {
    const d = distanceToSegment({ x: 3, z: 4 }, { x: 0, z: 0 }, { x: 0, z: 0 })
    expect(d).toBeCloseTo(5, 6)
  })
})

describe('yieldsToPlayer', () => {
  it('brakes for a player standing in the lane ahead', () => {
    const car: Vehicle = { id: 'a', distance: 10, cruise: 8, speed: 8, tint: 0 }
    const ahead = sampleLoop(TRAFFIC_LOOP, 16)
    expect(yieldsToPlayer(car, { x: ahead.x, y: 0, z: ahead.z })).toBe(true)
  })

  it('ignores a player on the pavement beside the lane', () => {
    const car: Vehicle = { id: 'a', distance: 10, cruise: 8, speed: 8, tint: 0 }
    const ahead = sampleLoop(TRAFFIC_LOOP, 16)
    expect(yieldsToPlayer(car, { x: ahead.x + 6, y: 0, z: ahead.z })).toBe(false)
  })

  it('ignores a player already behind it — traffic does not reverse', () => {
    const car: Vehicle = { id: 'a', distance: 40, cruise: 8, speed: 8, tint: 0 }
    const behind = sampleLoop(TRAFFIC_LOOP, 20)
    expect(yieldsToPlayer(car, { x: behind.x, y: 0, z: behind.z })).toBe(false)
  })

  it('ignores a player 180 m up in the building', () => {
    const car: Vehicle = { id: 'a', distance: 10, cruise: 8, speed: 8, tint: 0 }
    const ahead = sampleLoop(TRAFFIC_LOOP, 16)
    expect(yieldsToPlayer(car, { x: ahead.x, y: 180, z: ahead.z })).toBe(false)
  })
})

describe('advanceTraffic', () => {
  it('moves vehicles forward when the road is clear', () => {
    const cars = createTraffic(4)
    const before = cars.map((c) => c.distance)
    advanceTraffic(cars, 0.5, FAR_AWAY)
    cars.forEach((car, i) => expect(car.distance).not.toBe(before[i]))
  })

  it('brings a car to a complete stop for a player in the road', () => {
    const ahead = sampleLoop(TRAFFIC_LOOP, 18)
    const car: Vehicle = { id: 'a', distance: 12, cruise: 8, speed: 8, tint: 0 }
    const cars = [car]
    for (let i = 0; i < 240; i++) {
      advanceTraffic(cars, 1 / 60, { x: ahead.x, y: 0, z: ahead.z })
    }
    expect(car.speed).toBe(0)
  })

  it('never drives a car through the player standing in the lane', () => {
    // The real failure this guards: braking that is too weak to stop in time.
    const ahead = sampleLoop(TRAFFIC_LOOP, 22)
    const player = { x: ahead.x, y: 0, z: ahead.z }
    const car: Vehicle = { id: 'a', distance: 8, cruise: 9.4, speed: 9.4, tint: 0 }
    const cars = [car]
    let closest = Infinity

    for (let i = 0; i < 600; i++) {
      advanceTraffic(cars, 1 / 60, player)
      const pose = vehiclePose(car)
      closest = Math.min(closest, Math.hypot(pose.x - player.x, pose.z - player.z))
    }
    // Stops short of the player rather than reaching them.
    expect(closest).toBeGreaterThan(VEHICLE.length / 2)
  })

  it('holds a safe headway instead of piling into a stopped car', () => {
    const cars = createTraffic(12)
    cars[0].speed = 0
    cars[0].cruise = 0
    for (let i = 0; i < 900; i++) advanceTraffic(cars, 1 / 60, FAR_AWAY)

    for (const car of cars) {
      if (car === cars[0]) continue
      expect(gapAhead(car, cars)).toBeGreaterThan(VEHICLE.length)
    }
  })

  it('keeps distance wrapped so a long session cannot drift out of range', () => {
    const total = loopLength(TRAFFIC_LOOP)
    const cars = createTraffic(3)
    for (let i = 0; i < 5000; i++) advanceTraffic(cars, 1 / 30, FAR_AWAY)
    for (const car of cars) {
      expect(car.distance).toBeGreaterThanOrEqual(0)
      expect(car.distance).toBeLessThan(total)
    }
  })

  it('does nothing for an empty fleet', () => {
    expect(() => advanceTraffic([], 0.16, FAR_AWAY)).not.toThrow()
  })
})

describe('vehicleColliders', () => {
  it('produces one solid box per vehicle, standing on the road', () => {
    const cars = createTraffic(5)
    const boxes = vehicleColliders(cars)
    expect(boxes).toHaveLength(5)
    for (const box of boxes) {
      expect(box.min[1]).toBeCloseTo(0, 6)
      expect(box.max[1]).toBeCloseTo(VEHICLE.height, 6)
      expect(box.max[0] - box.min[0]).toBeGreaterThan(0)
      expect(box.max[2] - box.min[2]).toBeGreaterThan(0)
    }
  })

  it('orients the box along the lane on the straights', () => {
    // Mid-way up the east lane, the loop runs along z, so the box is long in z.
    const car: Vehicle = { id: 'a', distance: 60, cruise: 8, speed: 8, tint: 0 }
    const [box] = vehicleColliders([car])
    expect(box.max[2] - box.min[2]).toBeCloseTo(VEHICLE.length, 6)
    expect(box.max[0] - box.min[0]).toBeCloseTo(VEHICLE.width, 6)
  })
})

describe('the traffic loop itself', () => {
  it('turns around beyond both ends of the walkable boulevard', () => {
    // z 34..150 is walkable. Turns at 30 and 156 keep U-turns out of sight.
    const zs = TRAFFIC_LOOP.map((p) => p.z)
    expect(Math.min(...zs)).toBeLessThan(34)
    expect(Math.max(...zs)).toBeGreaterThan(150)
  })

  it('keeps both lanes inside the 15 m roadway', () => {
    for (const point of TRAFFIC_LOOP) {
      expect(Math.abs(point.x) + VEHICLE.width / 2).toBeLessThan(7.5)
    }
  })
})
