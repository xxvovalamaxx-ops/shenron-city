/**
 * The orbit camera is arithmetic; a camera that ends up pitched straight at
 * the pavement, or orbiting the wrong way round the player, is caught here
 * rather than in a screenshot.
 */
import { describe, expect, it } from 'vitest'
import {
  ORBIT_DISTANCE,
  ORBIT_MIN_DISTANCE,
  ORBIT_PITCH_MAX,
  ORBIT_PITCH_MIN,
  ORBIT_SHOULDER,
  angleDelta,
  applyOrbitDelta,
  boomReach,
  clampPitch,
  damp,
  dampAngle,
  followPivot,
  groundLimitedReach,
  headBob,
  orbitCameraPose,
  orbitForward,
  orbitFov,
  orbitRight,
  turnToward,
  wrapAngle,
  yawFromForward,
} from './orbit-camera'

const PIVOT = { x: 10, y: 13.6, z: -20 }

describe('angles', () => {
  it('wraps yaw into (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9)
    expect(wrapAngle(-3 * Math.PI)).toBeCloseTo(Math.PI, 9)
    expect(wrapAngle(0.5)).toBeCloseTo(0.5, 12)
    expect(wrapAngle(Number.NaN)).toBe(0)
  })

  it('takes the short way round', () => {
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 9)
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2, 9)
  })

  it('clamps pitch to the orbit range', () => {
    expect(clampPitch(-2)).toBe(ORBIT_PITCH_MIN)
    expect(clampPitch(2)).toBe(ORBIT_PITCH_MAX)
    expect(clampPitch(Number.NaN)).toBe(0)
    expect(ORBIT_PITCH_MIN).toBeCloseTo((-60 * Math.PI) / 180, 9)
    expect(ORBIT_PITCH_MAX).toBeCloseTo((70 * Math.PI) / 180, 9)
  })
})

describe('applyOrbitDelta', () => {
  it('turns right for a mouse moved right, and looks down for a mouse moved down', () => {
    const next = applyOrbitDelta({ yaw: 0, pitch: 0 }, 100, 50)
    expect(next.yaw).toBeLessThan(0)
    expect(next.pitch).toBeLessThan(0)
    expect(next.yaw).toBeCloseTo(-0.2, 9)
    expect(next.pitch).toBeCloseTo(-0.1, 9)
  })

  it('scales with sensitivity', () => {
    expect(applyOrbitDelta({ yaw: 0, pitch: 0 }, 100, 0, 2).yaw).toBeCloseTo(-0.4, 9)
  })

  it('never passes the pitch limits', () => {
    expect(applyOrbitDelta({ yaw: 0, pitch: 0 }, 0, 100000).pitch).toBe(ORBIT_PITCH_MIN)
    expect(applyOrbitDelta({ yaw: 0, pitch: 0 }, 0, -100000).pitch).toBe(ORBIT_PITCH_MAX)
  })

  it('ignores non-finite deltas instead of poisoning the camera', () => {
    const next = applyOrbitDelta({ yaw: 0.3, pitch: -0.2 }, Number.NaN, Number.POSITIVE_INFINITY)
    expect(next).toEqual({ yaw: 0.3, pitch: -0.2 })
  })
})

