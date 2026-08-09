import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  adoptAuthoredPedestrianResources,
  buildPedestrianLod,
  disposeOwned,
  disposePedestrianResourceSet,
  disposePedestrianResources,
  isShared,
  loadAuthoredPedestrianResources,
  markShared,
  PEDESTRIAN_LODS,
  pedestrianResources,
} from './rig-resources'

/** A mesh whose geometry and material count their own disposals. */
function countingMesh(geometry?: THREE.BufferGeometry, material?: THREE.Material) {
  const g = geometry ?? new THREE.BoxGeometry(1, 1, 1)
  const m = material ?? new THREE.MeshStandardMaterial()
  const counts = { geometry: 0, material: 0 }
  const gDispose = g.dispose.bind(g)
  const mDispose = m.dispose.bind(m)
  g.dispose = () => {
    counts.geometry++
    gDispose()
  }
  m.dispose = () => {
    counts.material++
    mDispose()
  }
  return { mesh: new THREE.Mesh(g, m), counts, geometry: g, material: m }
}

afterEach(() => {
  disposePedestrianResources()
})

/** A minimal authored tier with the same one-mesh contract as the shipped GLBs. */
function pedestrianTier(): THREE.Group {
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.75, 0.24), new THREE.MeshStandardMaterial()))
  return root
}

describe('disposeOwned', () => {
  it('disposes every geometry and material a tree owns', () => {
    // The vehicle-despawn leak: removeFromParent() and nothing else, for a
    // rig of roughly eight geometries and six materials per car.
    const root = new THREE.Group()
    const a = countingMesh()
    const b = countingMesh()
    root.add(a.mesh, b.mesh)

    const report = disposeOwned(root)
    expect(a.counts.geometry).toBe(1)
    expect(a.counts.material).toBe(1)
    expect(b.counts.geometry).toBe(1)
    expect(report).toEqual({ geometries: 2, materials: 2, skipped: 0 })
  })

  it('descends the whole tree, not just direct children', () => {
    const root = new THREE.Group()
    const pivot = new THREE.Group()
    const wheel = countingMesh()
    pivot.add(wheel.mesh)
    root.add(pivot)

    disposeOwned(root)
    expect(wheel.counts.geometry).toBe(1)
  })

  it('never disposes a shared resource, however many meshes use it', () => {
    // Defect 2, directly. Two pedestrians on one shared geometry: disposing
    // per mesh kills the survivor's buffer with no error anywhere.
    const shared = markShared(new THREE.BoxGeometry(1, 1, 1))
    const material = markShared(new THREE.MeshStandardMaterial())
    let disposed = 0
    const original = shared.dispose.bind(shared)
    shared.dispose = () => {
      disposed++
      original()
    }

    const root = new THREE.Group()
    root.add(new THREE.Mesh(shared, material), new THREE.Mesh(shared, material))

    const report = disposeOwned(root)
    expect(disposed).toBe(0)
    expect(report.geometries).toBe(0)
    expect(report.materials).toBe(0)
    expect(report.skipped).toBe(4)
  })

  it('disposes a resource shared within one tree exactly once', () => {
    // Four wheels from one makeWheel call share a geometry. Disposing it four
    // times is tolerated by Three today; not doing it is the actual contract.
    const geometry = new THREE.CylinderGeometry(0.3, 0.3, 0.26, 8)
    let disposed = 0
    const original = geometry.dispose.bind(geometry)
    geometry.dispose = () => {
      disposed++
      original()
    }
    const material = new THREE.MeshStandardMaterial()
    const root = new THREE.Group()
    for (let i = 0; i < 4; i++) root.add(new THREE.Mesh(geometry, material))

    const report = disposeOwned(root)
    expect(disposed).toBe(1)
    expect(report.geometries).toBe(1)
    expect(report.materials).toBe(1)
  })

  it('handles a mesh with an array of materials', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const a = new THREE.MeshStandardMaterial()
    const b = new THREE.MeshStandardMaterial()
    const root = new THREE.Group()
    root.add(new THREE.Mesh(geometry, [a, b]))
    expect(disposeOwned(root).materials).toBe(2)
  })

  it('leaves the root attached — a dispose that reparents surprises someone', () => {
    const parent = new THREE.Group()
    const root = new THREE.Group()
    root.add(countingMesh().mesh)
    parent.add(root)
    disposeOwned(root)
    expect(root.parent).toBe(parent)
  })

  it('is safe on a tree with no meshes', () => {
    expect(disposeOwned(new THREE.Group())).toEqual({
      geometries: 0,
      materials: 0,
      skipped: 0,
    })
  })
})

