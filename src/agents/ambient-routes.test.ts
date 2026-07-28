import { describe, expect, it } from 'vitest'
import {
  ambientPedestrianPose,
  loopLength,
  NPC_HALF_H,
  NPC_HALF_W,
  npcColliders,
  pedestrianGait,
  sampleLoop,
} from './ambient-routes'

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
      expect(box.min[1]).toBe(0)
      expect(box.max[1]).toBe(NPC_HALF_H * 2)
      expect(box.max[0] - box.min[0]).toBeCloseTo(NPC_HALF_W * 2)
    })
  })

  it('uses the quality-scaled count without leaving invisible colliders', () => {
    expect(npcColliders(0, 5)).toHaveLength(5)
    expect(npcColliders(0, 18)).toHaveLength(18)
    expect(npcColliders(0, 0)).toEqual([])
  })

  it('produces a bounded articulated walk cycle', () => {
    for (let i = 0; i < 18; i++) {
      const gait = pedestrianGait(i, 12.5)
      expect(Math.abs(gait.stride)).toBeLessThanOrEqual(0.48)
      expect(gait.bob).toBeGreaterThanOrEqual(0)
      expect(gait.bob).toBeLessThanOrEqual(0.025)
      expect(Math.abs(gait.sway)).toBeLessThanOrEqual(0.035)
    }
  })
})
