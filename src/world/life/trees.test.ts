import { describe, expect, it } from 'vitest'
import {
  FAR_R, MID_R, NEAR_R, SPECIES_ORDER, lodWeights, parkScale, parkSpecies, streetScale, streetSpecies,
} from './tree-lod'
import { extractConeTrees } from './park-trees'
import { TREE_SPECIES, cellRect, envelopeRadius, growTree, makeRng } from './tree-gen'

describe('tree LOD bands', () => {
  it('always sums to one and hands over near -> mid -> far', () => {
    for (let d = 0; d < FAR_R; d += 3.7) {
      const w = lodWeights(d)
      expect(w.near + w.mid + w.far).toBeCloseTo(1, 6)
      for (const v of [w.near, w.mid, w.far]) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
    expect(lodWeights(10).near).toBe(1)
    expect(lodWeights((NEAR_R + MID_R) / 2).mid).toBe(1)
    expect(lodWeights(MID_R * 2).far).toBe(1)
  })
})

describe('species choice', () => {
  it('maps forestry variants to the right families, deterministically', () => {
    for (let i = 0; i < 500; i++) {
      expect(streetSpecies(2, i)).toBe('pine')
      expect(['ginkgo', 'pinoak']).toContain(streetSpecies(1, i))
      expect(['plane', 'locust', 'pinoak']).toContain(streetSpecies(0, i))
      expect(streetSpecies(0, i)).toBe(streetSpecies(0, i))
      expect(SPECIES_ORDER).toContain(parkSpecies(i))
    }
  })

  it('makes London plane the commonest broad street tree', () => {
    const n: Record<string, number> = {}
    for (let i = 0; i < 20000; i++) {
      const s = streetSpecies(0, i)
      n[s] = (n[s] ?? 0) + 1
    }
    expect(n.plane).toBeGreaterThan(n.locust)
    expect(n.locust).toBeGreaterThan(n.pinoak)
  })

  it('clamps sizes', () => {
    expect(streetScale(42)).toBeCloseTo(0.8)
    expect(streetScale(0)).toBeCloseTo(0.55 * 0.8)
    expect(streetScale(255)).toBeCloseTo(1.3 * 0.8)
    expect(parkScale(10.3)).toBeCloseTo(1)
    expect(parkScale(1)).toBeCloseTo(0.65)
  })
})

describe('park tree extraction', () => {
  // a five-sided bipyramid, non-indexed, like the export's cones
  function cone(x: number, z: number, ground: number, h: number): number[] {
    const out: number[] = []
    const ring: number[][] = []
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2
      ring.push([x + Math.cos(a) * 3, ground + h * 0.3, z + Math.sin(a) * 3])
    }
    for (let i = 0; i < 5; i++) {
      const p = ring[i]
      const q = ring[(i + 1) % 5]
      out.push(...p, ...q, x, ground, z)
      out.push(...q, ...p, x, ground + h, z)
    }
    return out
  }

  it('finds one tree per cone with its top and its ground', () => {
    const pos = [...cone(10, 20, 12.08, 9), ...cone(-40, 5, 12.1, 11.5), ...cone(100, -3, 12, 7)]
    const trees = extractConeTrees(pos, null)
    expect(trees).toHaveLength(3)
    expect(trees[0]).toMatchObject({ x: -40, z: 5 })
    expect(trees[0].height).toBeCloseTo(11.5, 4)
    expect(trees[1].ground).toBeCloseTo(12.08, 4)
    expect(trees[2].x).toBe(100)
  })

  it('works through an index and ignores stray triangles', () => {
    const pos = [...cone(0, 0, 12, 10), 500, 0, 0, 501, 0, 0, 500, 1, 0]
    const n = pos.length / 3
    const index = Array.from({ length: n }, (_, i) => i)
    expect(extractConeTrees(pos, index)).toHaveLength(1)
  })
})

describe('procedural trees', () => {
  it('is deterministic for a species and seed', () => {
    const a = growTree(TREE_SPECIES.plane, 3, 'near')
    const b = growTree(TREE_SPECIES.plane, 3, 'near')
    expect(Array.from(a.leaves.attributes.position.array)).toEqual(Array.from(b.leaves.attributes.position.array))
    expect(a.branches.index!.count).toBe(b.branches.index!.count)
    const r1 = makeRng(9)
    const r2 = makeRng(9)
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })

  it('keeps every LOD inside its triangle budget', () => {
    for (const key of SPECIES_ORDER) {
      const sp = TREE_SPECIES[key]
      const near = growTree(sp, 1, 'near')
      const mid = growTree(sp, 1, 'mid')
      const tris = (t: typeof near) => (t.branches.index!.count + t.leaves.index!.count) / 3
      expect(tris(near)).toBeLessThan(4200)
      expect(tris(mid)).toBeLessThan(900)
      expect(tris(mid)).toBeLessThan(tris(near) / 3)
      // grows to about its reference height
      expect(near.height).toBeGreaterThan(sp.height * 0.8)
      expect(near.height).toBeLessThan(sp.height * 1.25)
    }
  })

  it('shapes crowns and maps atlas cells inside the texture', () => {
    expect(envelopeRadius('round', 0.5)).toBeCloseTo(1)
    expect(envelopeRadius('cone', 0.95)).toBeLessThan(0.1)
    expect(envelopeRadius('round', 1.5)).toBe(0)
    for (let c = 0; c < 8; c++) {
      const [u, v, du, dv] = cellRect(c)
      expect(u).toBeGreaterThanOrEqual(0)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(u + du).toBeLessThanOrEqual(1)
      expect(v + dv).toBeLessThanOrEqual(1)
    }
  })
})
