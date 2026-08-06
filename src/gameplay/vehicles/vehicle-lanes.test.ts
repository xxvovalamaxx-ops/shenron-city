import { describe, expect, it } from 'vitest'
import {
  BOULEVARD_LOOP,
  laneLength,
  nearestLanePoint,
  pointAlongLane,
  wrapLaneDistance,
  type Lane,
} from './vehicle-lanes'

const STRAIGHT: Lane = {
  id: 'straight',
  loop: false,
  speedLimit: 10,
  laneWidth: 1.6,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 100 },
  ],
}

describe('path sampling', () => {
  it('projects a point onto the centre-line with signed lateral offset', () => {
    const sample = nearestLanePoint(STRAIGHT, 2, 50)
    expect(sample.point.x).toBeCloseTo(0, 9)
    expect(sample.point.z).toBeCloseTo(50, 9)
    // Travel heading 0 faces +Z, whose right is -X: x=2 is to the LEFT.
    expect(sample.lateral).toBeCloseTo(-2, 9)
    expect(sample.heading).toBeCloseTo(0, 9)
    expect(sample.distance).toBeCloseTo(50, 9)
  })

  it('clamps the projection onto the segment ends', () => {
    const before = nearestLanePoint(STRAIGHT, 0, -30)
    expect(before.point.z).toBeCloseTo(0, 9)
    const after = nearestLanePoint(STRAIGHT, 0, 300)
    expect(after.point.z).toBeCloseTo(100, 9)
  })

  it('pointAlongLane walks distance to position and heading', () => {
    const at = pointAlongLane(STRAIGHT, 25)
    expect(at.point.z).toBeCloseTo(25, 9)
    expect(at.heading).toBeCloseTo(0, 9)
  })

  it('wrapLaneDistance keeps looped lanes in range', () => {
    const length = laneLength(BOULEVARD_LOOP)
    expect(wrapLaneDistance(BOULEVARD_LOOP, length + 5)).toBeCloseTo(5, 9)
    expect(wrapLaneDistance(BOULEVARD_LOOP, -3)).toBeCloseTo(length - 3, 9)
    expect(wrapLaneDistance(BOULEVARD_LOOP, 0)).toBe(0)
  })

  it('reports curvature only where the lane bends', () => {
    const straight: Lane = {
      id: 'straight2',
      loop: false,
      speedLimit: 10,
      laneWidth: 1.6,
      points: [
        { x: 0, z: 0 },
        { x: 0, z: 100 },
      ],
    }
    expect(nearestLanePoint(straight, 0, 50).curvature).toBe(0)

    const corner: Lane = {
      id: 'corner',
      loop: false,
      speedLimit: 10,
      laneWidth: 1.6,
      points: [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 10 },
      ],
    }
    // The straight segment before the corner carries the discrete curvature
    // of the junction it ends on; the corner itself is well above zero.
    expect(nearestLanePoint(corner, 5, 0).curvature).toBeGreaterThan(0.01)
    expect(nearestLanePoint(corner, 10, 5).curvature).toBeGreaterThan(0.01)
  })

  it('the boulevard loop is a closed polygon of positive length', () => {
    expect(BOULEVARD_LOOP.loop).toBe(true)
    expect(laneLength(BOULEVARD_LOOP)).toBeGreaterThan(1000)
  })
})
