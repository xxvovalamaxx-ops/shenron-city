/**
 * The bug these pin: every character component rendered its GLB with a bare
 * `<primitive object={model} />`, so pedestrians and named NPCs stood 3.76 m
 * tall — more than double human height — beside 2 m market stalls.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHARACTER_HEIGHT,
  heightScaleFor,
  isPlausibleCharacterHeight,
} from './character-scale'

/** Measured in the running game before the fix. */
const NATURAL = {
  kenneyCitizen: 3.76,
  quaterniusHero: 2.19,
  ambientPedestrian: 3.92,
}

describe('heightScaleFor', () => {
  it('normalises every shipped character to the target height', () => {
    for (const natural of Object.values(NATURAL)) {
      const scaled = natural * heightScaleFor(natural)
      expect(scaled).toBeCloseTo(DEFAULT_CHARACTER_HEIGHT, 6)
    }
  })

  it('honours an explicit target', () => {
    expect(3.76 * heightScaleFor(3.76, 2.1)).toBeCloseTo(2.1, 6)
  })

  it('is the identity when the model already matches', () => {
    expect(heightScaleFor(DEFAULT_CHARACTER_HEIGHT)).toBeCloseTo(1, 6)
  })

  it('falls back to 1 rather than Infinity or NaN on a degenerate measurement', () => {
    // A character at authored size is wrong but visible; one scaled by Infinity
    // disappears and drags the frame's bounding volume with it.
    for (const bad of [0, -1, NaN, Infinity, -Infinity, 1e-9]) {
      expect(heightScaleFor(bad)).toBe(1)
    }
  })

  it('rejects a nonsensical target instead of collapsing the model', () => {
    for (const bad of [0, -2, NaN, Infinity]) {
      expect(heightScaleFor(3.76, bad)).toBe(1)
    }
  })
})

describe('isPlausibleCharacterHeight', () => {
  it('accepts believable adults', () => {
    for (const h of [1.6, 1.75, 1.9, 2.0]) {
      expect(isPlausibleCharacterHeight(h)).toBe(true)
    }
  })

  it('rejects the grossly oversized heights observed in the broken build', () => {
    for (const h of [NATURAL.kenneyCitizen, NATURAL.ambientPedestrian]) {
      expect(isPlausibleCharacterHeight(h)).toBe(false)
    }
  })

  it('does not pretend 2.19 m is impossible — it is only wrong for this model', () => {
    // The Quaternius hero shipped at 2.19 m, which is a very tall human rather
    // than an obvious defect. This guard catches gross errors; normalisation is
    // what makes every character the intended height, and that is asserted
    // above against heightScaleFor.
    expect(isPlausibleCharacterHeight(NATURAL.quaterniusHero)).toBe(true)
    expect(NATURAL.quaterniusHero * heightScaleFor(NATURAL.quaterniusHero)).toBeCloseTo(
      DEFAULT_CHARACTER_HEIGHT,
      6,
    )
  })

  it('rejects a collapsed or non-finite model', () => {
    for (const h of [0, 0.2, NaN, Infinity]) {
      expect(isPlausibleCharacterHeight(h)).toBe(false)
    }
  })

  it('agrees with heightScaleFor — normalising always yields a plausible height', () => {
    for (const natural of Object.values(NATURAL)) {
      expect(isPlausibleCharacterHeight(natural * heightScaleFor(natural))).toBe(true)
    }
  })
})
