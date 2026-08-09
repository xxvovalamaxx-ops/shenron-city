import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { PHASE1_SPAWN } from './phase1-contract'
import { Phase1GameplayTileSystem } from './phase1-gameplay'

const SOURCE_HASH = 'a'.repeat(64)
const DERIVATION_HASH = 'b'.repeat(64)
const SOURCE_ID = 'phase1-test-buildings'
const AXIS_CONVENTION = 'x-east-y-up-z-negative-north'
const COLLIDER_COORDINATE_SPACE = 'tile-local-horizontal-plus-hq-local-y-up-meters'

function manifestTile(tileId: string, boundsHqLocal: Record<string, number>, buildingId: string) {
  return {
    tileId,
    boundsHqLocal,
    collisionUri: `tiles/${tileId}.json`,
    buildingCount: 1,
    buildingIds: [buildingId],
  }
}

function baseManifest(tiles: ReturnType<typeof manifestTile>[]) {
  return {
    schemaVersion: 2,
    generatedBy: 'test-generator/1.0.0',
    sourceId: SOURCE_ID,
    sourceHash: SOURCE_HASH,
    normalizedDerivationSha256: DERIVATION_HASH,
    coordinateSpace: 'hq-local-meters',
    axisConvention: AXIS_CONVENTION,
    tileOriginAxisOrder: ['hq-local-east', 'hq-local-north'],
    colliderCoordinateSpace: COLLIDER_COORDINATE_SPACE,
    footprintLocalAxisOrder: ['tile-local-east', 'tile-local-negative-north'],
    verticalAxis: 'hq-local-y-up',
    verticalReference: {
      hqAnchorVerticalDatum: 'NAVD88',
      normalizedUpFormula: 'sourceGroundElevationMeters - hqGeoAnchor.elevationMeters',
      sourceDatumRelation: 'same-as-hq-anchor',
      sourceGroundElevationVerticalDatum: 'NAVD88',
    },
    tileSizeMeters: 256,
    activationRadiusMeters: 384,
    tiles,
  }
}

function colliderFixture(tileId = '256_p000_p000', buildingId = 'fixture-hq') {
  const footprintLocal = [[-10, 10], [10, 10], [10, -10], [-10, -10]]
  return {
    schemaVersion: 2,
    tileId,
    tileSizeMeters: 256,
    tileOriginMeters: [0, 0],
    tileOriginAxisOrder: ['hq-local-east', 'hq-local-north'],
    coordinateSpace: COLLIDER_COORDINATE_SPACE,
    axisConvention: AXIS_CONVENTION,
    footprintLocalAxisOrder: ['tile-local-east', 'tile-local-negative-north'],
    verticalAxis: 'hq-local-y-up',
    sourceId: SOURCE_ID,
    sourceHash: SOURCE_HASH,
    normalizedDerivationSha256: DERIVATION_HASH,
    buildingCount: 1,
    buildingIds: [buildingId],
    colliders: [{
      buildingId,
      footprintLocal,
      minY: 0,
      maxY: 50,
      boundsLocal: {
        minEast: -10,
        maxEast: 10,
        minNegativeNorth: -10,
        maxNegativeNorth: 10,
        minY: 0,
        maxY: 50,
      },
    }],
  }
}

function fixture() {
  const tile = manifestTile(
    '256_p000_p000',
    { minEast: -10, minNorth: -10, maxEast: 10, maxNorth: 10 },
    'fixture-hq',
  )
  return { manifest: baseManifest([tile]), collider: colliderFixture() }
}

function collisionDouble() {
  const ground = new Set<THREE.Mesh>()
  const roots = new Set<THREE.Object3D>()
  return {
    ground,
    roots,
    registry: {
      baseReady: false,
      registerGround: vi.fn((mesh: THREE.Mesh) => ground.add(mesh)),
      unregisterGround: vi.fn((mesh: THREE.Mesh) => ground.delete(mesh)),
      registerInterior: vi.fn((root: THREE.Object3D) => roots.add(root)),
      unregisterTileBuildings: vi.fn((root: THREE.Object3D) => roots.delete(root)),
    },
  }
}

