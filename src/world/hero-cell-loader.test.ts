/**
 * The loading half of Stage 1: does the authored building arrive, does it
 * arrive *before* the generated one is removed, and does a failure cost
 * nothing?
 *
 * Uses real THREE objects with a fake GLTF source. The geometry is not the
 * point; the ordering is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import {
  DEFAULT_LOD1_METRES,
  loadHeroCell,
  syncHeroCells,
  updateHeroLods,
  type GltfSource,
  type LoadedHeroCell,
} from './hero-cell-loader'
import { HeroCellRegistry, type BuildingLookup } from './hero-cells'

let colliderCount = 0
vi.mock('./manhattan-collision', () => ({
  manhattanCollision: {
    // Counts what it accepted, mirroring the real system closely enough that
    // "registered nothing" is visible here rather than only in the browser.
    registerInterior: vi.fn(() => {
      colliderCount += 1
    }),
    registerTileBuildings: vi.fn(),
    unregisterTileBuildings: vi.fn(),
    get buildingColliderCount() {
      return colliderCount
    },
  },
}))

function city(rows: Array<{ x: number; y: number }>): BuildingLookup {
  return {
    count: rows.length,
    x: (i) => rows[i].x,
    y: (i) => rows[i].y,
    height: () => 40,
  }
}

/** A GLTF source that hands back a one-mesh scene, or fails for named urls. */
function fakeLoader(failing: string[] = []): GltfSource {
  return {
    async loadAsync(url: string) {
      if (failing.includes(url)) throw new Error(`404 ${url}`)
      const group = new THREE.Group()
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
      mesh.name = `mesh-of-${url}`
      group.add(mesh)
      return { scene: group }
    },
  }
}

describe('placing an authored building', () => {
  let parent: THREE.Group
  beforeEach(() => {
    parent = new THREE.Group()
    colliderCount = 0
  })

  const placement = {
    buildingId: 42,
    position: { x: 100, y: 0.5, z: -250 },
    rotationY: 0.75,
    tile: { tx: 0, ty: 0 },
    spec: { buildingId: 42, lod0: '/hero/a.glb' },
  }

  it('adds a group named for the building it replaces', () => {
    // Named so anything walking the scene — the placeholder census, a
    // screenshot diff, a person in the inspector — can say which record it
    // came from.
    return loadHeroCell(placement, fakeLoader(), parent).then((cell) => {
      expect(cell).toBeTruthy()
      expect(cell!.group.name).toBe('HERO_42')
      expect(parent.children).toContain(cell!.group)
    })
  })

  it('puts it at the lot, with the requested rotation', async () => {
    const cell = await loadHeroCell(placement, fakeLoader(), parent)
    expect(cell!.group.position.toArray()).toEqual([100, 0.5, -250])
    expect(cell!.group.rotation.y).toBeCloseTo(0.75, 9)
  })

  it('loads both tiers and starts on the near one', async () => {
    const cell = await loadHeroCell(
      { ...placement, spec: { buildingId: 42, lod0: '/hero/a.glb', lod1: '/hero/b.glb' } },
      fakeLoader(),
      parent,
    )
    expect(cell!.lod1).toBeTruthy()
    expect(cell!.lod0.visible).toBe(true)
    expect(cell!.lod1!.visible).toBe(false)
  })

  it('returns null and reports when the near tier will not load', async () => {
    const failures: unknown[] = []
    const cell = await loadHeroCell(placement, fakeLoader(['/hero/a.glb']), parent, (f) =>
      failures.push(f),
    )
    expect(cell).toBeNull()
    expect(parent.children).toHaveLength(0)
    expect(failures).toHaveLength(1)
  })

  it('keeps the cell when only the far tier fails, and says so', async () => {
    // LOD0 at all distances is worse-performing and correct. Refusing the whole
    // cell would be neither.
    const failures: Array<{ reason: string }> = []
    const cell = await loadHeroCell(
      { ...placement, spec: { buildingId: 42, lod0: '/hero/a.glb', lod1: '/hero/b.glb' } },
      fakeLoader(['/hero/b.glb']),
      parent,
      (f) => failures.push(f),
    )
    expect(cell).toBeTruthy()
    expect(cell!.lod1).toBeNull()
    expect(failures[0].reason).toMatch(/far tier failed/)
  })

  it('defaults the switch distance when the spec does not give one', async () => {
    const cell = await loadHeroCell(placement, fakeLoader(), parent)
    expect(cell!.lod1FromMetres).toBe(DEFAULT_LOD1_METRES)
  })
})

