/**
 * Owning, sharing and releasing the GPU resources a rig builds.
 *
 * Three defects in `VehicleRig.tsx` motivated this, all of them the kind that
 * never throws:
 *
 *   1. `new THREE.BoxGeometry(...)` and `new THREE.MeshStandardMaterial(...)`
 *      for the pedestrian boxes sat *inside* `useFrame`. Two objects built and
 *      discarded 60-100 times a second, whether or not a pedestrian was added.
 *
 *   2. Every pedestrian created in a given frame shared that frame's geometry
 *      and material instance, and the shrink loop disposed them per mesh. Two
 *      pedestrians added on the same frame, one removed, and the survivor is
 *      drawing from a disposed buffer. Nothing errors; the pedestrian just
 *      stops being there, on a machine you cannot reproduce it on.
 *
 *   3. Removing a vehicle called `group.removeFromParent()` and nothing else.
 *      `buildVehicleRig` allocates roughly eight geometries and six materials
 *      per car. Every despawn leaked all of them, for the whole session.
 *
 * The rule this module encodes: a resource is either *shared* — created once,
 * outliving every user, never disposed by a user — or *owned* by exactly one
 * object tree, and disposed with it. Marking is explicit, on `userData`,
 * because "is anyone else still using this?" cannot be answered by looking at
 * a material.
 */
import * as THREE from 'three'

/** Marker for a resource that outlives the object using it. */
export const SHARED = 'rigShared'

type Disposable = { dispose(): void; userData?: Record<string, unknown> }

/** Mark a geometry or material as shared, and return it. */
export function markShared<T extends Disposable>(resource: T): T {
  resource.userData = resource.userData ?? {}
  resource.userData[SHARED] = true
  return resource
}

export function isShared(resource: Disposable | null | undefined): boolean {
  return !!resource?.userData?.[SHARED]
}

export interface DisposalReport {
  geometries: number
  materials: number
  /** Resources skipped because they are shared. */
  skipped: number
}

/**
 * Dispose everything an object tree owns, and nothing it merely borrows.
 *
 * Deliberately does not remove the root from its parent — callers differ on
 * whether they want that, and a dispose that silently reparents is a dispose
 * that surprises someone.
 *
 * Each resource is disposed at most once even when several meshes reference
 * it, which matters for the wheels: four wheels built from one call would
 * otherwise be disposed four times. Three tolerates that today; relying on a
 * library tolerating a mistake is not the same as not making it.
 */
export function disposeOwned(root: THREE.Object3D): DisposalReport {
  const report: DisposalReport = { geometries: 0, materials: 0, skipped: 0 }
  const seen = new Set<Disposable>()

  const release = (resource: Disposable | null | undefined, kind: 'geometries' | 'materials') => {
    if (!resource) return
    if (isShared(resource)) {
      report.skipped++
      return
    }
    if (seen.has(resource)) return
    seen.add(resource)
    resource.dispose()
    report[kind]++
  }

  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    release(mesh.geometry as unknown as Disposable, 'geometries')
    const material = mesh.material
    if (Array.isArray(material)) {
      for (const m of material) release(m as unknown as Disposable, 'materials')
    } else {
      release(material as unknown as Disposable, 'materials')
    }
  })

  return report
}

// ── The pedestrian box, built once ───────────────────────────────────────────

let pedResources: PedestrianResources | null = null
/** True once authored geometry has replaced the fallback box. */
let pedAuthored = false

/** Where the authored figure tiers live. Exported from Blender. */
export const PEDESTRIAN_LOD0 = '/models/characters/pedestrian_lod0.glb'
export const PEDESTRIAN_LOD1 = '/models/characters/pedestrian_lod1.glb'

/**
 * LOD1 starts when a 1.75 m crosser is roughly 40 pixels high at the default
 * 72-degree camera FOV: detailed at conversation distance, inexpensive across
 * the middle and far street.
 */
export const PEDESTRIAN_LODS = [
  { url: PEDESTRIAN_LOD0, distance: 0 },
  { url: PEDESTRIAN_LOD1, distance: 32 },
] as const

export interface PedestrianLodResource {
  distance: number
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
}

/** The near pair remains available for the fallback and legacy callers. */
export interface PedestrianResources {
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  levels: readonly PedestrianLodResource[]
}

/** Minimal part of GLTFLoader used by the pedestrian resource loader. */
export interface PedestrianGltfSource {
  loadAsync(url: string): Promise<{ scene: THREE.Group }>
}

function makePedestrianResources(levels: readonly PedestrianLodResource[]): PedestrianResources {
  const near = levels[0]
  if (!near) throw new Error('pedestrian resources require a near LOD')
  return { geometry: near.geometry, material: near.material, levels }
}

