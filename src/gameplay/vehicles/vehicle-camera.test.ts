import { describe, expect, it } from 'vitest'
import { aabb, type AABB } from '../collision'
import { AabbVehicleWorld } from './vehicle-collision'
import { BOOM_DISTANCE, MIN_BOOM } from '../camera-boom'
import {
  computeVehicleCamera,
  COCKPIT_EYE_HEIGHT,
  easeVehicleCamera,
  initialVehicleCamera,
} from './vehicle-camera'
import { vehicleSpec } from './vehicle-specs'

const SEDAN = vehicleSpec('sedan')
const dt = 1 / 60

function pose(heading = 0) {
  return { pos: { x: 0, y: 0.5, z: 0 }, heading }
}

describe('chase camera', () => {
  it('sits behind the vehicle at the boom distance on open ground', () => {
    const world = new AabbVehicleWorld([aabb(0, 0, 0, 400, 1, 400)])
    const frame = computeVehicleCamera(pose(0), SEDAN, 'chase', initialVehicleCamera(), world, dt)
    // Heading 0 faces +Z; the camera hangs behind at -Z.
    expect(frame.pos.x).toBeCloseTo(0, 6)
    expect(frame.pos.z).toBeCloseTo(-BOOM_DISTANCE, 1)
    expect(frame.pos.y).toBeCloseTo(0.5 + 2.4, 6)
    expect(frame.boom).toBeCloseTo(BOOM_DISTANCE, 1)
  })

  it('pulls in before a wall behind the car', () => {
    // Wall three metres behind the car; the full boom would put the camera
    // through it.
    const wall: AABB = aabb(0, 2, -3, 400, 4, 0.5)
    const world = new AabbVehicleWorld([aabb(0, 0, 0, 400, 1, 400), wall])
    const frame = computeVehicleCamera(pose(0), SEDAN, 'chase', initialVehicleCamera(), world, dt)
    expect(frame.boom).toBeLessThan(BOOM_DISTANCE)
    expect(frame.boom).toBeGreaterThanOrEqual(MIN_BOOM - 1e-9)
    // Camera stays clear of the wall's near face (z = -3.25).
    expect(frame.pos.z).toBeGreaterThan(-3.25)
  })

  it('tracks the heading: the camera rotates with the car', () => {
    const world = new AabbVehicleWorld([aabb(0, 0, 0, 400, 1, 400)])
    const frame = computeVehicleCamera(pose(Math.PI / 2), SEDAN, 'chase', initialVehicleCamera(), world, dt)
    // Heading π/2 faces +X; the camera sits at -X.
    expect(frame.pos.x).toBeCloseTo(-BOOM_DISTANCE, 1)
    expect(frame.pos.z).toBeCloseTo(0, 6)
  })

  it('eases toward the target instead of jumping', () => {
    const world = new AabbVehicleWorld([aabb(0, 0, 0, 400, 1, 400)])
    const from = { pos: { x: 0, y: 0.5, z: 0 }, target: { x: 0, y: 0, z: 0 }, boom: 0.5 }
    const frame = computeVehicleCamera(pose(0), SEDAN, 'chase', from, world, dt)
    const eased = easeVehicleCamera(from, frame, dt)
    expect(eased.pos.z).toBeLessThan(0)
    expect(eased.pos.z).toBeGreaterThan(frame.pos.z)
  })
})

describe('cockpit camera', () => {
  it('sits at the seat with the driver eye height, looking along the heading', () => {
    const world = new AabbVehicleWorld([aabb(0, 0, 0, 400, 1, 400)])
    const frame = computeVehicleCamera(pose(0), SEDAN, 'cockpit', initialVehicleCamera(), world, dt)
    // Heading 0 faces +Z; the seat z=-0.45 lies behind the axle midpoint.
    expect(frame.pos.z).toBeCloseTo(SEDAN.seat.z, 6)
    expect(frame.pos.y).toBeCloseTo(0.5 + SEDAN.seat.y + COCKPIT_EYE_HEIGHT, 6)
    expect(frame.target.z).toBeGreaterThan(frame.pos.z)
    expect(frame.boom).toBe(0)
  })
})
