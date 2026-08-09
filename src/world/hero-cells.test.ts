import { describe, expect, it } from 'vitest'

import {
  HeroCellRegistry,
  suppressBuildings,
  verticesOfBuilding,
  tileIndexFor,
  tileFileName,
  parseTileFromMeshName,
  meshBelongsToTile,
  rememberIndex,
  rememberedIndex,
  restoreIndex,
  TILE_SIZE_M,
  type BuildingLookup,
} from './hero-cells'

/** A handful of buildings instead of 56,476. */
function city(rows: Array<{ x: number; y: number; height?: number }>): BuildingLookup {
  return {
    count: rows.length,
    x: (i) => rows[i].x,
    y: (i) => rows[i].y,
    height: (i) => rows[i].height ?? 30,
  }
}

/**
 * A merged tile: `perTriangle` names the building each triangle belongs to.
 * Returns an indexed mesh with three distinct vertices per triangle.
 */
function tile(perTriangle: number[]) {
  const bid: number[] = []
  const index: number[] = []
  perTriangle.forEach((b, t) => {
    bid.push(b, b, b)
    index.push(t * 3, t * 3 + 1, t * 3 + 2)
  })
  return { bid, index }
}

describe('which tile a lot falls in', () => {
  it('places a lot in the tile its coordinates land in', () => {
    expect(tileIndexFor(0, 0)).toEqual({ tx: 0, ty: 0 })
    expect(tileIndexFor(1399, 1399)).toEqual({ tx: 0, ty: 0 })
    expect(tileIndexFor(1400, 0)).toEqual({ tx: 1, ty: 0 })
  })

  it('floors toward negative infinity, so the south-west half of the island is not tile 0', () => {
    // Math.trunc would put x = -1 and x = +1 in the same tile, folding two
    // tiles' worth of Manhattan onto one another.
    expect(tileIndexFor(-1, -1)).toEqual({ tx: -1, ty: -1 })
    expect(tileIndexFor(-1400, -1400)).toEqual({ tx: -1, ty: -1 })
    expect(tileIndexFor(-1401, 0)).toEqual({ tx: -2, ty: 0 })
  })

  it('builds the filename city.json lists', () => {
    expect(tileFileName(0, 0)).toBe('manhattan_+00_+00.glb')
    expect(tileFileName(0, 1)).toBe('manhattan_+00_+01.glb')
    expect(tileFileName(-1, -2)).toBe('manhattan_-01_-02.glb')
  })

  it('uses the tile size city.json declares', () => {
    expect(TILE_SIZE_M).toBe(1400)
  })
})

describe('reading a tile out of a streamed mesh name', () => {
  it('parses tier, coordinates and part', () => {
    expect(parseTileFromMeshName('BLD_lowrise_-01_-01_2')).toEqual({
      tier: 'lowrise',
      tx: -1,
      ty: -1,
      part: 2,
    })
  })

  it('parses a mesh with no part', () => {
    expect(parseTileFromMeshName('BLD_highrise_+00_+03')).toEqual({
      tier: 'highrise',
      tx: 0,
      ty: 3,
      part: null,
    })
  })

  it('returns null for anything that is not a streamed building mesh', () => {
    for (const name of ['ROAD_+00_+00', 'WATER_ocean', 'vehicle-rig', '', 'BLD_broken']) {
      expect(parseTileFromMeshName(name), name).toBeNull()
    }
  })

  it('says yes to every mesh of the building own tile, because a building spans several', () => {
    // Measured on the running game: building 34877 is carried by both
    // BLD_lowrise_-01_-01_1 and BLD_lowrise_-01_-01_2. A rule that matched one
    // mesh would leave half the generated building standing inside the
    // authored one.
    const tile = { tx: -1, ty: -1 }
    expect(meshBelongsToTile('BLD_lowrise_-01_-01_1', tile)).toBe(true)
    expect(meshBelongsToTile('BLD_lowrise_-01_-01_2', tile)).toBe(true)
    expect(meshBelongsToTile('BLD_midrise_-01_-01_1', tile)).toBe(true)
  })

  it('says no to every mesh of every other tile, which is the confinement rule', () => {
    const tile = { tx: -1, ty: -1 }
    expect(meshBelongsToTile('BLD_lowrise_+00_-01_1', tile)).toBe(false)
    expect(meshBelongsToTile('BLD_lowrise_-01_+00_1', tile)).toBe(false)
    expect(meshBelongsToTile('WATER_ocean', tile)).toBe(false)
  })
})