describe('Phase1GameplayTileSystem', () => {
  it('loads near colliders from the locked gameplay product and disposes every resource', async () => {
    const { manifest, collider } = fixture()
    const collision = collisionDouble()
    const fetchJson = vi.fn(async (url: string) =>
      url.endsWith('manifest.json') ? manifest : collider)
    const system = new Phase1GameplayTileSystem({
      manifestUrl: 'http://fixture/gameplay/manifest.json',
      expectedSourceHash: SOURCE_HASH,
      expectedNormalizedDerivationSha256: DERIVATION_HASH,
      expectedTileIds: ['256_p000_p000'],
      fetchJson,
      collision: collision.registry,
    })

    await system.load(PHASE1_SPAWN)

    expect(fetchJson).toHaveBeenCalledTimes(2)
    expect(collision.registry.baseReady).toBe(true)
    expect(collision.ground.size).toBe(1)
    expect(collision.roots.size).toBe(1)
    expect(system.snapshot()).toMatchObject({
      status: 'ready',
      residentTileIds: ['256_p000_p000'],
      colliderCount: 1,
      loads: 1,
      errors: 0,
    })

    await system.update({ x: PHASE1_SPAWN.x + 10_000, y: PHASE1_SPAWN.y, z: PHASE1_SPAWN.z })
    expect(system.snapshot().residentTileIds).toEqual([])
    expect(collision.roots.size).toBe(0)

    system.dispose()
    expect(system.snapshot().status).toBe('disposed')
    expect(collision.ground.size).toBe(0)
    expect(collision.registry.baseReady).toBe(false)
  })

  it('rejects a collider tile whose source hash is not the manifest lock', async () => {
    const { manifest, collider } = fixture()
    const collision = collisionDouble()
    const fetchJson = vi.fn(async (url: string) =>
      url.endsWith('manifest.json') ? manifest : { ...collider, sourceHash: 'c'.repeat(64) })
    const system = new Phase1GameplayTileSystem({
      manifestUrl: 'http://fixture/gameplay/manifest.json',
      fetchJson,
      collision: collision.registry,
    })

    await expect(system.load(PHASE1_SPAWN)).rejects.toThrow(/loaded no collider|source hash/i)

    expect(system.snapshot()).toMatchObject({
      status: 'error',
      residentTileIds: [],
      colliderCount: 0,
      errors: 1,
    })
    expect(collision.roots.size).toBe(0)
    expect(collision.ground.size).toBe(0)
    expect(collision.registry.baseReady).toBe(false)
    system.dispose()
  })

  it('rolls back the initial handoff when resident tiles contain no colliders', async () => {
    const tile = {
      tileId: '256_p000_p000',
      boundsHqLocal: { minEast: -10, minNorth: -10, maxEast: 10, maxNorth: 10 },
      collisionUri: 'tiles/256_p000_p000.json',
      buildingCount: 0,
      buildingIds: [],
    }
    const manifest = baseManifest([tile])
    const collider = {
      ...colliderFixture(),
      buildingCount: 0,
      buildingIds: [],
      colliders: [],
    }
    const collision = collisionDouble()
    const system = new Phase1GameplayTileSystem({
      manifestUrl: 'http://fixture/gameplay/manifest.json',
      fetchJson: async (url) => url.endsWith('manifest.json') ? manifest : collider,
      collision: collision.registry,
    })

    await expect(system.load(PHASE1_SPAWN)).rejects.toThrow(/no colliders/i)
    expect(system.snapshot()).toMatchObject({
      status: 'error',
      residentTileIds: [],
      colliderCount: 0,
    })
    expect(collision.roots.size).toBe(0)
    expect(collision.ground.size).toBe(0)
    expect(collision.registry.baseReady).toBe(false)
    system.dispose()
  })

  it('rejects gameplay tile identity, canonical origin, bounds, and polygon tampering', async () => {
    const cases = [
      {
        name: 'release tile identity',
        mutateManifest: (manifest: ReturnType<typeof baseManifest>) => manifest,
        mutateCollider: (collider: ReturnType<typeof colliderFixture>) => collider,
        expectedTileIds: ['256_p001_p000'],
        message: /tile IDs do not match the release descriptor/i,
      },
      {
        name: 'tile origin',
        mutateManifest: (manifest: ReturnType<typeof baseManifest>) => manifest,
        mutateCollider: (collider: ReturnType<typeof colliderFixture>) => ({
          ...collider,
          tileOriginMeters: [256, 0],
        }),
        expectedTileIds: ['256_p000_p000'],
        message: /tileOriginMeters does not match/i,
      },
      {
        name: 'manifest bounds',
        mutateManifest: (manifest: ReturnType<typeof baseManifest>) => ({
          ...manifest,
          tiles: manifest.tiles.map((tile) => ({
            ...tile,
            boundsHqLocal: { ...tile.boundsHqLocal, maxEast: 11 },
          })),
        }),
        mutateCollider: (collider: ReturnType<typeof colliderFixture>) => collider,
        expectedTileIds: ['256_p000_p000'],
        message: /does not match its manifest bounds/i,
      },
      {
        name: 'self-intersecting footprint',
        mutateManifest: (manifest: ReturnType<typeof baseManifest>) => manifest,
        mutateCollider: (collider: ReturnType<typeof colliderFixture>) => ({
          ...collider,
          colliders: [{
            ...collider.colliders[0],
            footprintLocal: [[-10, -10], [10, 10], [10, -10], [-10, 10]],
          }],
        }),
        expectedTileIds: ['256_p000_p000'],
        message: /self-intersects/i,
      },
    ]

    for (const testCase of cases) {
      const base = fixture()
      const manifest = testCase.mutateManifest(base.manifest)
      const collider = testCase.mutateCollider(base.collider)
      const collision = collisionDouble()
      const system = new Phase1GameplayTileSystem({
        manifestUrl: 'http://fixture/gameplay/manifest.json',
        expectedTileIds: testCase.expectedTileIds,
        fetchJson: async (url) => url.endsWith('manifest.json') ? manifest : collider,
        collision: collision.registry,
      })

      await expect(system.load(PHASE1_SPAWN), testCase.name).rejects.toThrow(testCase.message)
      expect(collision.registry.baseReady, testCase.name).toBe(false)
      expect(collision.ground.size, testCase.name).toBe(0)
      expect(collision.roots.size, testCase.name).toBe(0)
      system.dispose()
    }
  })

  it('aborts pending initial loads and rolls back every gameplay resource after a failure', async () => {
    const first = manifestTile(
      '256_p000_p000',
      { minEast: -10, minNorth: -10, maxEast: 10, maxNorth: 10 },
      'fixture-first',
    )
    const pending = manifestTile(
      '256_p000_p001',
      { minEast: -20, minNorth: -100, maxEast: 20, maxNorth: 20 },
      'fixture-pending',
    )
    const failing = manifestTile(
      '256_p000_p002',
      { minEast: -20, minNorth: -100, maxEast: 20, maxNorth: 20 },
      'fixture-failing',
    )
    const manifest = baseManifest([first, pending, failing])
    const collision = collisionDouble()
    let resolveFirstRegistration: (() => void) | null = null
    const firstRegistration = new Promise<void>((resolve) => {
      resolveFirstRegistration = resolve
    })
    collision.registry.registerInterior.mockImplementation((root: THREE.Object3D) => {
      resolveFirstRegistration?.()
      return collision.roots.add(root)
    })
    const pendingSignals: AbortSignal[] = []
    const materialDispose = vi.spyOn(THREE.MeshBasicMaterial.prototype, 'dispose')
    const fetchJson = vi.fn((url: string, signal: AbortSignal): Promise<unknown> => {
      if (url.endsWith('manifest.json')) return Promise.resolve(manifest)
      if (url.endsWith('256_p000_p000.json')) return Promise.resolve(colliderFixture(first.tileId, 'fixture-first'))
      if (url.endsWith('256_p000_p001.json')) {
        pendingSignals.push(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted pending collider')), { once: true })
        })
      }
      if (url.endsWith('256_p000_p002.json')) {
        return firstRegistration.then(() => Promise.reject(new Error('injected collider failure')))
      }
      return Promise.reject(new Error(`unexpected URL ${url}`))
    })
    const system = new Phase1GameplayTileSystem({
      manifestUrl: 'http://fixture/gameplay/manifest.json',
      fetchJson,
      collision: collision.registry,
    })

    try {
      await expect(system.load(PHASE1_SPAWN)).rejects.toThrow(/injected collider failure/i)
      await Promise.resolve()

      expect(pendingSignals).toHaveLength(1)
      expect(pendingSignals[0].aborted).toBe(true)
      expect(system.snapshot()).toMatchObject({
        status: 'error',
        residentTileIds: [],
        pendingTileIds: [],
        colliderCount: 0,
      })
      expect(collision.roots.size).toBe(0)
      expect(collision.ground.size).toBe(0)
      expect(collision.registry.baseReady).toBe(false)
      expect(collision.registry.unregisterTileBuildings).toHaveBeenCalledTimes(1)
      expect(collision.registry.unregisterGround).toHaveBeenCalledTimes(1)
      expect(materialDispose).toHaveBeenCalledTimes(1)

      const callsAfterFailure = fetchJson.mock.calls.length
      await system.update(PHASE1_SPAWN)
      expect(fetchJson).toHaveBeenCalledTimes(callsAfterFailure)

      system.dispose()
      expect(materialDispose).toHaveBeenCalledTimes(1)
    } finally {
      materialDispose.mockRestore()
    }
  })
})
