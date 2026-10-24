import { describe, expect, it } from 'vitest'
import { aabb, type AABB } from '../collision'
import { AabbVehicleWorld } from './vehicle-collision'
import { MIN_BOOM } from '../camera-boom'
import {
  chaseDistance,
  chaseHeight,
  computeVehicleCamera,
  COCKPIT_EYE_HEIGHT,
  easeVehicleCamera,
  initialVehicleCamera,
  kickVehicleCamera,
  speedFov,
  type VehicleCameraState,
} from './vehicle-camera'
import { vehicleSpec } from './vehicle-specs'

const SEDAN = vehicleSpec('sedan')
const dt = 1 / 60
const open = new AabbVehicleWorld([aabb(0, 0, 0, 400, 1, 400)])

function pose(heading = 0, x = 0, z = 0) {
  return { pos: { x, y: 0.5, z }, heading }
}

function settle(state: VehicleCameraState, heading: number, steps: number, speed = 0, lateral = 0): VehicleCameraState {
  let s = state
  for (let i = 0; i < steps; i++) {
    const frame = computeVehicleCamera(pose(heading), SEDAN, 'chase', s, open, dt, { speed, lateral })
    s = easeVehicleCamera(s, frame, dt)
  }
  return s
}

describe('chase camera', () => {
  it('sits low and behind the vehicle on open ground', () => {
    const frame = computeVehicleCamera(pose(0), SEDAN, 'chase', initialVehicleCamera(), open, dt)
    // Heading 0 faces +Z; the camera hangs behind at -Z, above the roof.
    expect(frame.pos.x).toBeCloseTo(0, 6)
    expect(frame.pos.z).toBeCloseTo(-chaseDistance(SEDAN, 0), 6)
    expect(frame.pos.y).toBeCloseTo(0.5 + chaseHeight(SEDAN), 6)
    expect(frame.pos.y - 0.5).toBeLessThan(2.5)
    expect(frame.target.z).toBeGreaterThan(0)
  })

  it('pulls in before a wall behind the car', () => {
    const wall: AABB = aabb(0, 2, -3, 400, 4, 0.5)
    const world = new AabbVehicleWorld([aabb(0, 0, 0, 400, 1, 400), wall])
    const frame = computeVehicleCamera(pose(0), SEDAN, 'chase', initialVehicleCamera(), world, dt)
    expect(frame.boom).toBeLessThan(chaseDistance(SEDAN, 0))
    expect(frame.boom).toBeGreaterThanOrEqual(MIN_BOOM - 1e-9)
    expect(frame.pos.z).toBeGreaterThan(-3.25)
  })

  it('trails a turn: the orbit lags the heading, then catches up', () => {
    const start = settle(initialVehicleCamera(), 0, 5)
    const turned = settle(start, 0.6, 6)
    // Lagging behind the new heading, but moving toward it.
    expect(turned.yaw).toBeGreaterThan(0.05)
    expect(turned.yaw).toBeLessThan(0.55)
    const caught = settle(turned, 0.6, 400)
    expect(caught.yaw).toBeCloseTo(0.6, 3)
  })

  it('leans toward the direction of travel while sliding', () => {
    const straight = settle(initialVehicleCamera(), 0, 300, 20, 0)
    const sliding = settle(initialVehicleCamera(), 0, 300, 20, 3)
    expect(straight.yaw).toBeCloseTo(0, 6)
    // sliding right (positive lateral) bends the camera toward lower heading
    expect(sliding.yaw).toBeLessThan(-0.02)
  })

  it('widens the field of view and the boom with speed', () => {
    expect(speedFov(SEDAN, 5)).toBe(0)
    expect(speedFov(SEDAN, SEDAN.maxForwardSpeed)).toBeGreaterThan(10)
    expect(chaseDistance(SEDAN, 40)).toBeGreaterThan(chaseDistance(SEDAN, 0))
    const fast = settle(initialVehicleCamera(), 0, 400, SEDAN.maxForwardSpeed)
    expect(fast.fov).toBeGreaterThan(10)
  })

  it('looks behind when asked', () => {
    let s = settle(initialVehicleCamera(), 0, 5)
    for (let i = 0; i < 120; i++) {
      const frame = computeVehicleCamera(pose(0), SEDAN, 'chase', s, open, dt, { speed: 0, lateral: 0 }, { lookBehind: true })
      s = easeVehicleCamera(s, frame, dt)
    }
    // camera in front of the car, looking back down -Z
    expect(s.pos.z).toBeGreaterThan(2)
    expect(s.target.z).toBeLessThan(s.pos.z)
  })

  it('a crash shakes the camera and the shake dies away', () => {
    const s = settle(initialVehicleCamera(), 0, 5)
    kickVehicleCamera(s, 15)
    expect(s.shake).toBeGreaterThan(0.2)
    const later = settle(s, 0, 180)
    expect(later.shake).toBeLessThan(0.01)
  })

  it('is deterministic', () => {
    const a = settle(initialVehicleCamera(), 0.3, 200, 18, 1.2)
    const b = settle(initialVehicleCamera(), 0.3, 200, 18, 1.2)
    expect(a).toEqual(b)
  })
})

describe('cockpit camera', () => {
  it('sits at the seat with the driver eye height, looking along the heading', () => {
    const frame = computeVehicleCamera(pose(0), SEDAN, 'cockpit', initialVehicleCamera(), open, dt)
    expect(frame.pos.z).toBeCloseTo(SEDAN.seat.z, 6)
    expect(frame.pos.y).toBeCloseTo(0.5 + SEDAN.seat.y + COCKPIT_EYE_HEIGHT, 6)
    expect(frame.target.z).toBeGreaterThan(frame.pos.z)
    expect(frame.boom).toBe(0)
  })
})
