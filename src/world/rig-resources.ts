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

let pedGeometry: THREE.BoxGeometry | null = null
let pedMaterial: THREE.MeshStandardMaterial | null = null

/**
 * The one geometry and material every pedestrian box uses.
 *
 * Lazy rather than eager so importing this module in a test does not build
 * THREE objects nobody asked for, and shared rather than per-mesh because
 * there is precisely one kind of pedestrian box.
 */
export function pedestrianResources(): {
  geometry: THREE.BoxGeometry
  material: THREE.MeshStandardMaterial
} {
  if (!pedGeometry) {
    pedGeometry = markShared(new THREE.BoxGeometry(0.42, 1.7, 0.26))
  }
  if (!pedMaterial) {
    pedMaterial = markShared(
      new THREE.MeshStandardMaterial({ color: '#4a5a6a', roughness: 0.8 }),
    )
  }
  return { geometry: pedGeometry, material: pedMaterial }
}

/**
 * Release the shared pedestrian resources.
 *
 * For a full teardown only — after this, any surviving pedestrian mesh is
 * drawing from a disposed buffer, which is the bug this module exists to
 * prevent. Callers must have removed every pedestrian first.
 */
export function disposePedestrianResources(): void {
  pedGeometry?.dispose()
  pedMaterial?.dispose()
  pedGeometry = null
  pedMaterial = null
}
