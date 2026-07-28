/**
 * A third-person boom that ignores geometry puts the camera inside the lobby
 * glass, the lift shaft, and the back of the tower. These cover the geometry
 * so it does not have to be eyeballed.
 */
import { describe, expect, it } from 'vitest'
import { aabb, type AABB } from './collision'
import {
  BOOM_DISTANCE,
  BOOM_PADDING,
  boomDistance,
  MIN_BOOM,
  rayBoxDistance,
  smoothBoom,
} from './camera-boom'

const EYE = { x: 0, y: 1.66, z: 0 }
/** Looking toward -z, so the boom runs toward +z. */
const FORWARD = { x: 0, y: 0, z: -1 }

describe('rayBoxDistance', () => {
  it('finds the entry distance to a box straight ahead', () => {
    const box = aabb(0, 1.66, 5, 2, 2, 2)
    expect(rayBoxDistance(EYE, { x: 0, y: 0, z: 1 }, box)).toBeCloseTo(4, 6)
  })

  it('misses a box off to the side', () => {
    const box = aabb(9, 1.66, 5, 2, 2, 2)
    expect(rayBoxDistance(EYE, { x: 0, y: 0, z: 1 }, box)).toBeNull()
  })

  it('misses a box behind the ray', () => {
    const box = aabb(0, 1.66, -5, 2, 2, 2)
    expect(rayBoxDistance(EYE, { x: 0, y: 0, z: 1 }, box)).toBeNull()
  })

  it('handles a direction parallel to a slab without dividing by zero', () => {
    // Straight down a corridor: no x or y component at all.
    const box = aabb(0, 1.66, 6, 40, 40, 2)
    const hit = rayBoxDistance(EYE, { x: 0, y: 0, z: 1 }, box)
    expect(hit).not.toBeNull()
    expect(Number.isFinite(hit as number)).toBe(true)
  })

  it('returns 0 when the ray starts inside the box', () => {
    expect(rayBoxDistance(EYE, { x: 0, y: 0, z: 1 }, aabb(0, 1.66, 0, 4, 4, 4))).toBe(0)
  })
})

describe('boomDistance', () => {
  it('uses the full length when nothing is behind the player', () => {
    expect(boomDistance(EYE, FORWARD, [])).toBeCloseTo(BOOM_DISTANCE, 6)
  })

  it('pulls in short of a wall, by the padding', () => {
    // Wall 2 m behind: boom runs +z, wall face at z = 2.
    const wall: AABB = aabb(0, 1.66, 3, 20, 6, 2)
    expect(boomDistance(EYE, FORWARD, [wall])).toBeCloseTo(2 - BOOM_PADDING, 6)
  })

  it('never goes closer than the minimum, even flush against a wall', () => {
    const wall: AABB = aabb(0, 1.66, 0.2, 20, 6, 0.2)
    expect(boomDistance(EYE, FORWARD, [wall])).toBeGreaterThanOrEqual(MIN_BOOM)
  })

  it('takes the nearest of several walls', () => {
    const far: AABB = aabb(0, 1.66, 6, 20, 6, 1)
    const near: AABB = aabb(0, 1.66, 2.5, 20, 6, 1)
    expect(boomDistance(EYE, FORWARD, [far, near])).toBeCloseTo(2 - BOOM_PADDING, 6)
  })

  it('ignores geometry in front of the player', () => {
    // A wall the player is facing must not shorten a boom that runs backwards.
    const ahead: AABB = aabb(0, 1.66, -3, 20, 6, 1)
    expect(boomDistance(EYE, FORWARD, [ahead])).toBeCloseTo(BOOM_DISTANCE, 6)
  })

  it('works for any look direction, not just down an axis', () => {
    const dir = { x: Math.SQRT1_2, y: 0, z: -Math.SQRT1_2 }
    const behind: AABB = aabb(-2, 1.66, 2, 1, 6, 1)
    const d = boomDistance(EYE, dir, [behind])
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThanOrEqual(BOOM_DISTANCE)
  })

  it('degrades to zero rather than NaN for a nonsensical length', () => {
    for (const bad of [0, -1, NaN]) {
      expect(boomDistance(EYE, FORWARD, [], bad)).toBe(0)
    }
  })

  it('returns the full length for a degenerate direction instead of dividing by zero', () => {
    expect(boomDistance(EYE, { x: 0, y: 0, z: 0 }, [])).toBeCloseTo(BOOM_DISTANCE, 6)
  })
})

describe('smoothBoom', () => {
  it('snaps inward immediately — a frame inside a wall is a frame too many', () => {
    expect(smoothBoom(3.6, 1.2, 1 / 60)).toBe(1.2)
  })

  it('eases outward rather than popping', () => {
    const next = smoothBoom(1.2, 3.6, 1 / 60)
    expect(next).toBeGreaterThan(1.2)
    expect(next).toBeLessThan(3.6)
  })

  it('converges on the target when given time', () => {
    let v = 1.2
    for (let i = 0; i < 240; i++) v = smoothBoom(v, 3.6, 1 / 60)
    expect(v).toBeCloseTo(3.6, 3)
  })

  it('recovers from a non-finite current value', () => {
    expect(smoothBoom(NaN, 2.4, 1 / 60)).toBe(2.4)
  })
})
