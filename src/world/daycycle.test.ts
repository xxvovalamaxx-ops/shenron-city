/**
 * A lighting rig looks fine in the one screenshot you checked and is broken at
 * 3 am. These sweep the whole day rather than sampling one hour.
 */
import { describe, expect, it } from 'vitest'
import {
  DAWN,
  DUSK,
  normaliseHour,
  roadMetalness,
  roadRoughness,
  skyAt,
  stepWeather,
  sunAt,
  type Weather,
} from './daycycle'

const DRY: Weather = { rain: 0, wetness: 0 }
const HOURS = Array.from({ length: 96 }, (_, i) => i * 0.25)

describe('normaliseHour', () => {
  it('wraps a running clock instead of letting it drift off the day', () => {
    expect(normaliseHour(25)).toBeCloseTo(1, 9)
    expect(normaliseHour(-1)).toBeCloseTo(23, 9)
    expect(normaliseHour(48.5)).toBeCloseTo(0.5, 9)
  })

  it('falls back to noon rather than producing NaN light', () => {
    for (const bad of [NaN, Infinity, -Infinity]) expect(normaliseHour(bad)).toBe(12)
  })
})

describe('sunAt', () => {
  it('is up during the day and down at night', () => {
    expect(sunAt(12).y).toBeGreaterThan(0.9)
    expect(sunAt(0).y).toBeLessThan(0)
    expect(sunAt(3).y).toBeLessThan(0)
  })

  it('is near the horizon at dawn and dusk', () => {
    expect(Math.abs(sunAt(DAWN).y)).toBeLessThan(0.05)
    expect(Math.abs(sunAt(DUSK).y)).toBeLessThan(0.05)
  })

  it('crosses the sky monotonically rather than jumping', () => {
    // Sweeps east to west; the sign convention is negated, so x rises.
    let previous = -Infinity
    for (let h = DAWN; h <= DUSK; h += 0.5) {
      const x = sunAt(h).x
      expect(x).toBeGreaterThan(previous)
      previous = x
    }
  })

  it('never reports an elevation outside 0..1', () => {
    for (const h of HOURS) {
      expect(sunAt(h).elevation).toBeGreaterThanOrEqual(0)
      expect(sunAt(h).elevation).toBeLessThanOrEqual(1)
    }
  })

  it('is finite at every hour', () => {
    for (const h of HOURS) {
      const s = sunAt(h)
      for (const v of [s.x, s.y, s.z, s.elevation]) expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('skyAt', () => {
  it('emits a valid colour at every hour, wet or dry', () => {
    for (const h of HOURS) {
      for (const w of [DRY, { rain: 1, wetness: 1 }]) {
        const sky = skyAt(h, w)
        for (const c of [sky.horizon, sky.zenith, sky.keyColour]) {
          expect(c).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    }
  })

  it('never goes fully black — the player must always see where they are', () => {
    for (const h of HOURS) {
      const sky = skyAt(h)
      expect(sky.keyIntensity + sky.fillIntensity).toBeGreaterThan(0.15)
    }
  })

  it('is brightest at noon and dimmest in the small hours', () => {
    expect(skyAt(12).keyIntensity).toBeGreaterThan(skyAt(3).keyIntensity * 5)
  })

  it('turns the city lights on at night and off in daylight', () => {
    expect(skyAt(1).practicals).toBeGreaterThan(0.9)
    expect(skyAt(12).practicals).toBe(0)
  })

  it('flattens the key and lifts the fill in rain', () => {
    const clear = skyAt(15, DRY)
    const wet = skyAt(15, { rain: 1, wetness: 1 })
    expect(wet.keyIntensity).toBeLessThan(clear.keyIntensity)
    expect(wet.fillIntensity).toBeGreaterThan(clear.fillIntensity)
  })

  it('has a golden hour, and it is genuinely narrow', () => {
    // A wide gentle sunset reads as a graded afternoon, not a time of day.
    const warmth = (h: number) => {
      const c = skyAt(h).horizon
      return parseInt(c.slice(1, 3), 16) - parseInt(c.slice(5, 7), 16)
    }
    // The arc is symmetric, so golden hour happens twice — dawn and dusk.
    const peak = HOURS.reduce((best, h) => (warmth(h) > warmth(best) ? h : best), 0)
    const nearDawn = Math.abs(peak - DAWN) < 2
    const nearDusk = Math.abs(peak - DUSK) < 2
    expect(nearDawn || nearDusk).toBe(true)

    // Both ends are warm, and both beat midday and the small hours.
    for (const h of [DAWN + 0.75, DUSK - 0.75]) {
      expect(warmth(h)).toBeGreaterThan(warmth(13))
      expect(warmth(h)).toBeGreaterThan(warmth(2))
    }
    // Narrow: three hours past dawn it has largely gone.
    expect(warmth(DAWN + 3.75)).toBeLessThan(warmth(DAWN + 0.75) * 0.6)
  })
})

describe('stepWeather', () => {
  it('soaks in quickly and dries slowly', () => {
    let w: Weather = { rain: 0, wetness: 0 }
    for (let i = 0; i < 120; i++) w = stepWeather(w, 1, 1 / 60)
    const soaked = w.wetness
    expect(soaked).toBeGreaterThan(0.6)

    for (let i = 0; i < 120; i++) w = stepWeather(w, 0, 1 / 60)
    // Still wet two seconds after the rain stops — that is the look.
    expect(w.wetness).toBeGreaterThan(soaked * 0.5)
  })

  it('eventually dries out completely', () => {
    let w: Weather = { rain: 1, wetness: 1 }
    for (let i = 0; i < 60 * 400; i++) w = stepWeather(w, 0, 1 / 60)
    expect(w.wetness).toBeLessThan(0.05)
  })

  it('stays inside 0..1 however hard it is driven', () => {
    let w: Weather = { rain: 0, wetness: 0 }
    for (const target of [5, -3, 1, 0]) {
      for (let i = 0; i < 200; i++) w = stepWeather(w, target, 1 / 30)
      expect(w.rain).toBeGreaterThanOrEqual(0)
      expect(w.rain).toBeLessThanOrEqual(1)
      expect(w.wetness).toBeGreaterThanOrEqual(0)
      expect(w.wetness).toBeLessThanOrEqual(1)
    }
  })

  it('recovers from a corrupted state instead of spreading NaN through the sky', () => {
    const w = stepWeather({ rain: NaN, wetness: NaN }, 0.5, 1 / 60)
    expect(Number.isFinite(w.rain)).toBe(true)
    expect(Number.isFinite(w.wetness)).toBe(true)
  })
})

describe('road surface', () => {
  it('turns asphalt to a mirror when wet', () => {
    expect(roadRoughness(1)).toBeLessThan(roadRoughness(0) / 4)
    expect(roadMetalness(1)).toBeGreaterThan(roadMetalness(0) * 10)
  })

  it('stays in physically sensible ranges', () => {
    for (const w of [0, 0.3, 0.7, 1]) {
      expect(roadRoughness(w)).toBeGreaterThan(0)
      expect(roadRoughness(w)).toBeLessThanOrEqual(1)
      expect(roadMetalness(w)).toBeGreaterThanOrEqual(0)
      expect(roadMetalness(w)).toBeLessThanOrEqual(1)
    }
  })
})
