import { describe, expect, it } from 'vitest'

import {
  censusPlaceholders,
  formatPlaceholders,
  PRIMITIVE_TYPES,
  type PlaceholderObject,
} from './placeholder-census'

function mesh(
  name: string,
  geometryType: string,
  extra: Partial<PlaceholderObject> = {},
): PlaceholderObject {
  return { name, isMesh: true, geometry: { type: geometryType }, ...extra }
}

function group(name: string, ...children: PlaceholderObject[]): PlaceholderObject {
  return { name, children }
}

describe('censusPlaceholders — what counts as a placeholder', () => {
  it('flags a box vehicle body, which is what the brief bans by name', () => {
    // VehicleRig builds every car from a BoxGeometry body, a BoxGeometry cabin
    // and four CylinderGeometry wheels.
    const census = censusPlaceholders(
      group('scene', mesh('car-body', 'BoxGeometry'), mesh('wheel', 'CylinderGeometry')),
    )
    expect(census.hits).toHaveLength(2)
    expect(census.byType).toEqual({ BoxGeometry: 1, CylinderGeometry: 1 })
  })

  it('does not flag authored content, which arrives as plain BufferGeometry', () => {
    // The distinction that matters: built from a primitive constructor versus
    // authored somewhere and imported. A low-poly authored asset is not a
    // placeholder, and a subdivided box still is — which is why this reads
    // geometry.type rather than guessing from triangle counts.
    const census = censusPlaceholders(
      group('scene', mesh('BLD_towers_+00_+00', 'BufferGeometry'), mesh('tree', 'BufferGeometry')),
    )
    expect(census.hits).toHaveLength(0)
    expect(census.meshes).toBe(2)
  })

  it('skips hidden meshes — a hidden box is not on screen', () => {
    const census = censusPlaceholders(
      group('scene', mesh('car-body', 'BoxGeometry', { visible: false })),
    )
    expect(census.hits).toHaveLength(0)
  })

  it('skips a whole hidden subtree', () => {
    const census = censusPlaceholders(
      group('scene', { name: 'pool', visible: false, children: [mesh('box', 'BoxGeometry')] }),
    )
    expect(census.hits).toHaveLength(0)
    expect(census.meshes).toBe(0)
  })
})

describe('censusPlaceholders — the allowlist', () => {
  it('allows a sky sphere and an ocean plane, because those are the right answer', () => {
    const census = censusPlaceholders(
      group('scene', mesh('SKY_dome', 'SphereGeometry'), mesh('WATER_ocean', 'PlaneGeometry')),
    )
    expect(census.hits).toHaveLength(0)
    expect(census.allowed).toBe(2)
  })

  it('exempts a whole subtree from its root', () => {
    // Matching on any ancestor means a system can be exempted once rather
    // than mesh by mesh.
    const census = censusPlaceholders(
      group('scene', group('WEATHER_rain', mesh('drop', 'PlaneGeometry'), mesh('drop2', 'PlaneGeometry'))),
    )
    expect(census.hits).toHaveLength(0)
    expect(census.allowed).toBe(2)
  })

  it('does not allow a name that merely contains an allowed word', () => {
    // Prefix, not substring: "car-SKY-light" is not the sky.
    const census = censusPlaceholders(group('scene', mesh('car-SKY-light', 'BoxGeometry')))
    expect(census.hits).toHaveLength(1)
  })

  it('takes a custom allowlist', () => {
    const census = censusPlaceholders(group('scene', mesh('PROP_crate', 'BoxGeometry')), {
      allowedPrefixes: ['PROP_'],
    })
    expect(census.hits).toHaveLength(0)
    expect(census.allowed).toBe(1)
  })
})

describe('censusPlaceholders — the hero radius', () => {
  const scene = group(
    'scene',
    mesh('near-box', 'BoxGeometry', { position: { x: 10, y: 0, z: 0 } }),
    mesh('far-box', 'BoxGeometry', { position: { x: 2000, y: 0, z: 0 } }),
  )
  const origin = { x: 0, y: 0, z: 0 }

  it('counts only what is near the route when a radius is given', () => {
    // The ban is about the hero route. A placeholder two kilometres away is a
    // content backlog item, not something the player is looking at.
    const census = censusPlaceholders(scene, { radius: 120, origin })
    expect(census.hits.map((h) => h.name)).toEqual(['near-box'])
  })

  it('counts everywhere when no radius is given', () => {
    expect(censusPlaceholders(scene, { origin }).hits).toHaveLength(2)
  })

  it('reports distance and sorts nearest first', () => {
    const census = censusPlaceholders(scene, { origin })
    expect(census.hits[0].name).toBe('near-box')
    expect(census.hits[0].distance).toBe(10)
    expect(census.hits[1].distance).toBe(2000)
  })

  it('prefers the world matrix over the local position', () => {
    // A mesh deep in a moved group has a local position that means nothing.
    // The translation is elements[12..14] of a column-major world matrix —
    // read directly rather than through three's getWorldPosition(), which
    // demands a real Vector3 target and throws on anything else.
    const moved = mesh('box', 'BoxGeometry', {
      position: { x: 0, y: 0, z: 0 },
      matrixWorld: {
        elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 500, 0, 0, 1],
      },
    })
    const census = censusPlaceholders(group('scene', moved), { origin })
    expect(census.hits[0].distance).toBe(500)
  })

  it('keeps a primitive with no position rather than silently dropping it', () => {
    // No position means the distance filter cannot judge it. Dropping it would
    // hide a placeholder from a check whose whole job is to find them.
    const census = censusPlaceholders(group('scene', mesh('box', 'BoxGeometry')), {
      radius: 5,
      origin,
    })
    expect(census.hits).toHaveLength(1)
    expect(census.hits[0].distance).toBeNull()
  })
})

describe('censusPlaceholders — reporting', () => {
  it('records the ancestor path so an offender can be traced to its system', () => {
    const census = censusPlaceholders(group('scene', group('vehicle-rig', mesh('body', 'BoxGeometry'))))
    expect(census.hits[0].path).toContain('vehicle-rig')
    expect(census.hits[0].path[0]).toBe('body')
  })

  it('formats a summary naming the types and the nearest offenders', () => {
    const text = formatPlaceholders(
      censusPlaceholders(group('scene', mesh('car-body', 'BoxGeometry'))),
    )
    expect(text).toMatch(/1 visible primitive/)
    expect(text).toMatch(/BoxGeometry/)
    expect(text).toMatch(/car-body/)
  })

  it('reports an empty scene as clean', () => {
    expect(censusPlaceholders(group('scene'))).toEqual({
      hits: [],
      byType: {},
      allowed: 0,
      meshes: 0,
    })
  })

  it('knows the primitive constructors three actually names', () => {
    for (const t of ['BoxGeometry', 'CylinderGeometry', 'SphereGeometry', 'ConeGeometry', 'PlaneGeometry']) {
      expect(PRIMITIVE_TYPES.has(t)).toBe(true)
    }
    expect(PRIMITIVE_TYPES.has('BufferGeometry')).toBe(false)
  })
})
