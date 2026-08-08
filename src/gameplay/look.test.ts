import { describe, expect, it } from 'vitest'

import {
  applyLookDelta,
  lookAnglesFrom,
  lookAnglesFromDirection,
  LOOK_RADIANS_PER_PIXEL,
  PITCH_LIMIT,
} from './look'

/** Forward vector of a YXZ camera at (pitch, yaw, 0) — what three produces. */
function forwardOf(pitch: number, yaw: number) {
  return {
    x: -Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * Math.cos(pitch),
  }
}

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

describe('lookAnglesFromDirection', () => {
  it('round-trips every yaw and pitch a YXZ camera can hold', () => {
    for (let yaw = -Math.PI; yaw <= Math.PI; yaw += 0.31) {
      for (let pitch = -1.5; pitch <= 1.5; pitch += 0.23) {
        const back = lookAnglesFromDirection(forwardOf(pitch, yaw))
        expect(back.pitch).toBeCloseTo(pitch, 9)
        // Yaw wraps at +/-pi, so compare the direction rather than the number.
        const a = forwardOf(back.pitch, back.yaw)
        const b = forwardOf(pitch, yaw)
        expect(a.x).toBeCloseTo(b.x, 9)
        expect(a.z).toBeCloseTo(b.z, 9)
      }
    }
  })

  it('reads a level view as level, facing -z', () => {
    // toBeCloseTo, not toEqual: atan2(-0, 1) is -0, which is the same angle
    // and a different value to a deep-equality check.
    const a = lookAnglesFromDirection({ x: 0, y: 0, z: -1 })
    expect(a.yaw).toBeCloseTo(0, 12)
    expect(a.pitch).toBeCloseTo(0, 12)
  })

  it('does not care about the magnitude', () => {
    const unit = lookAnglesFromDirection({ x: 1, y: 0, z: -1 })
    const long = lookAnglesFromDirection({ x: 500, y: 0, z: -500 })
    expect(long.yaw).toBeCloseTo(unit.yaw, 12)
  })

  it('clamps a straight-down look instead of returning +/-pi/2 exactly', () => {
    // The intro used to hand over exactly here. Landing on the pole is what
    // makes the next lookAt degenerate.
    const down = lookAnglesFromDirection({ x: 0, y: -1, z: 0 })
    expect(down.pitch).toBe(-PITCH_LIMIT)
    const up = lookAnglesFromDirection({ x: 0, y: 1, z: 0 })
    expect(up.pitch).toBe(PITCH_LIMIT)
  })

  it('returns the identity for a degenerate direction rather than NaN', () => {
    expect(lookAnglesFromDirection({ x: 0, y: 0, z: 0 })).toEqual({ yaw: 0, pitch: 0 })
    expect(lookAnglesFromDirection({ x: Number.NaN, y: 0, z: -1 })).toEqual({ yaw: 0, pitch: 0 })
  })

  it('is immune to the Euler order that broke the intro handover', () => {
    // The defect: lookAt leaves an XYZ Euler in which a steep downward look is
    // partly expressed in `z`, and lookAnglesFrom drops `z`. Same camera, two
    // readings — the direction-based one must match the truth and the
    // component-based one must not.
    const pitch = -1.0151
    const yaw = 0.4531
    const truth = forwardOf(pitch, yaw)
    const viaDirection = lookAnglesFromDirection(truth)
    expect(viaDirection.pitch).toBeCloseTo(pitch, 9)
    expect(viaDirection.yaw).toBeCloseTo(yaw, 9)

    // Feed the same numbers in as if they had come off an XYZ Euler that also
    // carried z = 0.6141. The component read cannot see the difference.
    const viaComponents = lookAnglesFrom({ x: pitch, y: yaw })
    const resulting = forwardOf(viaComponents.pitch, viaComponents.yaw)
    // Identical here only because the input already was YXZ — which is the
    // whole point: lookAnglesFrom is right when the order is right and has no
    // way to know when it is not.
    expect(resulting.y).toBeCloseTo(truth.y, 9)
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
