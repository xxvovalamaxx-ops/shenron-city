import { describe, expect, it } from 'vitest'

import { createRegistry } from './vehicle-entities'
import {
  laneToWorld,
  projectOntoLane,
  nearestLane,
  promoteTrafficCar,
  demoteToTraffic,
  countRepresentations,
  type HandoffLane,
  type TrafficCar,
} from './vehicle-handoff'

const ROAD_Y = 12.05

/** A straight lane running due east from the origin, `len` metres long. */
function eastLane(len = 100, speed = 11): HandoffLane {
  return { pts: [[0, 0], [len, 0]], cum: [0, len], len, speed }
}

/** An L: 100 m east, then 100 m north. */
function elbowLane(): HandoffLane {
  return {
    pts: [[0, 0], [100, 0], [100, 100]],
    cum: [0, 100, 200],
    len: 200,
    speed: 11,
  }
}

function car(over: Partial<TrafficCar> = {}): TrafficCar {
  return { lane: 0, s: 50, v: 9, seed: 1234, alive: true, ...over }
}

describe('laneToWorld', () => {
  it('places a car on the lane, with world z the negated northing', () => {
    const p = laneToWorld(eastLane(), 25, ROAD_Y)
    expect(p.pos.x).toBeCloseTo(25, 9)
    expect(p.pos.y).toBe(ROAD_Y)
    expect(p.pos.z).toBeCloseTo(-0, 9)
    expect(p.heading).toBeCloseTo(0, 9)
  })

  it('carries the plane heading through unchanged, as the renderer does', () => {
    // Second segment runs north (+y), which is heading pi/2 and world -z.
    const p = laneToWorld(elbowLane(), 150, ROAD_Y)
    expect(p.pos.x).toBeCloseTo(100, 9)
    expect(p.pos.z).toBeCloseTo(-50, 9)
    expect(p.heading).toBeCloseTo(Math.PI / 2, 9)
  })

  it('clamps past the end rather than extrapolating into a building', () => {
    const lane = eastLane(100)
    const past = laneToWorld(lane, 400, ROAD_Y)
    const end = laneToWorld(lane, 100, ROAD_Y)
    expect(past.pos.x).toBeCloseTo(end.pos.x, 9)
    expect(past.pos.x).toBeCloseTo(100, 9)
  })

  it('clamps a negative arclength to the lane start', () => {
    expect(laneToWorld(eastLane(), -30, ROAD_Y).pos.x).toBeCloseTo(0, 9)
  })
})

describe('laneToWorld agrees with the shipping renderer', () => {
  // The module header claims this mirrors Traffic._pointAt and Traffic._render.
  // A claim like that is worth exactly as much as its differential test, so
  // here it is against the real implementation rather than a copy of it.
  // _pointAt reads only its arguments, so it runs off the prototype with no
  // instance and no Three scene.
  it('matches Traffic._pointAt across both segments of a bent lane', async () => {
    const { Traffic } = (await import('../../city/traffic.js')) as unknown as {
      Traffic: { prototype: { _pointAt(lane: unknown, s: number): [number, number, number] } }
    }
    const pointAt = Traffic.prototype._pointAt
    const lane = elbowLane()

    // _pointAt is called by _render as _pointAt(lane, min(v.s, lane.len)), so
    // the shared domain is [0, len]; clamping outside it is this module's own
    // addition and is covered separately above.
    for (let s = 0; s <= lane.len; s += 3.7) {
      const [x, y, heading] = pointAt.call(null, lane, s)
      const mine = laneToWorld(lane, s, ROAD_Y)
      expect(mine.pos.x).toBeCloseTo(x, 9)
      // _render does dummy.position.set(x, roadY, -y).
      expect(mine.pos.z).toBeCloseTo(-y, 9)
      // _render does dummy.rotation.set(0, head, 0).
      expect(mine.heading).toBeCloseTo(heading, 9)
    }
  })
})

