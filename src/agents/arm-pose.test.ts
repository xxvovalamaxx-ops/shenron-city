/**
 * Measured on the shipped Kenney GLB: arms sit 84.9° from vertical in the bind
 * pose, and average 85.9° across Idle and 87.9° across Run. Every clip starts
 * from the same arms-out skeleton, so a crowd of them reads as scarecrows.
 */
import { describe, expect, it } from 'vitest'
import { ARM_DROP, dropArms, type Rotatable } from './arm-pose'

const bone = (): Rotatable => ({ rotation: { x: 0, y: 0, z: 0 } })

describe('dropArms', () => {
  it('drops each side on the axis measured for that side', () => {
    const left = bone()
    const right = bone()
    dropArms(left, right)

    // Not mirrored: the rig's arm bones have different local orientations.
    expect(left.rotation.z).toBeCloseTo(-ARM_DROP, 9)
    expect(right.rotation.x).toBeCloseTo(ARM_DROP, 9)
  })

  it('touches only the axis it needs to, on each side', () => {
    const left = bone()
    const right = bone()
    dropArms(left, right)

    expect(left.rotation.x).toBe(0)
    expect(left.rotation.y).toBe(0)
    expect(right.rotation.y).toBe(0)
    expect(right.rotation.z).toBe(0)
  })

  it('is additive, so the clip keeps its swing', () => {
    // A mid-swing frame from the Run clip, not a rest pose.
    const left: Rotatable = { rotation: { x: 0.2, y: -0.1, z: 0.35 } }
    dropArms(left, null)
    expect(left.rotation.z).toBeCloseTo(0.35 - ARM_DROP, 9)
    expect(left.rotation.x).toBeCloseTo(0.2, 9)
  })

  it('does nothing for a rig without these bones', () => {
    expect(() => dropArms(null, undefined)).not.toThrow()
  })

  it('is a no-op for a zero or non-finite drop', () => {
    for (const bad of [0, NaN, Infinity]) {
      const left = bone()
      const right = bone()
      dropArms(left, right, bad)
      expect(left.rotation.z).toBe(0)
      expect(right.rotation.x).toBe(0)
    }
  })

  it('uses a drop large enough to matter but short of folding the arm inside the torso', () => {
    const degrees = (ARM_DROP * 180) / Math.PI
    // 84.9° authored; a drop under ~40° still reads as arms-out, and one over
    // ~75° pushes the forearm through the body.
    expect(degrees).toBeGreaterThan(40)
    expect(degrees).toBeLessThan(75)
  })

  it('lands the arm in a believable range, given the 84.9 deg authored pose', () => {
    const resulting = 84.9 - (ARM_DROP * 180) / Math.PI
    expect(resulting).toBeGreaterThan(15)
    expect(resulting).toBeLessThan(45)
  })
})