describe('suppression is confined to the building own tile', () => {
  const world = city([
    { x: 10, y: 10 }, // 0 -> tile 0,0
    { x: 1500, y: 10 }, // 1 -> tile 1,0
    { x: 10, y: 1500 }, // 2 -> tile 0,1
  ])

  it('suppresses a building only in the tile that contains it', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 1, lod0: '/models/hero/a.glb' })
    expect([...reg.suppressedInTile(1, 0, world)]).toEqual([1])
    // The same override, asked about a tile it has nothing to do with.
    expect([...reg.suppressedInTile(0, 0, world)]).toEqual([])
    expect([...reg.suppressedInTile(0, 1, world)]).toEqual([])
  })

  it('collects several overrides that share a tile', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 0, lod0: 'a.glb' })
    reg.add({ buildingId: 2, lod0: 'b.glb' })
    expect([...reg.suppressedInTile(0, 0, world)]).toEqual([0])
    expect([...reg.suppressedInTile(0, 1, world)]).toEqual([2])
  })

  it('ignores an id the city does not have rather than asking for its position', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 9999, lod0: 'a.glb' })
    expect(() => reg.suppressedInTile(0, 0, world)).not.toThrow()
    expect([...reg.suppressedInTile(0, 0, world)]).toEqual([])
  })
})

describe('where the authored asset goes', () => {
  const world = city([{ x: 250, y: 400 }])

  it('negates northing into world z, as the projection note requires', () => {
    // Getting this sign wrong puts the hero building an equal distance the
    // wrong side of the origin — which reads as a placement bug and is a
    // projection bug.
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 0, lod0: 'a.glb' })
    const [p] = reg.placements(world)
    expect(p.position.x).toBe(250)
    expect(p.position.z).toBe(-400)
  })

  it('carries the building id and its tile, so nothing has to re-derive them', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 0, lod0: 'a.glb', rotationY: 1.5, yOffset: 0.2 })
    const [p] = reg.placements(world)
    expect(p.buildingId).toBe(0)
    expect(p.tile).toEqual({ tx: 0, ty: 0 })
    expect(p.rotationY).toBe(1.5)
    expect(p.position.y).toBe(0.2)
  })
})

describe('registry validation reports every problem, not the first', () => {
  const world = city([{ x: 0, y: 0 }, { x: 10, y: 10 }])

  it('accepts a well-formed override', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 0, lod0: 'a.glb', lod1: 'b.glb', lod1FromMetres: 250 })
    expect(reg.validate(world)).toEqual([])
  })

  it('rejects an id the city does not have', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 500, lod0: 'a.glb' })
    expect(reg.validate(world)[0].problem).toMatch(/out of range/)
  })

  it('rejects an override with no near asset', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 0, lod0: '' })
    expect(reg.validate(world)[0].problem).toMatch(/no lod0/)
  })

  it('rejects a LOD distance with nothing to switch to', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 0, lod0: 'a.glb', lod1FromMetres: 250 })
    expect(reg.validate(world)[0].problem).toMatch(/no lod1 asset/)
  })

  it('allows an override with only a near tier, because that is a real work in progress', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 0, lod0: 'a.glb' })
    expect(reg.validate(world)).toEqual([])
  })

  it('lists both problems when two overrides are wrong', () => {
    const reg = new HeroCellRegistry()
    reg.add({ buildingId: 500, lod0: 'a.glb' })
    reg.add({ buildingId: 1, lod0: '' })
    expect(reg.validate(world)).toHaveLength(2)
  })
})