/**
 * The shared geometry/material tier set every pedestrian uses.
 *
 * Lazy rather than eager so importing this module in a test does not build
 * THREE objects nobody asked for, and shared rather than per-mesh because
 * every crosser is the same figure.
 *
 * Starts as one box tier and is replaced by the full authored set once both
 * GLBs arrive. The box is a real fallback, not a leftover: the fetch is async
 * and crossers exist from the first frame, so the alternative is invisible
 * pedestrians. It is also the honest failure mode — if the asset never loads,
 * the box stays and placeholdercheck fails, which is what should happen.
 */
export function pedestrianResources(): PedestrianResources {
  if (!pedResources) {
    const geometry = markShared(new THREE.BoxGeometry(0.42, 1.7, 0.26))
    const material = markShared(
      new THREE.MeshStandardMaterial({ color: '#4a5a6a', roughness: 0.8 }),
    )
    pedResources = makePedestrianResources([{ distance: 0, geometry, material }])
  }
  return pedResources
}

/** Whether pedestrians are wearing the authored figure yet. */
export function pedestrianIsAuthored(): boolean {
  return pedAuthored
}

/**
 * Build one runtime-managed pedestrian LOD. This runs only for a new crosser or
 * after the authored resource swap, never in the per-frame presentation loop.
 * Three updates the LOD from the active camera during rendering.
 */
export function buildPedestrianLod(): THREE.LOD {
  const lod = new THREE.LOD()
  lod.name = 'PED'
  for (const [index, level] of pedestrianResources().levels.entries()) {
    const mesh = new THREE.Mesh(level.geometry, level.material)
    mesh.name = `PED_LOD${index}`
    mesh.castShadow = true
    lod.addLevel(mesh, level.distance)
  }
  return lod
}

function levelFromScene(
  scene: THREE.Group,
  tier: (typeof PEDESTRIAN_LODS)[number],
): PedestrianLodResource {
  const meshes: THREE.Mesh[] = []
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object)
  })
  if (meshes.length !== 1) {
    throw new Error(`${tier.url}: expected exactly one pedestrian mesh, found ${meshes.length}`)
  }

  const mesh = meshes[0]
  if (!(mesh.geometry instanceof THREE.BufferGeometry)) {
    throw new Error(`${tier.url}: pedestrian mesh has no BufferGeometry`)
  }
  if (Array.isArray(mesh.material) || !(mesh.material instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`${tier.url}: pedestrian mesh requires one MeshStandardMaterial`)
  }

  return {
    distance: tier.distance,
    geometry: mesh.geometry,
    material: mesh.material,
  }
}

/**
 * Fetch and validate both authored tiers before changing anything visible. A
 * partial load leaves the box fallback intact instead of keeping a public LOD
 * file dormant at runtime.
 */
export async function loadAuthoredPedestrianResources(
  loader: PedestrianGltfSource,
): Promise<PedestrianResources> {
  const settled = await Promise.allSettled(
    PEDESTRIAN_LODS.map(({ url }) => loader.loadAsync(url)),
  )
  const loaded = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  )
  const failed = settled.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') {
    // Promise.all would abandon an already-loaded sibling when the other tier
    // rejects. Dispose every fulfilled scene before surfacing the fetch error.
    for (const { scene } of loaded) disposeOwned(scene)
    throw failed.reason
  }

  try {
    const levels = loaded.map(({ scene }, index) =>
      levelFromScene(scene, PEDESTRIAN_LODS[index]),
    )
    // Mark only after every tier validates. Marking an early tier first would
    // make generic error cleanup skip it as shared if a later tier is invalid.
    for (const level of levels) {
      markShared(level.geometry)
      markShared(level.material)
    }
    return makePedestrianResources(levels)
  } catch (error) {
    for (const { scene } of loaded) disposeOwned(scene)
    throw error
  }
}

/** Dispose one resource set exactly once, even if two tiers share a material. */
export function disposePedestrianResourceSet(resources: PedestrianResources): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.MeshStandardMaterial>()
  for (const level of resources.levels) {
    geometries.add(level.geometry)
    materials.add(level.material)
  }
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

/**
 * Swap the shared fallback tier set for the authored tier set.
 *
 * Returns the meshes that need re-pointing: every pedestrian already in the
 * scene holds the old resources by reference, so replacing the module-level
 * variable alone would leave every existing crosser a box forever and only new
 * ones would improve. The caller owns those LODs and does the re-point.
 *
 * The old resources are disposed only after the caller has re-pointed, which
 * is why this returns rather than disposing here.
 */
export function adoptAuthoredPedestrianResources(
  next: PedestrianResources,
): PedestrianResources {
  const previous = pedestrianResources()
  pedResources = next
  pedAuthored = true
  return previous
}

/**
 * Release the shared pedestrian resources.
 *
 * For a full teardown only — after this, any surviving pedestrian mesh is
 * drawing from a disposed buffer, which is the bug this module exists to
 * prevent. Callers must have removed every pedestrian first.
 */
export function disposePedestrianResources(): void {
  if (pedResources) disposePedestrianResourceSet(pedResources)
  pedResources = null
  pedAuthored = false
}
