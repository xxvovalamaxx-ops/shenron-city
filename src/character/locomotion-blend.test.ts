import { describe, expect, it } from 'vitest'
import {
  FALL_DELAY,
  LAND_TIME,
  MIN_AIR_FOR_LAND,
  airLayer,
  bodyWeights,
  dominantClip,
  locomotionWeights,
  strideRate,
  type AirInput,
} from './locomotion-blend'
import { RUN_SPEED, SPRINT_SPEED } from '../gameplay/player/on-foot'

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0)

const GROUNDED: AirInput = {
  now: 10,
  grounded: true,
  jumpedAt: Number.NEGATIVE_INFINITY,
  landedAt: Number.NEGATIVE_INFINITY,
  lastAirTime: 0,
  airborneSince: Number.NEGATIVE_INFINITY,
}

describe('locomotionWeights', () => {
  it('is pure idle standing still and pure sprint flat out', () => {
    expect(locomotionWeights(0).Idle_Loop).toBe(1)
    expect(locomotionWeights(SPRINT_SPEED).Sprint_Loop).toBe(1)
  })

  it('blends two neighbours at a time and always sums to one', () => {
    for (const s of [0.2, 0.9, 1.45, 2.4, RUN_SPEED, 5.5, 9]) {
      const w = locomotionWeights(s)
      expect(sum(w)).toBeCloseTo(1, 9)
      expect(Object.values(w).filter((v) => v > 0).length).toBeLessThanOrEqual(2)
    }
    const mid = locomotionWeights(2.4)
    expect(mid.Walk_Loop).toBeGreaterThan(0)
    expect(mid.Jog_Fwd_Loop).toBeGreaterThan(0)
  })

  it('is continuous: no pop between clips as speed crosses an anchor', () => {
    const a = locomotionWeights(3.4 - 1e-6)
    const b = locomotionWeights(3.4 + 1e-6)
    expect(a.Jog_Fwd_Loop).toBeCloseTo(b.Jog_Fwd_Loop, 4)
  })

  it('treats bad input as standing', () => {
    expect(locomotionWeights(Number.NaN).Idle_Loop).toBe(1)
    expect(locomotionWeights(-3).Idle_Loop).toBe(1)
  })
})

describe('strideRate', () => {
  const durations = { Walk_Loop: 1.333, Jog_Fwd_Loop: 0.917, Sprint_Loop: 0.667 }
  it('steps faster the faster you go', () => {
    const jog = strideRate(RUN_SPEED, locomotionWeights(RUN_SPEED), durations)
    const sprint = strideRate(SPRINT_SPEED, locomotionWeights(SPRINT_SPEED), durations)
    expect(sprint).toBeGreaterThan(jog)
    expect(jog).toBeGreaterThan(0.5)
    expect(sprint).toBeLessThan(3)
  })
  it('does not stride standing still', () => {
    expect(strideRate(0, locomotionWeights(0), durations)).toBe(0)
  })
})

describe('airLayer', () => {
  it('is nothing on the ground', () => {
    expect(airLayer(GROUNDED).weight).toBe(0)
  })

  it('takes off into Jump_Start and settles into the fall loop', () => {
    const takeoff = airLayer({ ...GROUNDED, now: 10.1, grounded: false, jumpedAt: 10, airborneSince: 10 })
    expect(takeoff.start).toBeGreaterThan(takeoff.loop)
    expect(takeoff.weight).toBe(1)
    const later = airLayer({ ...GROUNDED, now: 11, grounded: false, jumpedAt: 10, airborneSince: 10 })
    expect(later.loop).toBe(1)
    expect(later.start).toBe(0)
  })

  it('walks off a kerb without flinching, falls after a beat', () => {
    const step = airLayer({ ...GROUNDED, now: 10 + FALL_DELAY * 0.5, grounded: false, airborneSince: 10 })
    expect(step.weight).toBe(0)
    const fall = airLayer({ ...GROUNDED, now: 10 + FALL_DELAY + 0.5, grounded: false, airborneSince: 10 })
    expect(fall.loop).toBe(1)
    expect(fall.weight).toBe(1)
  })

  it('lands hard from a real fall and recovers, but not from a kerb', () => {
    const land = airLayer({ ...GROUNDED, now: 10.05, landedAt: 10, lastAirTime: 0.8 })
    expect(land.land).toBe(1)
    expect(land.weight).toBeGreaterThan(0.9)
    const recovered = airLayer({ ...GROUNDED, now: 10 + LAND_TIME + 0.01, landedAt: 10, lastAirTime: 0.8 })
    expect(recovered.weight).toBe(0)
    const kerb = airLayer({ ...GROUNDED, now: 10.05, landedAt: 10, lastAirTime: MIN_AIR_FOR_LAND * 0.5 })
    expect(kerb.weight).toBe(0)
  })

  it('handles the never-airborne defaults without NaN', () => {
    const w = bodyWeights(0, airLayer({ ...GROUNDED, grounded: false }))
    for (const v of Object.values(w)) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('bodyWeights', () => {
  it('layers the air over the gait and still sums to one', () => {
    const air = airLayer({ ...GROUNDED, now: 10.1, grounded: false, jumpedAt: 10, airborneSince: 10 })
    const w = bodyWeights(RUN_SPEED, air)
    expect(sum(w)).toBeCloseTo(1, 9)
    expect(w.Jump_Start).toBeGreaterThan(0.5)
    expect(dominantClip(w)).toBe('Jump_Start')
  })

  it('is pure gait on the ground', () => {
    const w = bodyWeights(SPRINT_SPEED, airLayer(GROUNDED))
    expect(w.Sprint_Loop).toBe(1)
    expect(dominantClip(w)).toBe('Sprint_Loop')
  })
})
