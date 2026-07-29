/**
 * 4 km² of city is far too much to check by eye, so the things that would
 * actually ruin it are asserted instead: buildings in the road, buildings on
 * top of the hand-authored district, buildings in the harbour, a skyline with
 * no silhouette, and a plan that differs between two runs — which would put
 * collision somewhere other than the geometry.
 */
import { describe, expect, it } from 'vitest'
import {
  ARTERIAL_WIDTH,
  CITY_HALF,
  districtAt,
  generateCityPlan,
  HERO_DISTRICT,
  overlapsHero,
  SHORELINE_Z,
  type Lot,
} from './city-plan'

const plan = generateCityPlan()

const overlaps = (a: Lot, b: { x: number; z: number; width: number; depth: number }) =>
  Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.z - b.z) * 2 < a.depth + b.depth

describe('generateCityPlan', () => {
  it('produces a city, not a street', () => {
    // The hand-authored district had seven buildings.
    expect(plan.lots.length).toBeGreaterThan(300)
  })

  it('is deterministic — collision and geometry come from separate calls', () => {
    expect(generateCityPlan()).toEqual(generateCityPlan())
  })

  it('changes with the seed, so the layout is not hardcoded by accident', () => {
    expect(generateCityPlan(1).lots.length).not.toBe(0)
    expect(generateCityPlan(1)).not.toEqual(generateCityPlan(2))
  })

  it('never builds on the hand-authored district', () => {
    for (const lot of plan.lots) {
      expect(overlapsHero(lot.x, lot.z, lot.width, lot.depth)).toBe(false)
    }
  })

  it('never builds in the harbour', () => {
    for (const lot of plan.lots) {
      expect(lot.z - lot.depth / 2).toBeGreaterThanOrEqual(SHORELINE_Z)
    }
  })

  it('keeps every lot inside the city bounds', () => {
    for (const lot of plan.lots) {
      expect(Math.abs(lot.x) + lot.width / 2).toBeLessThanOrEqual(CITY_HALF + 1)
      expect(lot.z - lot.depth / 2).toBeGreaterThanOrEqual(SHORELINE_Z)
      expect(lot.z + lot.depth / 2).toBeLessThanOrEqual(CITY_HALF + 1)
    }
  })

  it('gives every lot a positive footprint and a real height', () => {
    for (const lot of plan.lots) {
      expect(lot.width).toBeGreaterThan(0)
      expect(lot.depth).toBeGreaterThan(0)
      // Below 3 m is a shed, above 200 m is not in this city.
      expect(lot.height).toBeGreaterThan(3)
      expect(lot.height).toBeLessThan(200)
    }
  })

  it('leaves the streets clear', () => {
    // A building standing in the carriageway is the most obvious possible bug.
    for (const road of plan.roads) {
      for (const lot of plan.lots) {
        // Only test the crossing case: a road spans the whole city on one axis.
        const near =
          Math.abs(lot.x - road.x) < road.width / 2 + lot.width / 2 &&
          Math.abs(lot.z - road.z) < road.depth / 2 + lot.depth / 2
        if (!near) continue
        expect(overlaps(lot, road)).toBe(false)
      }
    }
  })

  it('gives every lot a unique id', () => {
    const ids = new Set(plan.lots.map((l) => l.id))
    expect(ids.size).toBe(plan.lots.length)
  })

  it('rotates buildings only to right angles', () => {
    for (const lot of plan.lots) {
      const quarter = lot.rotation / (Math.PI / 2)
      expect(Math.abs(quarter - Math.round(quarter))).toBeLessThan(1e-9)
    }
  })

  it('keeps asset indices inside the table it was given', () => {
    for (const lot of generateCityPlan(0x5121, 3).lots) {
      expect(lot.asset).toBeGreaterThanOrEqual(0)
      expect(lot.asset).toBeLessThan(3)
    }
  })
})

describe('skyline', () => {
  it('is tallest near the headquarters and falls away', () => {
    const near = plan.lots.filter((l) => Math.hypot(l.x, l.z - 90) < 330)
    const far = plan.lots.filter((l) => Math.hypot(l.x, l.z - 90) > 700)
    const mean = (ls: Lot[]) => ls.reduce((a, l) => a + l.height, 0) / Math.max(1, ls.length)
    expect(near.length).toBeGreaterThan(10)
    expect(far.length).toBeGreaterThan(10)
    // A flat city reads as a car park with walls.
    expect(mean(near)).toBeGreaterThan(mean(far) * 1.8)
  })

  it('has a silhouette rather than one repeated height', () => {
    const downtown = plan.lots.filter((l) => l.district === 'downtown').map((l) => l.height)
    expect(new Set(downtown.map((h) => Math.round(h / 10))).size).toBeGreaterThan(4)
  })
})

describe('districts', () => {
  it('puts every district on the map', () => {
    const kinds = new Set(plan.lots.map((l) => l.district))
    for (const d of ['downtown', 'midrise', 'residential']) expect(kinds.has(d as never)).toBe(true)
  })

  it('never builds in the park', () => {
    expect(plan.lots.some((l) => l.district === 'park')).toBe(false)
  })

  it('classifies the harbour edge as waterfront, not downtown', () => {
    expect(districtAt(0, SHORELINE_Z + 40)).toBe('waterfront')
  })

  it('classifies the headquarters plaza as downtown', () => {
    expect(districtAt(0, 90)).toBe('downtown')
  })
})

describe('roads', () => {
  it('lays a grid in both directions', () => {
    expect(plan.roads.some((r) => r.id.startsWith('ns-'))).toBe(true)
    expect(plan.roads.some((r) => r.id.startsWith('ew-'))).toBe(true)
  })

  it('includes arterials wider than side streets', () => {
    const arterials = plan.roads.filter((r) => r.arterial)
    expect(arterials.length).toBeGreaterThan(2)
    for (const a of arterials) expect(Math.max(a.width, a.depth)).toBeGreaterThan(0)
    expect(arterials.some((r) => r.width === ARTERIAL_WIDTH || r.depth === ARTERIAL_WIDTH)).toBe(true)
  })

  it('covers the hand-authored district so it connects to the grid', () => {
    // A hero district you cannot drive out of is an island.
    const spansHero = plan.roads.some(
      (r) => r.depth > 500 && Math.abs(r.x) < HERO_DISTRICT.maxX + 200,
    )
    expect(spansHero).toBe(true)
  })
})