describe('nothing is suppressed until the replacement is standing', () => {
  const world = city([{ x: 10, y: 10 }, { x: 20, y: 20 }])
  let parent: THREE.Group
  let registry: HeroCellRegistry
  let loaded: Map<number, LoadedHeroCell>

  beforeEach(() => {
    parent = new THREE.Group()
    registry = new HeroCellRegistry()
    loaded = new Map()
  })

  it('marks a cell ready only after its geometry is in the scene', async () => {
    registry.add({ buildingId: 0, lod0: '/hero/a.glb' })
    expect(registry.isReady(0)).toBe(false)
    await syncHeroCells(registry, world, fakeLoader(), parent, loaded)
    expect(registry.isReady(0)).toBe(true)
    expect(loaded.has(0)).toBe(true)
  })

  it('leaves a failed cell not-ready, so the generated building stays', async () => {
    // The whole reason readiness exists. Suppressing first would turn a
    // renamed export into a permanent hole in Manhattan.
    registry.add({ buildingId: 0, lod0: '/hero/missing.glb' })
    const report = await syncHeroCells(
      registry,
      world,
      fakeLoader(['/hero/missing.glb']),
      parent,
      loaded,
    )
    expect(registry.isReady(0)).toBe(false)
    expect(report.failed).toHaveLength(1)
    expect(report.loaded).toEqual([])
    expect(parent.children).toHaveLength(0)
  })

  it('one failing cell does not stop the others loading', async () => {
    registry.add({ buildingId: 0, lod0: '/hero/missing.glb' })
    registry.add({ buildingId: 1, lod0: '/hero/good.glb' })
    const report = await syncHeroCells(
      registry,
      world,
      fakeLoader(['/hero/missing.glb']),
      parent,
      loaded,
    )
    expect(report.loaded).toEqual([1])
    expect(report.failed).toHaveLength(1)
  })

  it('unloading clears readiness, so the generated building comes back', async () => {
    // The two halves have to move together or the lot is left empty.
    registry.add({ buildingId: 0, lod0: '/hero/a.glb' })
    await syncHeroCells(registry, world, fakeLoader(), parent, loaded)
    registry.remove(0)
    const report = await syncHeroCells(registry, world, fakeLoader(), parent, loaded)
    expect(report.unloaded).toEqual([0])
    expect(registry.isReady(0)).toBe(false)
    expect(loaded.size).toBe(0)
    expect(parent.children).toHaveLength(0)
  })

  it('is idempotent, so it can run whenever the registry might have changed', async () => {
    registry.add({ buildingId: 0, lod0: '/hero/a.glb' })
    await syncHeroCells(registry, world, fakeLoader(), parent, loaded)
    const second = await syncHeroCells(registry, world, fakeLoader(), parent, loaded)
    expect(second.loaded).toEqual([])
    expect(second.unloaded).toEqual([])
    expect(parent.children).toHaveLength(1)
  })
})

describe('LOD switching', () => {
  function cell(over: Partial<LoadedHeroCell> = {}): LoadedHeroCell {
    const lod0 = new THREE.Object3D()
    const lod1 = new THREE.Object3D()
    lod1.visible = false
    return {
      buildingId: 1,
      group: new THREE.Group(),
      lod0,
      lod1,
      lod1FromMetres: 300,
      position: new THREE.Vector3(0, 0, 0),
      ...over,
    }
  }

  it('shows the near tier up close', () => {
    const c = cell()
    updateHeroLods([c], new THREE.Vector3(0, 0, 50))
    expect(c.lod0.visible).toBe(true)
    expect(c.lod1!.visible).toBe(false)
  })

  it('shows the far tier from a distance', () => {
    const c = cell()
    updateHeroLods([c], new THREE.Vector3(0, 0, 1000))
    expect(c.lod0.visible).toBe(false)
    expect(c.lod1!.visible).toBe(true)
  })

  it('does not flip every frame on the boundary', () => {
    // Without hysteresis a player standing at exactly the switch distance
    // toggles tiers each frame: a visible pop and a steady stream of
    // draw-call churn.
    const c = cell()
    // Just inside the band while showing near: stays near.
    updateHeroLods([c], new THREE.Vector3(0, 0, 305))
    expect(c.lod1!.visible).toBe(false)
    // Past the upper edge: switches to far.
    updateHeroLods([c], new THREE.Vector3(0, 0, 340))
    expect(c.lod1!.visible).toBe(true)
    // Back to 305 while showing far: stays far, rather than flipping back.
    updateHeroLods([c], new THREE.Vector3(0, 0, 305))
    expect(c.lod1!.visible).toBe(true)
    // Below the lower edge: back to near.
    updateHeroLods([c], new THREE.Vector3(0, 0, 260))
    expect(c.lod1!.visible).toBe(false)
  })

  it('leaves a cell with no far tier on the near one at any distance', () => {
    const c = cell({ lod1: null })
    const counts = updateHeroLods([c], new THREE.Vector3(0, 0, 5000))
    expect(c.lod0.visible).toBe(true)
    expect(counts).toEqual({ near: 1, far: 0 })
  })

  it('counts what it decided, so a probe can check the switch happened', () => {
    const near = cell({ position: new THREE.Vector3(0, 0, 0) })
    const far = cell({ position: new THREE.Vector3(0, 0, -2000) })
    expect(updateHeroLods([near, far], new THREE.Vector3(0, 0, 0))).toEqual({ near: 1, far: 1 })
  })
})