describe('projectOntoLane', () => {
  it('finds the perpendicular foot and its distance', () => {
    // 40 m east, 5 m north of a due-east lane.
    const p = projectOntoLane(eastLane(), 40, -5)
    expect(p.s).toBeCloseTo(40, 6)
    expect(p.distance).toBeCloseTo(5, 6)
  })

  it('clamps to the segment ends instead of the infinite line', () => {
    // Without the clamp this reports s = -50 on a lane that starts at 0.
    const p = projectOntoLane(eastLane(100), -50, 0)
    expect(p.s).toBeCloseTo(0, 6)
    expect(p.distance).toBeCloseTo(50, 6)
  })

  it('picks the nearer segment of a bent lane', () => {
    // Just off the northbound leg.
    const p = projectOntoLane(elbowLane(), 103, -60)
    expect(p.s).toBeCloseTo(160, 6)
    expect(p.distance).toBeCloseTo(3, 6)
  })

  it('round-trips with laneToWorld', () => {
    const lane = elbowLane()
    for (const s of [0, 17, 99.5, 100, 137, 200]) {
      const w = laneToWorld(lane, s, ROAD_Y)
      const back = projectOntoLane(lane, w.pos.x, w.pos.z)
      expect(back.s).toBeCloseTo(s, 6)
      expect(back.distance).toBeCloseTo(0, 6)
    }
  })
})

describe('nearestLane', () => {
  const lanes: HandoffLane[] = [
    eastLane(100),
    { pts: [[0, 60], [100, 60]], cum: [0, 100], len: 100, speed: 11 },
  ]

  it('chooses the closest lane', () => {
    const n = nearestLane(lanes, 50, -58)
    expect(n?.laneId).toBe(1)
    expect(n?.distance).toBeCloseTo(2, 6)
  })

  it('returns null beyond the range instead of a far-away guess', () => {
    // A car abandoned on a plaza. Handing LION a lane 40 m away would
    // teleport it sideways on the next frame.
    expect(nearestLane(lanes, 50, -300, 12)).toBeNull()
  })
})

describe('promoteTrafficCar — one representation at a time', () => {
  it('removes the car from traffic in the same call that creates the entity', () => {
    // The defect, stated directly: entering a city car used to spawn a second
    // one, so the world briefly contained two of it in the same place.
    const lanes = [eastLane()]
    const traffic = [car({ seed: 7 })]
    const registry = createRegistry()

    const result = promoteTrafficCar(traffic, traffic[0], lanes, registry, ROAD_Y)
    expect(result).not.toBeNull()
    expect(traffic).toHaveLength(0)
    expect(registry.vehicles.size).toBe(1)
    expect(countRepresentations(traffic, registry, result!.entity.id)).toBe(1)
  })

  it('starts the entity exactly where the instanced car was drawn', () => {
    const lanes = [elbowLane()]
    const traffic = [car({ lane: 0, s: 150 })]
    const registry = createRegistry()
    const drawn = laneToWorld(lanes[0], 150, ROAD_Y)

    const { entity } = promoteTrafficCar(traffic, traffic[0], lanes, registry, ROAD_Y)!
    expect(entity.pose.pos.x).toBeCloseTo(drawn.pos.x, 9)
    expect(entity.pose.pos.y).toBeCloseTo(drawn.pos.y, 9)
    expect(entity.pose.pos.z).toBeCloseTo(drawn.pos.z, 9)
    expect(entity.pose.heading).toBeCloseTo(drawn.heading, 9)
  })

  it('carries the speed across so a moving car does not stop dead', () => {
    const registry = createRegistry()
    const traffic = [car({ v: 12.5 })]
    const { entity } = promoteTrafficCar(traffic, traffic[0], [eastLane()], registry, ROAD_Y)!
    expect(entity.motion.speed).toBeCloseTo(12.5, 9)
  })

  it('keeps the lane position on the entity, so demotion has somewhere to go', () => {
    const registry = createRegistry()
    const traffic = [car({ lane: 0, s: 42 })]
    const { entity } = promoteTrafficCar(traffic, traffic[0], [eastLane()], registry, ROAD_Y)!
    expect(entity.ai?.laneId).toBe('0')
    expect(entity.ai?.distance).toBeCloseTo(42, 9)
    expect(entity.ai?.targetSpeed).toBeCloseTo(11, 9)
  })

  it('refuses a car that is not in the array', () => {
    const registry = createRegistry()
    const traffic = [car({ seed: 1 })]
    const stranger = car({ seed: 2 })
    expect(promoteTrafficCar(traffic, stranger, [eastLane()], registry, ROAD_Y)).toBeNull()
    expect(traffic).toHaveLength(1)
    expect(registry.vehicles.size).toBe(0)
  })

  it('refuses a car whose lane does not exist, without removing it', () => {
    const registry = createRegistry()
    const traffic = [car({ lane: 99 })]
    expect(promoteTrafficCar(traffic, traffic[0], [eastLane()], registry, ROAD_Y)).toBeNull()
    expect(traffic).toHaveLength(1)
  })

  it('cannot be promoted twice — the second call finds nothing to take', () => {
    const registry = createRegistry()
    const traffic = [car()]
    const target = traffic[0]
    expect(promoteTrafficCar(traffic, target, [eastLane()], registry, ROAD_Y)).not.toBeNull()
    expect(promoteTrafficCar(traffic, target, [eastLane()], registry, ROAD_Y)).toBeNull()
    expect(registry.vehicles.size).toBe(1)
  })
})

