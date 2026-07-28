/**
 * The bug these pin: ambient pedestrians walked at 0.82–1.26 m/s while their
 * Run clip played at a hardcoded 0.44–0.515, which the clip wants at
 * 0.476–0.731. The fastest pedestrians' feet slid by over 40%.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHARACTER_HEIGHT } from './character-scale'
import {
  clipReferenceSpeed,
  footSlipRate,
  locomotionTimeScale,
  MAX_TIME_SCALE,
  MIN_TIME_SCALE,
} from './locomotion'

/** The speeds ambientPedestrianPose actually produces: 0.82 + (i % 5) * 0.11. */
const PEDESTRIAN_SPEEDS = [0.82, 0.93, 1.04, 1.15, 1.26]

describe('clipReferenceSpeed', () => {
  it('matches the speed measured from the shipped Run clip', () => {
    // 0.61 m stride, 0.708 s cycle, two steps per cycle, at 1.75 m.
    expect(clipReferenceSpeed(DEFAULT_CHARACTER_HEIGHT)).toBeCloseTo(1.723, 2)
  })

  it('scales with body height — a taller character covers more per step', () => {
    const short = clipReferenceSpeed(1.5)
    const tall = clipReferenceSpeed(2.0)
    expect(tall).toBeGreaterThan(short)
    expect(tall / short).toBeCloseTo(2.0 / 1.5, 6)
  })

  it('returns zero for a nonsensical height instead of NaN or Infinity', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(clipReferenceSpeed(bad)).toBe(0)
    }
  })
})

describe('locomotionTimeScale', () => {
  it('plants the feet exactly for every pedestrian speed in the crowd', () => {
    for (const speed of PEDESTRIAN_SPEEDS) {
      const scale = locomotionTimeScale(speed, DEFAULT_CHARACTER_HEIGHT)
      expect(footSlipRate(speed, DEFAULT_CHARACTER_HEIGHT, scale)).toBeLessThan(1e-9)
    }
  })

  it('beats the hardcoded rates it replaces, at every speed', () => {
    // The old code: 0.44 + (index % 4) * 0.025.
    const oldRates = [0.44, 0.465, 0.49, 0.515]
    for (const speed of PEDESTRIAN_SPEEDS) {
      const fixed = footSlipRate(
        speed,
        DEFAULT_CHARACTER_HEIGHT,
        locomotionTimeScale(speed, DEFAULT_CHARACTER_HEIGHT),
      )
      for (const old of oldRates) {
        expect(fixed).toBeLessThanOrEqual(footSlipRate(speed, DEFAULT_CHARACTER_HEIGHT, old))
      }
    }
  })

  it('shows the old rates really were sliding — over 40% at the top speed', () => {
    const slip = footSlipRate(1.26, DEFAULT_CHARACTER_HEIGHT, 0.515)
    expect(slip / 1.26).toBeGreaterThan(0.29)
  })

  it('shuffles rather than freezing when stopped', () => {
    // A clip stopped dead reads as a hung animation, not as standing still.
    for (const stopped of [0, -1, NaN]) {
      expect(locomotionTimeScale(stopped, DEFAULT_CHARACTER_HEIGHT)).toBe(MIN_TIME_SCALE)
    }
  })

  it('clamps a sprint instead of blurring', () => {
    expect(locomotionTimeScale(40, DEFAULT_CHARACTER_HEIGHT)).toBe(MAX_TIME_SCALE)
  })

  it('falls back to 1 when the height is unusable', () => {
    expect(locomotionTimeScale(1.2, 0)).toBe(1)
    expect(locomotionTimeScale(1.2, NaN)).toBe(1)
  })

  it('stays inside the playable range for anything a pedestrian can do', () => {
    for (let speed = 0.1; speed <= 8; speed += 0.1) {
      const scale = locomotionTimeScale(speed, DEFAULT_CHARACTER_HEIGHT)
      expect(scale).toBeGreaterThanOrEqual(MIN_TIME_SCALE)
      expect(scale).toBeLessThanOrEqual(MAX_TIME_SCALE)
    }
  })
})