describe('pedestrianResources', () => {
  it('returns the same instances every call — not two per frame', () => {
    // Defect 1: these were constructed inside useFrame, 60-100 times a second,
    // whether or not a pedestrian was added.
    const first = pedestrianResources()
    const second = pedestrianResources()
    expect(second.geometry).toBe(first.geometry)
    expect(second.material).toBe(first.material)
  })

  it('marks them shared, so disposeOwned will not touch them', () => {
    const { geometry, material } = pedestrianResources()
    expect(isShared(geometry)).toBe(true)
    expect(isShared(material)).toBe(true)

    const root = new THREE.Group()
    root.add(new THREE.Mesh(geometry, material))
    const report = disposeOwned(root)
    expect(report.geometries).toBe(0)
    expect(report.skipped).toBe(2)
  })

  it('rebuilds after a teardown rather than handing back a disposed buffer', () => {
    const before = pedestrianResources().geometry
    disposePedestrianResources()
    const after = pedestrianResources().geometry
    expect(after).not.toBe(before)
    expect(isShared(after)).toBe(true)
  })

  it('loads both shipped URLs into a distance-driven runtime LOD', async () => {
    const requested: string[] = []
    const resources = await loadAuthoredPedestrianResources({
      async loadAsync(url) {
        requested.push(url)
        return { scene: pedestrianTier() }
      },
    })

    expect(requested).toEqual(PEDESTRIAN_LODS.map((tier) => tier.url))
    expect(resources.levels.map((level) => level.distance)).toEqual(
      PEDESTRIAN_LODS.map((tier) => tier.distance),
    )

    const fallback = adoptAuthoredPedestrianResources(resources)
    const lod = buildPedestrianLod()
    expect(lod).toBeInstanceOf(THREE.LOD)
    expect(lod.levels.map((level) => level.distance)).toEqual(
      PEDESTRIAN_LODS.map((tier) => tier.distance),
    )
    expect(lod.getObjectForDistance(31.99)?.name).toBe('PED_LOD0')
    expect(lod.getObjectForDistance(32)?.name).toBe('PED_LOD1')

    // Existing crossers can be re-pointed before the fallback leaves GPU memory.
    disposePedestrianResourceSet(fallback)
  })

  it('rejects a tier that cannot safely be represented as one shared LOD mesh', async () => {
    const validTier = pedestrianTier()
    const validMesh = validTier.children[0] as THREE.Mesh
    let released = 0
    validMesh.geometry.addEventListener('dispose', () => {
      released++
    })
    const invalidTier = pedestrianTier()
    const invalidExtra = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())
    let invalidReleased = 0
    ;(invalidTier.children[0] as THREE.Mesh).geometry.addEventListener('dispose', () => {
      invalidReleased++
    })
    invalidExtra.geometry.addEventListener('dispose', () => {
      invalidReleased++
    })
    invalidTier.add(invalidExtra)

    await expect(loadAuthoredPedestrianResources({
      async loadAsync(url) {
        return { scene: url === PEDESTRIAN_LODS[1].url ? invalidTier : validTier }
      },
    })).rejects.toThrow(/expected exactly one pedestrian mesh/)
    expect(released).toBe(1)
    expect(invalidReleased).toBe(2)
  })

  it('disposes a fulfilled tier when its sibling request rejects', async () => {
    const loaded = pedestrianTier()
    const mesh = loaded.children[0] as THREE.Mesh
    let geometryDisposals = 0
    let materialDisposals = 0
    mesh.geometry.addEventListener('dispose', () => {
      geometryDisposals++
    })
    ;(mesh.material as THREE.Material).addEventListener('dispose', () => {
      materialDisposals++
    })

    await expect(loadAuthoredPedestrianResources({
      async loadAsync(url) {
        if (url === PEDESTRIAN_LODS[0].url) return { scene: loaded }
        throw new Error('far pedestrian tier unavailable')
      },
    })).rejects.toThrow(/far pedestrian tier unavailable/)

    expect(geometryDisposals).toBe(1)
    expect(materialDisposals).toBe(1)
  })
})

