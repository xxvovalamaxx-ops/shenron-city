import { describe, expect, it } from 'vitest'
import { CROWD_VARIANTS, crowdLook, hashU32, pickVariant, rand01, SKIN_TONES } from './crowd-variants'

describe('crowd variants', () => {
  it('has between 6 and 16 outfits, both genders, every one assembled from parts', () => {
    expect(CROWD_VARIANTS.length).toBeGreaterThanOrEqual(6)
    expect(CROWD_VARIANTS.length).toBeLessThanOrEqual(16)
    expect(new Set(CROWD_VARIANTS.map((v) => v.gender))).toEqual(new Set(['men', 'women']))
    for (const v of CROWD_VARIANTS) {
      expect(v.parts.some((p) => p.startsWith('head_'))).toBe(true)
      expect(v.parts.some((p) => p.startsWith('body_'))).toBe(true)
      expect(v.parts.some((p) => p.startsWith('feet_'))).toBe(true)
      expect(v.weight).toBeGreaterThan(0)
    }
  })

  it('is deterministic per seed', () => {
    for (const seed of [0, 1, 17, 123456, 999999]) {
      expect(crowdLook(seed)).toEqual(crowdLook(seed))
    }
    expect(hashU32(42)).toBe(hashU32(42))
    expect(rand01(5, 1)).not.toBe(rand01(5, 2))
  })

  it('draws variants in proportion to their weights', () => {
    const counts = new Array(CROWD_VARIANTS.length).fill(0)
    const N = 40000
    for (let i = 0; i < N; i++) counts[pickVariant(i)]++
    const total = CROWD_VARIANTS.reduce((s, v) => s + v.weight, 0)
    CROWD_VARIANTS.forEach((v, i) => {
      const expected = (v.weight / total) * N
      expect(Math.abs(counts[i] - expected)).toBeLessThan(Math.max(80, expected * 0.12))
    })
  })

  it('keeps colours and heights in range', () => {
    for (let seed = 0; seed < 2000; seed++) {
      const l = crowdLook(seed)
      const v = CROWD_VARIANTS[l.variant]
      expect(SKIN_TONES).toContain(l.skin)
      expect(v.tops).toContain(l.top)
      expect(v.shoes).toContain(l.shoes)
      const metres = l.scale * 1.86
      if (v.gender === 'men') expect(metres).toBeGreaterThanOrEqual(1.6)
      else expect(metres).toBeGreaterThanOrEqual(1.5)
      expect(metres).toBeLessThanOrEqual(1.92)
      for (const c of [l.skin, l.hair, l.top, l.bottom, l.shoes, l.accent]) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(0xffffff)
      }
    }
  })

  it('usually matches a suit jacket and trousers', () => {
    let suits = 0
    let matched = 0
    for (let seed = 0; seed < 5000; seed++) {
      const l = crowdLook(seed)
      if (!CROWD_VARIANTS[l.variant].matchBottom) continue
      suits++
      if (l.top === l.bottom) matched++
    }
    expect(suits).toBeGreaterThan(100)
    expect(matched / suits).toBeGreaterThan(0.8)
  })
})
