import { describe, expect, it } from 'vitest'
import { ambientPedestrianPose, loopLength, npcColliders, sampleLoop } from './ambient-routes'

const SQUARE = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
] as const

describe('ambient pedestrian routes', () => {
  it('includes the closing segment in loop length', () => {
    expect(loopLength(SQUARE)).toBe(40)
  })

  it('samples a constant-distance position and heading', () => {
    expect(sampleLoop(SQUARE, 15)).toEqual({
      x: 10,
      z: 5,
      heading: 0,
    })
  })

  it('wraps positive and negative distances', () => {
    expect(sampleLoop(SQUARE, 45)).toEqual(sampleLoop(SQUARE, 5))
    expect(sampleLoop(SQUARE, -5)).toEqual(sampleLoop(SQUARE, 35))
  })

  it('builds one collider at every rendered pedestrian position', () => {
    const elapsed = 12.5
    const count = 11
    const boxes = npcColliders(elapsed, count)

    expect(boxes).toHaveLength(count)
    boxes.forEach((box, i) => {
      const visible = ambientPedestrianPose(i, elapsed)

      expect((box.min[0] + box.max[0]) / 2).toBeCloseTo(visible.x)
      expect((box.min[2] + box.max[2]) / 2).toBeCloseTo(visible.z)
    })
  })

  it('uses the quality-scaled count without leaving invisible colliders', () => {
    expect(npcColliders(0, 5)).toHaveLength(5)
    expect(npcColliders(0, 18)).toHaveLength(18)
    expect(npcColliders(0, 0)).toEqual([])
  })
})