describe('leak accounting across repeated spawn and despawn', () => {
  /** A stand-in for buildVehicleRig: per-vehicle geometries and materials. */
  function buildRig() {
    const group = new THREE.Group()
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.8, 4.4),
      new THREE.MeshStandardMaterial(),
    )
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.7, 2.0),
      new THREE.MeshStandardMaterial(),
    )
    group.add(body, cabin)
    // Four wheels off one geometry and one material, as makeWheel does.
    const wheelGeometry = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 14)
    const wheelMaterial = new THREE.MeshStandardMaterial()
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group()
      pivot.add(new THREE.Mesh(wheelGeometry, wheelMaterial))
      group.add(pivot)
    }
    return group
  }

  it('a hundred spawn/despawn cycles release everything they allocated', () => {
    // The leak test the brief asks for. Counting disposals rather than heap
    // because a heap number in a Node test measures the garbage collector's
    // mood, not this code.
    let geometries = 0
    let materials = 0
    for (let i = 0; i < 100; i++) {
      const rig = buildRig()
      const report = disposeOwned(rig)
      geometries += report.geometries
      materials += report.materials
    }
    // Per rig: body, cabin and one wheel geometry = 3; body, cabin and one
    // wheel material = 3.
    expect(geometries).toBe(300)
    expect(materials).toBe(300)
  })

  it('repeated entry and exit of the same vehicle id does not double-dispose', () => {
    // Enter, exit, enter again: the rig is rebuilt each time, and the second
    // teardown must not touch resources the first one already released.
    const entries = new Map<number, THREE.Group>()
    const spawn = (id: number) => entries.set(id, buildRig())
    const despawn = (id: number) => {
      const rig = entries.get(id)
      if (!rig) return { geometries: 0, materials: 0, skipped: 0 }
      entries.delete(id)
      return disposeOwned(rig)
    }

    spawn(1)
    expect(despawn(1).geometries).toBe(3)
    // Second despawn of an id already gone must be a no-op, not a throw.
    expect(despawn(1).geometries).toBe(0)
    spawn(1)
    expect(despawn(1).geometries).toBe(3)
    expect(entries.size).toBe(0)
  })

  it('pedestrian meshes shrink without harming the ones that remain', () => {
    // Grow to three, shrink to one, and the survivor must still hold a live
    // geometry. This is the exact sequence that broke: same-frame creation
    // shared an instance, and the shrink disposed it.
    const { geometry, material } = pedestrianResources()
    const root = new THREE.Group()
    const meshes: THREE.Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(geometry, material)
      root.add(mesh)
      meshes.push(mesh)
    }
    while (meshes.length > 1) {
      const mesh = meshes.pop()!
      mesh.removeFromParent()
      // Shared: removal never disposes.
      expect(isShared(mesh.geometry)).toBe(true)
    }
    const survivor = meshes[0]
    expect(survivor.geometry).toBe(geometry)
    expect((survivor.geometry as THREE.BufferGeometry).attributes.position).toBeDefined()
  })
})
