/**
 * Trees are sized in metres, not in engine units.
 *
 * The bug these cover: the planter trees rendered 34 m tall and 33 m wide,
 * inside a 2.4 m planter, next to a 4 m doorway — because `scale={0.35}` was
 * applied to an ez-tree preset whose natural height is ~98 m. The fallback
 * tree, built in metres, was 1.5 m at the same prop. One prop, two meanings,
 * a factor of twenty apart.
 *
 * Tree.tsx cannot be tested here — importing it pulls in ez-tree's ~3.9 MB
 * bundle and needs a GPU. What is testable is the contract both sides honour:
 * a natural-unit model plus a measured natural height, normalised to metres.
 */
import { describe, expect, it } from 'vitest'
import { crownFor, DEFAULT_TREE_HEIGHT } from './PlanterTree'

const VARIANTS = ['oak', 'pine', 'birch', 'willow'] as const

describe('crownFor', () => {
  it('is deterministic — the fallback must not reshuffle when the detail mesh swaps in', () => {
    for (const variant of VARIANTS) {
      const a = crownFor(910, variant)
      const b = crownFor(910, variant)
      expect(a).toEqual(b)
    }
  })

  it('gives different seeds different crowns, so a row of planters is not a clone stamp', () => {
    const shapes = [910, 918, 926, -910, -918, -926].map((s) => JSON.stringify(crownFor(s, 'oak')))
    expect(new Set(shapes).size).toBe(shapes.length)
  })

  it('reports a positive natural height for every variant', () => {
    for (const variant of VARIANTS) {
      expect(crownFor(1, variant).naturalHeight).toBeGreaterThan(0)
    }
  })

  it('normalises to the requested height in metres', () => {
    for (const variant of VARIANTS) {
      for (const seed of [1, 42, 910, 2026]) {
        const { blobs, naturalHeight } = crownFor(seed, variant)
        const scale = DEFAULT_TREE_HEIGHT / naturalHeight
        const topMetres = Math.max(...blobs.map((b) => (b.offset[1] + b.radius) * scale))
        expect(topMetres).toBeCloseTo(DEFAULT_TREE_HEIGHT, 6)
      }
    }
  })

  it('keeps a planter tree inside believable street-tree bounds', () => {
    // A 2.4 m planter beside a ~4 m doorway. A 34 m tree is the regression.
    for (const variant of VARIANTS) {
      const { blobs, naturalHeight } = crownFor(910, variant)
      const scale = DEFAULT_TREE_HEIGHT / naturalHeight
      const widest = Math.max(
        ...blobs.map((b) => (Math.abs(b.offset[0]) + b.radius) * scale),
        ...blobs.map((b) => (Math.abs(b.offset[2]) + b.radius) * scale),
      )
      expect(DEFAULT_TREE_HEIGHT).toBeGreaterThan(4)
      expect(DEFAULT_TREE_HEIGHT).toBeLessThan(12)
      // Canopy radius stays under the tree's own height — not a 33 m umbrella.
      expect(widest).toBeLessThan(DEFAULT_TREE_HEIGHT)
    }
  })

  it('makes conifers narrower than broadleaves at the same height', () => {
    const spread = (variant: (typeof VARIANTS)[number]) => {
      const { blobs, naturalHeight } = crownFor(7, variant)
      const scale = DEFAULT_TREE_HEIGHT / naturalHeight
      return Math.max(...blobs.map((b) => (Math.abs(b.offset[0]) + b.radius) * scale))
    }
    expect(spread('pine')).toBeLessThan(spread('oak'))
  })
})
