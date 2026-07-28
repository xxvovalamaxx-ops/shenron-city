/**
 * Measured in the running game before this rule existed: 470 of 904 meshes
 * cast shadows, median caster radius 0.47 m, shadow texel 0.176 m. More than
 * half the shadow pass was spent on shapes under three texels wide.
 */
import { describe, expect, it } from 'vitest'
import {
  MIN_SHADOW_TEXELS,
  minShadowCasterRadius,
  shadowTexelSize,
  shouldCastShadow,
} from './shadow-budget'

/** The shipped shadow camera: 360 m across, at each preset's map size. */
const EXTENT = 360
const HIGH = shadowTexelSize(EXTENT, 2048)
const MEDIUM = shadowTexelSize(EXTENT, 1024)
const LOW = shadowTexelSize(EXTENT, 512)

describe('shadowTexelSize', () => {
  it('matches the measured texel size at high quality', () => {
    expect(HIGH).toBeCloseTo(0.176, 3)
  })

  it('halving the map doubles the texel', () => {
    expect(MEDIUM).toBeCloseTo(HIGH * 2, 6)
    expect(LOW).toBeCloseTo(HIGH * 4, 6)
  })

  it('returns Infinity for a nonsensical camera or map, so nothing casts', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(shadowTexelSize(bad, 2048)).toBe(Infinity)
      expect(shadowTexelSize(EXTENT, bad)).toBe(Infinity)
    }
  })
})

describe('shouldCastShadow', () => {
  it('drops the median prop that was costing a draw call for nothing', () => {
    expect(shouldCastShadow(0.47, HIGH)).toBe(false)
  })

  it('keeps things large enough to read', () => {
    // A vehicle, a market stall, a building, the tower.
    for (const radius of [2.4, 4, 12, 90]) {
      expect(shouldCastShadow(radius, HIGH)).toBe(true)
    }
  })

  it('tightens automatically as the shadow map shrinks', () => {
    const radius = 1.0
    expect(shouldCastShadow(radius, HIGH)).toBe(true)
    expect(shouldCastShadow(radius, LOW)).toBe(false)
  })

  it('never casts for a degenerate radius', () => {
    for (const bad of [0, -1, NaN]) {
      expect(shouldCastShadow(bad, HIGH)).toBe(false)
    }
  })

  it('is exactly the stated texel rule at the boundary', () => {
    const cutoff = minShadowCasterRadius(HIGH)
    expect(cutoff).toBeCloseTo((HIGH * MIN_SHADOW_TEXELS) / 2, 9)
    expect(shouldCastShadow(cutoff, HIGH)).toBe(true)
    expect(shouldCastShadow(cutoff * 0.999, HIGH)).toBe(false)
  })

  it('would have culled the majority of the measured casters', () => {
    // The distribution measured in the browser: how many casters fell under
    // each radius. The rule must remove well over half of 470.
    const measured = { 0.5: 240, 1.0: 345, 1.5: 380, 2.0: 404 }
    const cutoff = minShadowCasterRadius(HIGH)
    expect(cutoff).toBeGreaterThan(0.5)
    expect(cutoff).toBeLessThan(1.0)
    // Between 240 and 345 of 470 removed — at least half the shadow pass.
    expect(measured[0.5] / 470).toBeGreaterThan(0.5)
  })
})
