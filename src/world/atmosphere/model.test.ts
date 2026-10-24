/**
 * The atmosphere is swept over the whole day rather than sampled at the one
 * hour a screenshot was taken at: a sky that is right at 17:30 and broken at
 * 04:15 is the usual failure.
 */
import { describe, expect, it } from 'vitest'
import {
  atmosphereAt,
  azimuthDeg,
  elevationDeg,
  luminance,
  moonDirection,
  sunDirection,
  wrapHour,
  type AtmosphereState,
} from './model'

const HOURS = Array.from({ length: 24 * 8 }, (_, i) => i / 8)
const clear = (hour: number) => atmosphereAt({ hour, cover: 0.3, rain: 0 })

function finiteDeep(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (value && typeof value === 'object') return Object.values(value).every(finiteDeep)
  return true
}

describe('sun and moon paths', () => {
  it('returns unit vectors for every hour', () => {
    for (const h of HOURS) {
      for (const d of [sunDirection(h), moonDirection(h)]) {
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6)
      }
    }
  })

  it('puts the art-directed hours where the owner wants them', () => {
    // morning sun well up, high noon, golden hour low in the west, blue hour
    // below the horizon, night deep
    expect(elevationDeg(sunDirection(8))).toBeGreaterThan(15)
    expect(elevationDeg(sunDirection(12.5))).toBeGreaterThan(50)
    const golden = elevationDeg(sunDirection(17.5))
    expect(golden).toBeGreaterThan(5)
    expect(golden).toBeLessThan(20)
    const blue = elevationDeg(sunDirection(20))
    expect(blue).toBeLessThan(-4)
    expect(blue).toBeGreaterThan(-18)
    expect(elevationDeg(sunDirection(23))).toBeLessThan(-25)
  })

  it('rises in the east and sets in the west, south at noon', () => {
    expect(azimuthDeg(sunDirection(7))).toBeGreaterThan(60)
    expect(azimuthDeg(sunDirection(7))).toBeLessThan(120)
    expect(azimuthDeg(sunDirection(12.3))).toBeCloseTo(180, 0)
    expect(azimuthDeg(sunDirection(18.5))).toBeGreaterThan(240)
    expect(azimuthDeg(sunDirection(18.5))).toBeLessThan(300)
  })

  it('has the moon up at night', () => {
    expect(elevationDeg(moonDirection(23))).toBeGreaterThan(10)
  })

  it('wraps any clock value', () => {
    expect(wrapHour(25)).toBeCloseTo(1, 9)
    expect(wrapHour(-1)).toBeCloseTo(23, 9)
    expect(wrapHour(NaN)).toBe(12)
  })
})

describe('atmosphereAt', () => {
  it('never produces NaN or negative light', () => {
    for (const h of HOURS) {
      for (const cover of [0, 0.5, 1]) {
        for (const rain of [0, 0.6, 1]) {
          const s = atmosphereAt({ hour: h, cover, rain })
          expect(finiteDeep(s)).toBe(true)
          expect(s.keyIntensity).toBeGreaterThanOrEqual(0)
          expect(s.envIntensity).toBeGreaterThan(0)
          expect(s.exposure).toBeGreaterThan(0.5)
          expect(s.exposure).toBeLessThan(2)
          expect(s.fogFar).toBeGreaterThan(3000)
        }
      }
    }
    expect(finiteDeep(atmosphereAt({ hour: NaN, cover: NaN, rain: NaN }))).toBe(true)
  })

  it('changes smoothly: no hour-to-hour pops in light or exposure', () => {
    let prev: AtmosphereState | null = null
    for (const h of HOURS) {
      const s = clear(h)
      if (prev) {
        expect(Math.abs(s.exposure - prev.exposure)).toBeLessThan(0.08)
        expect(Math.abs(s.envIntensity - prev.envIntensity)).toBeLessThan(0.2)
        expect(Math.abs(luminance(s.zenith) - luminance(prev.zenith))).toBeLessThan(0.05)
        expect(Math.abs(s.night - prev.night)).toBeLessThan(0.25)
      }
      prev = s
    }
  })

  it('keeps the key light from popping when it hands over from sun to moon', () => {
    for (const h of HOURS) {
      const s = clear(h)
      if (s.sunElevation > -3 && s.sunElevation < 1) expect(s.keyIntensity).toBeLessThan(0.9)
    }
  })

  it('is day at noon and night at 23:00', () => {
    const noon = clear(12.5)
    const late = clear(23)
    expect(noon.night).toBe(0)
    expect(noon.practicals).toBe(0)
    expect(late.night).toBe(1)
    expect(late.practicals).toBe(1)
    expect(late.stars).toBeGreaterThan(0.3)
  })

  it('is warm at golden hour and neutral at noon', () => {
    const golden = clear(17.5)
    const noon = clear(12.5)
    expect(golden.golden).toBeGreaterThan(0.4)
    expect(golden.keyColor.r / golden.keyColor.b).toBeGreaterThan(noon.keyColor.r / noon.keyColor.b * 1.3)
  })

  it('keeps night readable: ambient and exposure lift it off black', () => {
    const late = clear(23)
    expect(late.exposure).toBeGreaterThan(clear(12.5).exposure)
    expect(late.envIntensity).toBeGreaterThan(clear(12.5).envIntensity)
    expect(luminance(late.nightAmbient)).toBeGreaterThan(0)
    // the blue fill is blue
    expect(late.nightAmbient.b).toBeGreaterThan(late.nightAmbient.r)
  })

  it('lets rain close the view down and dim the key', () => {
    const dry = atmosphereAt({ hour: 14, cover: 0.3, rain: 0 })
    const wet = atmosphereAt({ hour: 14, cover: 0.95, rain: 1 })
    expect(wet.fogFar).toBeLessThan(dry.fogFar)
    expect(wet.fogDensity).toBeGreaterThan(dry.fogDensity)
    expect(wet.keyIntensity).toBeLessThan(dry.keyIntensity * 0.5)
    expect(wet.stars).toBe(0)
  })

  it('blooms harder at night than by day', () => {
    expect(clear(23).bloomIntensity).toBeGreaterThan(clear(12).bloomIntensity)
    expect(clear(23).bloomThreshold).toBeLessThan(clear(12).bloomThreshold)
  })
})
