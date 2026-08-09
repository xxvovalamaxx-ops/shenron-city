import { describe, expect, it } from 'vitest'

import {
  ENVIRONMENT_MAPS,
  ENVIRONMENT_MAP_IDS,
  environmentDelta,
  environmentForHour,
} from './environment-schedule'

describe('the environment schedule', () => {
  it('lights the city at every hour of the clock', () => {
    // The defect this replaces: the only HDR in the build was a night one, so
    // `environmentIntensityFor` was correctly zero through the middle of the
    // day and the daytime city had no image-based lighting at all.
    for (let hour = 0; hour < 24; hour += 0.25) {
      const env = environmentForHour(hour)
      expect(env.intensity, `hour ${hour}`).toBeGreaterThan(0)
    }
  })

  it('never names a map that is not in the build', () => {
    for (let hour = 0; hour < 24; hour += 0.1) {
      const env = environmentForHour(hour)
      expect(ENVIRONMENT_MAP_IDS).toContain(env.from)
      expect(ENVIRONMENT_MAP_IDS).toContain(env.to)
    }
    for (const url of Object.values(ENVIRONMENT_MAPS)) {
      expect(url).toMatch(/^\/hdr\/[\w-]+\.hdr$/)
    }
  })

  it('keeps the blend weight a weight', () => {
    for (let hour = 0; hour < 24; hour += 0.1) {
      const { blend } = environmentForHour(hour)
      expect(blend).toBeGreaterThanOrEqual(0)
      expect(blend).toBeLessThanOrEqual(1)
      expect(Number.isFinite(blend)).toBe(true)
    }
  })

  it('is continuous — no reflective surface in the city jumps', () => {
    // Every material in the scene reads this. A step in intensity, or a blend
    // that snaps from 0.9 to 0, is a visible flash across all the glass at
    // once, which is exactly what switching maps outright would do.
    let previous = environmentForHour(0)
    for (let hour = 0.05; hour <= 24; hour += 0.05) {
      const current = environmentForHour(hour)
      expect(Math.abs(current.intensity - previous.intensity), `hour ${hour}`).toBeLessThan(0.02)
      if (current.from === previous.from && current.to === previous.to) {
        expect(Math.abs(current.blend - previous.blend), `hour ${hour}`).toBeLessThan(0.05)
      } else {
        // A pair handover is only continuous if it happens at the ends of the
        // blend: finishing one crossfade before starting the next.
        const finished = previous.blend > 0.95 || previous.blend === 0
        const starting = current.blend < 0.05
        expect(finished && starting, `handover at hour ${hour}`).toBe(true)
      }
      previous = current
    }
  })

  it('wraps rather than falling off either end of the day', () => {
    const midnight = environmentForHour(0)
    expect(environmentForHour(24)).toEqual(midnight)
    expect(environmentForHour(48)).toEqual(midnight)
    // Negative and non-finite hours must not produce NaN: a NaN intensity
    // propagates into every material and blanks the scene.
    for (const hour of [-1, -13.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const env = environmentForHour(hour)
      expect(Number.isFinite(env.intensity), `hour ${hour}`).toBe(true)
      expect(Number.isFinite(env.blend), `hour ${hour}`).toBe(true)
    }
  })

  it('is brightest in the middle of the day and dimmest at night', () => {
    const noon = environmentForHour(12).intensity
    const night = environmentForHour(2).intensity
    const dawn = environmentForHour(6.5).intensity
    expect(noon).toBeGreaterThan(dawn)
    expect(dawn).toBeGreaterThan(night)
    // Night keeps the value the previous implementation shipped; it is the one
    // number here with a track record on screen.
    expect(night).toBeCloseTo(0.2, 5)
  })

  it('reports no change when the hour has barely moved, and a lot when it has', () => {
    const a = environmentForHour(10)
    expect(environmentDelta(a, environmentForHour(10.01))).toBeLessThan(0.01)
    // A different map pair cannot be compared by weight at all — the caller
    // has to rebuild, so the delta is infinite rather than small.
    expect(environmentDelta(environmentForHour(2), environmentForHour(12))).toBe(Infinity)
  })
})
