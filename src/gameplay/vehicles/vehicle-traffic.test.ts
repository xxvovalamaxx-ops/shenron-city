import { describe, expect, it } from 'vitest'
import { aabb, type AABB } from '../collision'
import { AabbVehicleWorld } from './vehicle-collision'
import { createDefaultLayout, transitionVehicle, type VehicleRegistry } from './vehicle-entities'
import { BOULEVARD_LOOP, nearestLanePoint, pointAlongLane } from './vehicle-lanes'
import {
  aiInputFor,
  laneCurveSpeedCap,
  stepAiVehicle,
  updatePedestrians,
  updateTrafficDirector,
  wrapAngle,
} from './vehicle-traffic'

const FLOOR: AABB = aabb(400, 0, 400, 2000, 1, 2000)
const world = new AabbVehicleWorld([FLOOR])

function aiEntity(registry: VehicleRegistry, distance: number, targetSpeed = 8) {
  const lane = BOULEVARD_LOOP
  const { point, heading } = pointAlongLane(lane, distance)
  const entity = [...registry.vehicles.values()].find((v) => v.state === 'AI_CONTROLLED')
  if (!entity) throw new Error('layout has no AI vehicle')
  entity.pose = { pos: { ...point, y: 0.5 }, heading }
  entity.ai = { laneId: lane.id, distance, targetSpeed, reactionClock: 0 }
  return entity
}

describe('lane following', () => {
  it('steers toward the centre-line from a lateral offset', () => {
    const { registry } = createDefaultLayout(4)
    const entity = aiEntity(registry, 0)
    // Push the car to the right of the lane (positive lateral, +Z at this
    // segment's heading of +X) — it must steer left, i.e. positive.
    entity.pose.pos.z += 3
    const input = aiInputFor(entity, BOULEVARD_LOOP, [], [])
    expect(input.steer).toBeGreaterThan(0)
  })

  it('aligns heading with the lane ahead', () => {
    const { registry } = createDefaultLayout(4)
    const entity = aiEntity(registry, 0)
    const input = aiInputFor(entity, BOULEVARD_LOOP, [], [])
    expect(input.steer).toBeCloseTo(0, 9)
  })

  it('brakes for a close leader and matches its pace at the follow gap', () => {
    const { registry } = createDefaultLayout(4)
    const entity = aiEntity(registry, 0, 8)
    entity.motion.speed = 5
    const ahead = pointAlongLane(BOULEVARD_LOOP, 4)
    const input = aiInputFor(entity, BOULEVARD_LOOP, [{ pose: { pos: { ...ahead.point, y: 0.5 }, heading: ahead.heading }, speed: 3 }], [])
    expect(input.brake).toBeGreaterThan(0)
  })

  it('slows for oncoming pedestrians on the lane', () => {
    const { registry } = createDefaultLayout(4)
    const entity = aiEntity(registry, 0, 8)
    entity.motion.speed = 5
    const inFront = pointAlongLane(BOULEVARD_LOOP, 3)
    const input = aiInputFor(entity, BOULEVARD_LOOP, [], [
      { pos: { ...inFront.point, y: 0.5 }, radius: 0.3 },
    ])
    expect(input.brake).toBeGreaterThan(0)
  })

  it('curvature caps speed on corners', () => {
    expect(laneCurveSpeedCap(13.5, 0, 3.5)).toBe(13.5)
    expect(laneCurveSpeedCap(13.5, 0.05, 3.5)).toBeCloseTo(Math.sqrt(3.5 / 0.05), 6)
    expect(wrapAngle(0, 6)).toBeCloseTo(6 - 2 * Math.PI, 9)
  })
})

describe('AI stepping keeps traffic on its lane', () => {
  it('an AI vehicle converges onto the centre-line over a few seconds', () => {
    const { registry } = createDefaultLayout(4)
    const entity = aiEntity(registry, 100, 6)
    entity.pose.pos.z += 6
    const initialError = Math.abs(
      nearestLanePoint(BOULEVARD_LOOP, entity.pose.pos.x, entity.pose.pos.z).lateral,
    )
    for (let i = 0; i < 1200; i++) {
      stepAiVehicle(entity, world, 1 / 120, [], [])
    }
    const finalError = Math.abs(
      nearestLanePoint(BOULEVARD_LOOP, entity.pose.pos.x, entity.pose.pos.z).lateral,
    )
    expect(finalError).toBeLessThan(initialError)
    expect(finalError).toBeLessThan(1)
  })

  it('stepping is deterministic', () => {
    const run = () => {
      const { registry } = createDefaultLayout(4)
      const entity = aiEntity(registry, 200, 6)
      for (let i = 0; i < 300; i++) stepAiVehicle(entity, world, 1 / 120, [], [])
      return entity.pose
    }
    const a = run()
    const b = run()
    expect(a).toEqual(b)
  })
})

describe('traffic director', () => {
  it('returns an abandoned owned car to the AI after the delay, explicitly', () => {
    const { registry } = createDefaultLayout()
    const owned = [...registry.vehicles.values()].find((v) => v.owned)!
    expect(owned.state).toBe('PARKED')

    const clocks = new Map<number, number>()
    const playerFar = { x: owned.pose.pos.x + 300, y: 0, z: owned.pose.pos.z }
    const returned = updateTrafficDirector(registry, playerFar, 1 / 60, clocks, 200, 20)
    expect(returned).toEqual([])
    // Keep stepping until the clock expires.
    for (let i = 0; i < 60 * 21; i++) {
      updateTrafficDirector(registry, playerFar, 1 / 60, clocks, 200, 20)
    }
    expect(owned.state).toBe('AI_CONTROLLED')
    expect(owned.owned).toBe(false)
    expect(owned.ai).not.toBeNull()
  })

  it('never reclaims the car the player is using', () => {
    const { registry } = createDefaultLayout()
    const owned = [...registry.vehicles.values()].find((v) => v.owned)!
    transitionVehicle(registry, owned.id, 'ENTERING')
    const clocks = new Map<number, number>()
    const playerFar = { x: owned.pose.pos.x + 300, y: 0, z: owned.pose.pos.z }
    for (let i = 0; i < 60 * 60; i++) {
      updateTrafficDirector(registry, playerFar, 1 / 60, clocks, 200, 20)
    }
    expect(owned.state).toBe('ENTERING')
  })
})

describe('pedestrians', () => {
  it('walk their segment and reflect at the bound', () => {
    const peds = updatePedestrians(
      [
        {
          id: 1,
          pos: { x: 0, y: 0.5, z: 0 },
          radius: 0.3,
          displaced: false,
          downTimer: 0,
          dir: { x: 0, z: 1 },
          speed: 1,
          anchor: { x: 0, y: 0.5, z: 0 },
          offset: 0,
          bound: 2,
        },
      ],
      1,
    )
    expect(peds[0].offset).toBeCloseTo(1, 9)
    const reflected = updatePedestrians(peds, 2)
    expect(reflected[0].dir.z).toBe(-1)
    expect(reflected[0].offset).toBeCloseTo(1, 9)
  })
})
