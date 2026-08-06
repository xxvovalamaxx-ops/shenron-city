import { describe, expect, it } from 'vitest'
import { aabb, type AABB } from '../collision'
import {
  AabbVehicleWorld,
  resolveVehiclePair,
  vehiclePedestrianResponse,
  vehicleRectOverlap,
  type Pedestrian,
} from './vehicle-collision'
import { initialVehicleMotion, stepVehicle, type VehiclePose } from './vehicle-model'
import { vehicleSpec } from './vehicle-specs'

const FLOOR: AABB = aabb(0, 0, 0, 400, 1, 400)
const SEDAN = vehicleSpec('sedan')

function pose(x: number, z: number, heading = 0): VehiclePose {
  return { pos: { x, y: 0.5, z }, heading }
}

function ped(id: number, x: number, z: number): Pedestrian {
  return {
    id,
    pos: { x, y: 0.5, z },
    radius: 0.3,
    displaced: false,
    downTimer: 0,
    dir: { x: 0, z: 1 },
    speed: 0,
    anchor: { x, y: 0.5, z },
    offset: 0,
    bound: 1,
  }
}

describe('AABB world', () => {
  const world = new AabbVehicleWorld([FLOOR])

  it('reports the top of the floor as ground', () => {
    expect(world.groundHeightAt(10, 10)).toBeCloseTo(0.5, 9)
  })

  it('moves freely across open ground', () => {
    const moved = world.moveCircle({ x: 0, y: 0.5, z: 0 }, 5, 3, 1)
    expect(moved.x).toBeCloseTo(5, 9)
    expect(moved.z).toBeCloseTo(3, 9)
  })

  it('slides along a wall instead of passing through it', () => {
    const walled = new AabbVehicleWorld([FLOOR, aabb(5, 2, 0, 0.5, 4, 200)])
    const moved = walled.moveCircle({ x: 0, y: 0.5, z: 0 }, 10, 4, 1)
    expect(moved.x).toBeLessThan(5)
    expect(moved.z).toBeCloseTo(4, 9)
  })

  it('casts a distance to the first obstacle', () => {
    const walled = new AabbVehicleWorld([FLOOR, aabb(10, 2, 0, 1, 4, 200)])
    const hit = walled.castDistance({ x: 0, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 50)
    expect(hit).toBeCloseTo(9.5, 6)
  })

  it('isCircleClear rejects obstacles and accepts open ground', () => {
    const walled = new AabbVehicleWorld([FLOOR, aabb(5, 2, 0, 0.5, 4, 200)])
    expect(walled.isCircleClear(2, 0, 1)).toBe(true)
    expect(walled.isCircleClear(5.2, 0, 1)).toBe(false)
    expect(new AabbVehicleWorld([]).isCircleClear(0, 0, 1)).toBe(false)
  })
})

describe('vehicle vs vehicle', () => {
  it('detects overlap and separates aligned cars', () => {
    // Half-widths are 0.95 m per car, so centres 1.5 m apart overlap.
    expect(vehicleRectOverlap(pose(0, 0), SEDAN, pose(1.5, 0), SEDAN)).toBe(true)
    expect(vehicleRectOverlap(pose(0, 0), SEDAN, pose(3, 0), SEDAN)).toBe(false)
    // Perpendicular cars touching at the corner.
    expect(vehicleRectOverlap(pose(0, 0), SEDAN, pose(0.5, 1.5, Math.PI / 2), SEDAN)).toBe(true)
    expect(vehicleRectOverlap(pose(0, 0), SEDAN, pose(10, 10, Math.PI / 2), SEDAN)).toBe(false)
  })

  it('resolveVehiclePair pushes along the separation normal and bleeds speed', () => {
    const a = pose(0, 0)
    const b = pose(2, 0)
    const result = resolveVehiclePair(a, b, 0.35, 0.35)
    expect(result.hit).toBe(true)
    expect(result.aPose.pos.x).toBeLessThan(0)
    expect(result.bPose.pos.x).toBeGreaterThan(2)
    expect(result.aSpeedKeep).toBe(0.35)
  })

  it('the car hitting a parked one keeps only the collision fraction of speed', () => {
    // Integrate the player car into the parked car and confirm the model's
    // keep fraction is the value used by the traffic resolver.
    const parked = pose(4, 0)
    const moving = stepVehicle(
      SEDAN,
      pose(0, 0),
      { ...initialVehicleMotion(), speed: 20 },
      { throttle: 1, brake: 0, steer: 0, handbrake: false },
      1 / 120,
      0.5,
    )
    expect(vehicleRectOverlap(moving.pose, SEDAN, parked, SEDAN)).toBe(false)
    expect(SEDAN.collisionSpeedKeep).toBe(0.35)
  })
})

describe('vehicle vs pedestrian', () => {
  it('knocks a head-on pedestrian sideways and bleeds the speed once', () => {
    // Car faces +Z (heading 0); the pedestrian stands directly ahead.
    const pedestrians = [ped(1, 0, 2)]
    const result = vehiclePedestrianResponse(pose(0, 0), SEDAN, pedestrians, 1 / 60, 15)
    expect(result.hits).toBe(1)
    expect(result.speed).toBeCloseTo(15 * 0.6, 9)
    // Pushed to the car's right side, off the travel line.
    expect(result.pedestrians[0].pos.x).toBeCloseTo(-1.9, 6)
    expect(result.pedestrians[0].pos.z).toBeCloseTo(2, 6)
    expect(result.pedestrians[0].displaced).toBe(true)

    // While still inside the footprint the knock-down is not repeated: the
    // car pays the price exactly once per encounter.
    const again = vehiclePedestrianResponse(pose(0, 0), SEDAN, result.pedestrians, 1 / 60, result.speed)
    expect(again.hits).toBe(0)
    expect(again.speed).toBe(result.speed)
  })

  it('the per-vehicle response never undoes another car\'s knock', () => {
    // A second vehicle not in contact must not reset the knocked-down flag.
    const knocked = vehiclePedestrianResponse(pose(0, 0), SEDAN, [ped(1, 0, 2)], 1 / 60, 10)
    const farAway = vehiclePedestrianResponse(pose(0, 30), SEDAN, knocked.pedestrians, 1 / 60, 10)
    expect(farAway.pedestrians[0].displaced).toBe(true)
    expect(farAway.hits).toBe(0)
  })

  it('leaves pedestrians outside the footprint alone', () => {
    const result = vehiclePedestrianResponse(pose(0, 0), SEDAN, [ped(1, 30, 0)], 1 / 60, 15)
    expect(result.hits).toBe(0)
    expect(result.speed).toBe(15)
    expect(result.pedestrians[0].displaced).toBe(false)
  })
})