describe('demoteToTraffic — the defined way back', () => {
  it('puts the car back on the nearest lane and drops the entity', () => {
    const lanes = [eastLane(200)]
    const traffic: TrafficCar[] = []
    const registry = createRegistry()
    const seeded = [car({ s: 60 })]
    const { entity } = promoteTrafficCar(seeded, seeded[0], lanes, registry, ROAD_Y)!

    // Drive it 20 m further east and 2 m off the centreline.
    entity.pose.pos.x = 80
    entity.pose.pos.z = -2
    entity.motion.speed = 8

    const back = demoteToTraffic(entity, traffic, lanes, registry)
    expect(back).not.toBeNull()
    expect(back!.lane).toBe(0)
    expect(back!.s).toBeCloseTo(80, 6)
    expect(back!.v).toBeCloseTo(8, 9)
    expect(registry.vehicles.size).toBe(0)
    expect(traffic).toHaveLength(1)
  })

  it('never hands back a negative speed', () => {
    // LION integrates s forward; a reversing car would drive backwards up its
    // own lane past the cars behind it.
    const lanes = [eastLane()]
    const registry = createRegistry()
    const seeded = [car()]
    const { entity } = promoteTrafficCar(seeded, seeded[0], lanes, registry, ROAD_Y)!
    entity.motion.speed = -4
    const back = demoteToTraffic(entity, [], lanes, registry)
    expect(back!.v).toBe(0)
  })

  it('leaves a car with no lane in range parked, rather than deleting it', () => {
    const lanes = [eastLane()]
    const traffic: TrafficCar[] = []
    const registry = createRegistry()
    const seeded = [car()]
    const { entity } = promoteTrafficCar(seeded, seeded[0], lanes, registry, ROAD_Y)!
    entity.pose.pos.z = -400 // abandoned well off the road

    expect(demoteToTraffic(entity, traffic, lanes, registry)).toBeNull()
    expect(traffic).toHaveLength(0)
    expect(registry.vehicles.has(entity.id)).toBe(true)
  })

  it('refuses to demote the car the player is sitting in', () => {
    const lanes = [eastLane()]
    const registry = createRegistry()
    const seeded = [car()]
    const { entity } = promoteTrafficCar(seeded, seeded[0], lanes, registry, ROAD_Y)!
    registry.playerVehicleId = entity.id

    expect(demoteToTraffic(entity, [], lanes, registry)).toBeNull()
    expect(registry.vehicles.has(entity.id)).toBe(true)
  })

  it('round-trips without duplicating or losing the car', () => {
    const lanes = [elbowLane()]
    const traffic = [car({ s: 120 })]
    const registry = createRegistry()

    const { entity } = promoteTrafficCar(traffic, traffic[0], lanes, registry, ROAD_Y)!
    expect(traffic).toHaveLength(0)
    expect(countRepresentations(traffic, registry, entity.id)).toBe(1)

    const back = demoteToTraffic(entity, traffic, lanes, registry)!
    expect(traffic).toHaveLength(1)
    expect(registry.vehicles.size).toBe(0)
    // Position survives the round trip.
    expect(back.s).toBeCloseTo(120, 6)
    expect(countRepresentations(traffic, registry, entity.id)).toBe(1)
  })
})
