import { describe, expect, it } from 'vitest'

import {
  censusMaterials,
  classifyTier,
  formatCensus,
  type CensusObject,
} from './material-census'

/** A mesh in the shape the census walks. */
function mesh(
  name: string,
  attributes: string[],
  material: { name?: string; vertexColors?: boolean; map?: unknown; normalMap?: unknown },
): CensusObject {
  return {
    name,
    isMesh: true,
    geometry: { attributes: Object.fromEntries(attributes.map((a) => [a, {}])) },
    material,
  }
}

function scene(...children: CensusObject[]): CensusObject {
  return { name: 'scene', children }
}

describe('classifyTier', () => {
  it('separates the three building tiers the exporter writes', () => {
    expect(classifyTier('BLD_lowrise_+00_+00')).toBe('BLD_lowrise')
    expect(classifyTier('BLD_midrise_-02_+01')).toBe('BLD_midrise')
    expect(classifyTier('BLD_towers_+01_-03')).toBe('BLD_towers')
  })

  it('separates roads from road markings', () => {
    // ROADMARK_ starts with ROAD in a naive prefix test, and they are
    // different surfaces with different materials.
    expect(classifyTier('ROADMARK_W_+00_+00')).toBe('ROADMARK')
    expect(classifyTier('ROAD_+00_+00')).toBe('ROAD')
  })

  it('classifies the ground and water tiers', () => {
    expect(classifyTier('LAND_manhattan')).toBe('LAND')
    expect(classifyTier('WATER_ocean')).toBe('WATER')
    expect(classifyTier('SIDEWALK_+00_+00')).toBe('SIDEWALK')
  })

  it('is case-insensitive and safe on a nameless mesh', () => {
    expect(classifyTier('bld_towers_x')).toBe('BLD_towers')
    expect(classifyTier('')).toBe('other')
  })
})

describe('censusMaterials — the contract between material and geometry', () => {
  it('catches a material that reads vertex colours the geometry lacks', () => {
    // The exact shipped defect: ROAD_* carries only POSITION and NORMAL, and
    // getRoadNightMaterial declared vertexColors true. WebGL fed it
    // (0,0,0,1) and every road rendered black, with no error anywhere.
    const census = censusMaterials(
      scene(mesh('ROAD_+00_+00', ['position', 'normal'], { name: 'road-night', vertexColors: true })),
    )
    const errors = census.problems.filter((p) => p.severity === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0].tier).toBe('ROAD')
    expect(errors[0].problem).toMatch(/renders black/)
  })

  it('passes the same tier once the material stops asking', () => {
    const census = censusMaterials(
      scene(mesh('ROAD_+00_+00', ['position', 'normal'], { name: 'road-night', vertexColors: false })),
    )
    expect(census.problems.filter((p) => p.severity === 'error')).toHaveLength(0)
  })

  it('accepts buildings reading vertex colours, because they have them', () => {
    // The asymmetry is the point: BLD_* carries COLOR_0 and ROAD_* does not.
    const census = censusMaterials(
      scene(
        mesh('BLD_towers_+00_+00', ['position', 'normal', 'color'], {
          name: 'facade',
          vertexColors: true,
        }),
      ),
    )
    expect(census.problems).toHaveLength(0)
  })

  it('warns when a building ignores the colour it carries', () => {
    const census = censusMaterials(
      scene(
        mesh('BLD_lowrise_+00_+00', ['position', 'color'], { name: 'plain', vertexColors: false }),
      ),
    )
    expect(census.problems).toHaveLength(1)
    expect(census.problems[0].severity).toBe('warning')
    expect(census.problems[0].problem).toMatch(/ignores it/)
  })

  it('catches a textured material on geometry with no UVs', () => {
    const census = censusMaterials(
      scene(mesh('LAND_manhattan', ['position', 'normal'], { name: 'ground', map: {} })),
    )
    expect(census.problems.filter((p) => p.severity === 'error')).toHaveLength(1)
    expect(census.problems[0].problem).toMatch(/no UVs/)
  })

  it('accepts COLOR_0 and TEXCOORD_0 as the glTF spellings', () => {
    const census = censusMaterials(
      scene(
        mesh('BLD_towers_a', ['POSITION', 'COLOR_0'], { vertexColors: true }),
        mesh('LAND_a', ['POSITION', 'TEXCOORD_0'], { map: {} }),
      ),
    )
    expect(census.problems).toHaveLength(0)
  })
})

describe('censusMaterials — reporting', () => {
  const world = scene(
    mesh('BLD_towers_+00_+00', ['position', 'color'], { name: 'facade', vertexColors: true }),
    mesh('BLD_towers_+01_+00', ['position', 'color'], { name: 'facade', vertexColors: true }),
    mesh('ROAD_+00_+00', ['position', 'normal'], { name: 'road-night' }),
    { name: 'group', children: [mesh('LAND_manhattan', ['position'], { name: 'ground' })] },
  )

  it('groups meshes by tier and lists the materials bound to each', () => {
    const census = censusMaterials(world)
    const towers = census.tiers.find((t) => t.tier === 'BLD_towers')!
    expect(towers.meshes).toBe(2)
    expect(towers.materials).toEqual(['facade'])
    expect(towers.allHaveColor).toBe(true)
    expect(towers.readsVertexColor).toBe(true)

    const road = census.tiers.find((t) => t.tier === 'ROAD')!
    expect(road.allHaveColor).toBe(false)
    expect(road.readsVertexColor).toBe(false)
  })

  it('descends into nested groups', () => {
    expect(censusMaterials(world).tiers.some((t) => t.tier === 'LAND')).toBe(true)
    expect(censusMaterials(world).meshes).toBe(4)
  })

  it('counts hidden meshes too', () => {
    // A tier hidden this frame still renders when shown. A census that only
    // saw visible meshes would report differently on every run.
    const census = censusMaterials(
      scene({ ...mesh('BLD_towers_x', ['position', 'color'], { vertexColors: true }), visible: false }),
    )
    expect(census.meshes).toBe(1)
  })

  it('handles an array of materials on one mesh', () => {
    const census = censusMaterials(
      scene({
        name: 'ROAD_multi',
        isMesh: true,
        geometry: { attributes: { position: {} } },
        material: [{ name: 'a', vertexColors: true }, { name: 'b' }],
      }),
    )
    expect(census.tiers[0].materials).toEqual(['a', 'b'])
    expect(census.problems.filter((p) => p.severity === 'error')).toHaveLength(1)
  })

  it('survives a mesh with no material or no geometry', () => {
    const census = censusMaterials(
      scene(
        { name: 'ROAD_bare', isMesh: true, geometry: { attributes: {} } },
        { name: 'ROAD_nogeo', isMesh: true },
      ),
    )
    expect(census.meshes).toBe(1)
    expect(census.problems).toHaveLength(0)
  })

  it('formats a summary that names the failing mesh', () => {
    const text = formatCensus(
      censusMaterials(scene(mesh('ROAD_+00_+00', ['position'], { name: 'road-night', vertexColors: true }))),
    )
    expect(text).toMatch(/ROAD/)
    expect(text).toMatch(/road-night/)
    expect(text).toMatch(/1 error/)
  })

  it('reports an empty scene without inventing tiers', () => {
    const census = censusMaterials(scene())
    expect(census).toEqual({ tiers: [], problems: [], meshes: 0 })
  })
})