describe('suppressBuildings rewrites the index and nothing else', () => {
  it('removes exactly the triangles of the named building', () => {
    const { bid, index } = tile([7, 7, 9, 9, 9])
    const r = suppressBuildings(index, bid, new Set([7]))
    expect(r.removed).toBe(2)
    expect(r.kept).toBe(3)
    expect(r.index).toHaveLength(9)
    expect(r.hit).toEqual([7])
  })

  it('removes nothing when the building is not in this tile', () => {
    const { bid, index } = tile([7, 7, 9])
    const r = suppressBuildings(index, bid, new Set([42]))
    expect(r.removed).toBe(0)
    expect(r.hit).toEqual([])
    expect([...r.index]).toEqual(index)
  })

  it('rounds the quantised _bid, which is the difference between working and silently doing nothing', () => {
    // Draco decodes _BID as e.g. 34686.0039. Comparing the raw float matches
    // nothing, reports zero removed, and leaves the generated building standing
    // inside the authored one with no error anywhere.
    const bid = [6.9999, 6.9999, 7.0004, 9, 9, 9]
    const index = [0, 1, 2, 3, 4, 5]
    const r = suppressBuildings(index, bid, new Set([7]))
    expect(r.removed).toBe(1)
    expect(r.hit).toEqual([7])
  })

  it('keeps a triangle that only partly belongs to a suppressed building', () => {
    // Party walls on a merged tile share vertices. Removing a triangle that
    // straddles two buildings would punch a hole in the neighbour that nothing
    // put there.
    const bid = [7, 7, 9]
    const index = [0, 1, 2]
    const r = suppressBuildings(index, bid, new Set([7]))
    expect(r.removed).toBe(0)
    expect(r.kept).toBe(1)
  })

  it('suppresses several buildings in one pass and says which ones matched', () => {
    const { bid, index } = tile([1, 2, 3, 1])
    const r = suppressBuildings(index, bid, new Set([1, 3, 55]))
    expect(r.removed).toBe(3)
    // 55 is in the set and matched nothing — the difference between "the
    // override applied" and "the override was configured".
    expect(r.hit).toEqual([1, 3])
  })

  it('handles a non-indexed mesh', () => {
    const bid = [4, 4, 4, 8, 8, 8]
    const r = suppressBuildings(null, bid, new Set([4]))
    expect(r.removed).toBe(1)
    expect([...r.index]).toEqual([3, 4, 5])
  })

  it('does not touch the input index', () => {
    const { bid, index } = tile([7, 9])
    const before = [...index]
    suppressBuildings(index, bid, new Set([7]))
    expect(index).toEqual(before)
  })

  it('removes everything when every building in the tile is overridden', () => {
    const { bid, index } = tile([1, 1, 1])
    const r = suppressBuildings(index, bid, new Set([1]))
    expect(r.kept).toBe(0)
    expect(r.index).toHaveLength(0)
  })
})

describe('verticesOfBuilding', () => {
  it('finds the vertices of one building, rounding as it goes', () => {
    expect([...verticesOfBuilding([3, 3.0004, 8, 3], 3)]).toEqual([0, 1, 3])
  })

  it('returns nothing for a building that is not here', () => {
    expect(verticesOfBuilding([3, 8], 5).size).toBe(0)
  })
})

describe('removal restores the original', () => {
  it('remembers the pre-suppression index and gives it back exactly', () => {
    const geometry = { userData: {} as Record<string, unknown> }
    const original = [0, 1, 2, 3, 4, 5]
    rememberIndex(geometry, original)
    expect([...(rememberedIndex(geometry) as Uint32Array)]).toEqual(original)
    expect([...(restoreIndex(geometry) as Uint32Array)]).toEqual(original)
  })

  it('remembers once, so suppressing twice does not overwrite the original', () => {
    // The failure this prevents is unrecoverable: the second remember would
    // record the already-suppressed buffer, and lifting the override would
    // restore a building that is still missing.
    const geometry = { userData: {} as Record<string, unknown> }
    rememberIndex(geometry, [0, 1, 2, 3, 4, 5])
    rememberIndex(geometry, [0, 1, 2])
    expect(rememberedIndex(geometry)).toHaveLength(6)
  })

  it('forgets after restoring, so a later suppression records the right baseline', () => {
    const geometry = { userData: {} as Record<string, unknown> }
    rememberIndex(geometry, [0, 1, 2])
    restoreIndex(geometry)
    expect(rememberedIndex(geometry)).toBeUndefined()
    rememberIndex(geometry, [9, 9, 9])
    expect([...(rememberedIndex(geometry) as Uint32Array)]).toEqual([9, 9, 9])
  })

  it('says nothing was suppressed when nothing was', () => {
    expect(rememberedIndex({ userData: {} })).toBeUndefined()
    expect(restoreIndex({ userData: {} })).toBeUndefined()
  })

  it('remembers a non-indexed mesh as null rather than losing the distinction', () => {
    const geometry = { userData: {} as Record<string, unknown> }
    rememberIndex(geometry, null)
    expect(rememberedIndex(geometry)).toBeNull()
  })

  it('round-trips: suppress, restore, and the geometry draws what it started with', () => {
    const { bid, index } = tile([7, 9, 7])
    const geometry = { userData: {} as Record<string, unknown> }
    rememberIndex(geometry, index)
    const suppressed = suppressBuildings(index, bid, new Set([7]))
    expect(suppressed.kept).toBe(1)
    const restored = restoreIndex(geometry) as Uint32Array
    expect([...restored]).toEqual(index)
    // And the restored buffer suppresses the same way again — i.e. it really
    // is the original, not a coincidentally equal length.
    expect(suppressBuildings(restored, bid, new Set([7])).removed).toBe(2)
  })
})
