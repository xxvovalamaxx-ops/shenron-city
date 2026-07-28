/**
 * Lighting alone could not make this city read as night: the CC0 kit's
 * colormap is near-white, and a near-white surface stays bright under any rig
 * that still lets you see where you are walking. This is the albedo half.
 */
import { describe, expect, it } from 'vitest'
import {
  gradeToNight,
  luminance,
  NIGHT_ALBEDO,
  NIGHT_COOL_MIX,
  NIGHT_SKY,
  type Rgb,
} from './night-grade'

/** The kit's problem case: an almost-white façade. */
const WHITE: Rgb = { r: 0.94, g: 0.94, b: 0.95 }

describe('gradeToNight', () => {
  it('darkens the near-white façades that caused the problem', () => {
    const graded = gradeToNight(WHITE)
    expect(luminance(graded)).toBeLessThan(luminance(WHITE) * 0.6)
  })

  it('cools the residual toward the night sky rather than going flat grey', () => {
    const graded = gradeToNight(WHITE)
    // Blue survives the grade better than red, so faces sit in the sky's family.
    expect(graded.b).toBeGreaterThan(graded.r)
  })

  it('never leaves a channel outside 0..1', () => {
    for (const c of [WHITE, { r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, { r: 2, g: -1, b: 0.5 }]) {
      const g = gradeToNight(c)
      for (const v of [g.r, g.g, g.b]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps black black — there is nothing to darken', () => {
    const g = gradeToNight({ r: 0, g: 0, b: 0 })
    // Only the sky mix lifts it, and only slightly.
    expect(luminance(g)).toBeLessThan(0.05)
  })

  it('is monotonic: a darker input never grades brighter than a lighter one', () => {
    const dark = gradeToNight({ r: 0.2, g: 0.2, b: 0.2 })
    const light = gradeToNight({ r: 0.8, g: 0.8, b: 0.8 })
    expect(luminance(dark)).toBeLessThan(luminance(light))
  })

  it('is the identity at albedo 1 with no cooling', () => {
    const g = gradeToNight(WHITE, 1, 0)
    expect(g.r).toBeCloseTo(WHITE.r, 9)
    expect(g.g).toBeCloseTo(WHITE.g, 9)
    expect(g.b).toBeCloseTo(WHITE.b, 9)
  })

  it('falls back to the input channel rather than producing NaN', () => {
    // A NaN albedo would render black and be misread as a missing texture.
    const g = gradeToNight(WHITE, NaN, NaN)
    expect(Number.isFinite(g.r)).toBe(true)
    expect(Number.isFinite(g.g)).toBe(true)
    expect(Number.isFinite(g.b)).toBe(true)
  })

  it('uses settings strong enough to matter but short of unreadable', () => {
    expect(NIGHT_ALBEDO).toBeGreaterThan(0.25)
    expect(NIGHT_ALBEDO).toBeLessThan(0.7)
    expect(NIGHT_COOL_MIX).toBeGreaterThan(0)
    expect(NIGHT_COOL_MIX).toBeLessThan(0.5)
    // Still legible: a white wall must not fall to near-black, or the player
    // cannot tell where the pavement ends and the building starts.
    expect(luminance(gradeToNight(WHITE))).toBeGreaterThan(0.12)
  })

  it('grades toward the sky it was given', () => {
    const warm = gradeToNight(WHITE, 0.5, 0.9, { r: 1, g: 0.5, b: 0 })
    expect(warm.r).toBeGreaterThan(warm.b)
    expect(NIGHT_SKY.b).toBeGreaterThan(NIGHT_SKY.r)
  })
})