describe('orbit geometry', () => {
  it('matches three.js camera conventions: yaw 0 looks down -Z, right is +X', () => {
    const f = orbitForward(0, 0)
    expect(f.x).toBeCloseTo(0, 12)
    expect(f.y).toBeCloseTo(0, 12)
    expect(f.z).toBeCloseTo(-1, 12)
    const right = orbitRight(0)
    expect(right.x).toBeCloseTo(1, 12)
    expect(right.z).toBeCloseTo(0, 12)
  })

  it('round-trips a heading through yawFromForward', () => {
    for (const yaw of [0, 0.7, -2.1, Math.PI / 2, 3]) {
      const f = orbitForward(yaw, 0)
      expect(wrapAngle(yawFromForward(f.x, f.z) - yaw)).toBeCloseTo(0, 9)
    }
    expect(yawFromForward(0, 0)).toBe(0)
  })

  it('puts a level camera behind the pivot, over the right shoulder, looking where the pivot looks', () => {
    const pose = orbitCameraPose(PIVOT, { yaw: 0, pitch: 0 }, ORBIT_DISTANCE, ORBIT_SHOULDER)
    // Behind (+Z when looking -Z), to the right (+X), level with the pivot.
    expect(pose.position.z).toBeCloseTo(PIVOT.z + ORBIT_DISTANCE, 9)
    expect(pose.position.x).toBeCloseTo(PIVOT.x + ORBIT_SHOULDER, 9)
    expect(pose.position.y).toBeCloseTo(PIVOT.y, 9)
    // The aim line is parallel to the boom, so the camera looks straight on.
    expect(pose.target.z).toBeLessThan(pose.position.z)
    expect(pose.target.x).toBeCloseTo(pose.position.x, 9)
  })

  it('rises above the player when looking down, and dips below when looking up', () => {
    const down = orbitCameraPose(PIVOT, { yaw: 0, pitch: -0.5 }, ORBIT_DISTANCE, 0)
    const up = orbitCameraPose(PIVOT, { yaw: 0, pitch: 0.5 }, ORBIT_DISTANCE, 0)
    expect(down.position.y).toBeGreaterThan(PIVOT.y)
    expect(up.position.y).toBeLessThan(PIVOT.y)
    // Boom length is preserved.
    const d = Math.hypot(down.position.x - PIVOT.x, down.position.y - PIVOT.y, down.position.z - PIVOT.z)
    expect(d).toBeCloseTo(ORBIT_DISTANCE, 9)
  })

  it('orbits: yawing a quarter turn left moves the camera to the pivot’s right-hand side', () => {
    const pose = orbitCameraPose(PIVOT, { yaw: Math.PI / 2, pitch: 0 }, ORBIT_DISTANCE, 0)
    // yaw +π/2 looks down -X, so the camera sits at +X.
    expect(pose.position.x).toBeCloseTo(PIVOT.x + ORBIT_DISTANCE, 9)
    expect(pose.position.z).toBeCloseTo(PIVOT.z, 9)
  })
})

describe('boom limits', () => {
  it('keeps the full boom when nothing is hit', () => {
    expect(boomReach(3.2, null)).toBe(3.2)
    expect(boomReach(3.2, 5)).toBe(3.2)
  })

  it('pulls in in front of a wall, never inside the head', () => {
    expect(boomReach(3.2, 2, 0.3)).toBeCloseTo(1.7, 9)
    expect(boomReach(3.2, 0.2, 0.3)).toBe(ORBIT_MIN_DISTANCE)
  })

  it('slides along the ground when the camera would go under it', () => {
    const from = { x: 0, y: 13.6, z: 0 }
    const below = { x: 0, y: 11, z: 3 }
    const reach = groundLimitedReach(from, below, 12, 0.25)
    const length = Math.hypot(0, below.y - from.y, 3)
    // The shortened boom ends at the clearance height.
    const y = from.y + ((below.y - from.y) * reach) / length
    expect(y).toBeCloseTo(12.25, 6)
    expect(groundLimitedReach(from, { x: 0, y: 14, z: 3 }, 12)).toBeCloseTo(Math.hypot(0.4, 3), 9)
    expect(groundLimitedReach(from, below, null)).toBeCloseTo(length, 9)
  })
})

describe('smoothing', () => {
  it('damps toward a target independent of frame rate', () => {
    const one = damp(0, 1, 5, 0.1)
    let two = 0
    two = damp(two, 1, 5, 0.05)
    two = damp(two, 1, 5, 0.05)
    expect(one).toBeCloseTo(two, 9)
    expect(damp(Number.NaN, 2, 5, 0.1)).toBe(2)
  })

  it('damps angles the short way round', () => {
    const next = dampAngle(Math.PI - 0.05, -Math.PI + 0.05, 1000, 1)
    expect(Math.abs(angleDelta(next, -Math.PI + 0.05))).toBeLessThan(1e-6)
  })

  it('turns by at most the step', () => {
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25, 9)
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1, 9)
  })

  it('lags the pivot behind a moving player, and snaps across a teleport', () => {
    const lagged = followPivot({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 1 / 60)
    expect(lagged.x).toBeGreaterThan(0)
    expect(lagged.x).toBeLessThan(1)
    const snapped = followPivot({ x: 0, y: 0, z: 0 }, { x: 500, y: 0, z: 0 }, 1 / 60)
    expect(snapped.x).toBe(500)
  })
})

describe('feel', () => {
  it('widens the lens for a sprint and narrows it to aim', () => {
    expect(orbitFov(72, 0, 0)).toBe(72)
    expect(orbitFov(72, 1, 0)).toBeGreaterThan(72)
    expect(orbitFov(72, 0, 1)).toBeLessThan(72)
  })

  it('bobs only while moving, and only a little', () => {
    expect(headBob(1.3, 0)).toEqual({ x: 0, y: 0 })
    const bob = headBob(1.3, 1)
    expect(Math.abs(bob.x)).toBeLessThan(0.03)
    expect(Math.abs(bob.y)).toBeLessThan(0.06)
  })
})
