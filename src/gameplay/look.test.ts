import { describe, expect, it } from 'vitest'

import {
  applyLookDelta,
  lookAnglesFrom,
  LOOK_RADIANS_PER_PIXEL,
  PITCH_LIMIT,
} from './look'

describe('applyLookDelta', () => {
  it('turns right when the mouse moves right', () => {
    const next = applyLookDelta({ yaw: 0, pitch: 0 }, 100, 0)
    // negative yaw is a right turn in a right-handed Y-up frame
    expect(next.yaw).toBeCloseTo(-100 * LOOK_RADIANS_PER_PIXEL, 10)
    expect(next.pitch).toBe(0)
  })

  it('scales by sensitivity', () => {
    const slow = applyLookDelta({ yaw: 0, pitch: 0 }, 100, 0, 0.5)
    const fast = applyLookDelta({ yaw: 0, pitch: 0 }, 100, 0, 2)
    expect(fast.yaw).toBeCloseTo(slow.yaw * 4, 10)
  })

  it('never lets the pitch pass vertical, however hard you drag', () => {
    let angles = { yaw: 0, pitch: 0 }
    for (let i = 0; i < 200; i++) angles = applyLookDelta(angles, 0, -500)
    expect(angles.pitch).toBeCloseTo(PITCH_LIMIT, 10)
    expect(angles.pitch).toBeLessThan(Math.PI / 2)

    for (let i = 0; i < 400; i++) angles = applyLookDelta(angles, 0, 500)
    expect(angles.pitch).toBeCloseTo(-PITCH_LIMIT, 10)
    expect(angles.pitch).toBeGreaterThan(-Math.PI / 2)
  })

  it('lets yaw run unbounded — turning in circles is legal', () => {
    let angles = { yaw: 0, pitch: 0 }
    for (let i = 0; i < 100; i++) angles = applyLookDelta(angles, 500, 0)
    expect(Math.abs(angles.yaw)).toBeGreaterThan(Math.PI * 2)
    expect(Number.isFinite(angles.yaw)).toBe(true)
  })

  it('ignores a non-finite delta rather than poisoning the camera', () => {
    // A garbage delta is dropped, not clamped: a synthetic event should leave
    // the view where it was, not slam it to the pitch limit.
    const start = { yaw: 0.4, pitch: 0.2 }
    expect(applyLookDelta(start, Number.NaN, 0)).toEqual(start)
    expect(applyLookDelta(start, 0, Number.POSITIVE_INFINITY)).toEqual(start)
    const chained = applyLookDelta(applyLookDelta(start, Number.NaN, Number.NaN), 10, 10)
    expect(Number.isFinite(chained.yaw)).toBe(true)
    expect(Number.isFinite(chained.pitch)).toBe(true)
  })

  it('is a pure fold — the input angles are untouched', () => {
    const start = { yaw: 1, pitch: 0.3 }
    applyLookDelta(start, 250, -250)
    expect(start).toEqual({ yaw: 1, pitch: 0.3 })
  })
})

describe('lookAnglesFrom', () => {
  it('picks up wherever the previous controller left the view', () => {
    expect(lookAnglesFrom({ x: 0.25, y: -1.5 })).toEqual({ yaw: -1.5, pitch: 0.25 })
  })

  it('clamps a pitch that arrived out of range, and survives NaN', () => {
    expect(lookAnglesFrom({ x: 3, y: 0 }).pitch).toBeCloseTo(PITCH_LIMIT, 10)
    expect(lookAnglesFrom({ x: Number.NaN, y: Number.NaN })).toEqual({ yaw: 0, pitch: 0 })
  })
})
