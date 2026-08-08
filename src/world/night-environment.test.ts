import { describe, expect, it } from 'vitest'

import { environmentIntensityFor } from './NightEnvironment'
import { nightFactor } from './city-lighting'

describe('environmentIntensityFor', () => {
  it('contributes nothing at midday', () => {
    // The defect: a *night* HDR was applied once with a dependency array of
    // [gl, scene], neither of which changes after mount, so it lit the city at
    // noon. The first frames of a fresh session read almost black because of
    // it.
    expect(environmentIntensityFor(12)).toBe(0)
    expect(environmentIntensityFor(13.5)).toBe(0)
  })

  it('reaches full strength in the middle of the night', () => {
    expect(environmentIntensityFor(0)).toBeCloseTo(0.2, 10)
    expect(environmentIntensityFor(2)).toBeCloseTo(0.2, 10)
    expect(environmentIntensityFor(23)).toBeCloseTo(0.2, 10)
  })

  it('ramps down through dawn and back up through dusk', () => {
    // Monotonic across each shoulder — a night map that flickered on and off
    // across sunrise would be worse than one that never moved.
    const dawn = [4.5, 5, 5.5, 6, 6.5].map(environmentIntensityFor)
    for (let i = 1; i < dawn.length; i++) expect(dawn[i]).toBeLessThanOrEqual(dawn[i - 1])
    expect(dawn[0]).toBeGreaterThan(dawn[dawn.length - 1])

    const dusk = [18.5, 19, 19.5, 20, 20.5].map(environmentIntensityFor)
    for (let i = 1; i < dusk.length; i++) expect(dusk[i]).toBeGreaterThanOrEqual(dusk[i - 1])
  })

  it('never leaves the 0..0.2 band', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const v = environmentIntensityFor(h)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(0.2 + 1e-12)
    }
  })

  it('uses the same curve the windows use', () => {
    // One authority for "is it night". The facade used to carry its own copy
    // with different shoulders, so the windows and the street lamps disagreed
    // by up to 90 minutes about when night had fallen.
    for (const h of [0, 5, 5.5, 6, 12, 19, 19.5, 20, 23]) {
      expect(environmentIntensityFor(h)).toBeCloseTo(0.2 * nightFactor(h as never), 12)
    }
  })

  it('survives a wrapped or non-finite hour', () => {
    expect(environmentIntensityFor(24)).toBeCloseTo(environmentIntensityFor(0), 10)
    expect(environmentIntensityFor(-1)).toBeCloseTo(environmentIntensityFor(23), 10)
    expect(environmentIntensityFor(Number.NaN)).toBe(0)
  })
})
