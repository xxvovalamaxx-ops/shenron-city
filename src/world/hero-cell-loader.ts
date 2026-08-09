/**
 * Fetching a hero cell's authored geometry and standing it in the lot.
 *
 * The half of Stage 1 that turns a suppressed building into a replaced one.
 * Until this ran, declaring a hero cell would have left a hole — which is why
 * the registry gates suppression on {@link HeroCellRegistry.markReady} and this
 * module is the only thing that calls it.
 *
 * Order, and it is the whole design:
 *
 *   1. Load LOD0 (and LOD1, when the spec has one).
 *   2. Place it, register its collision, add it to the scene.
 *   3. Only then mark the cell ready, which is what lets suppression remove
 *      the generated building.
 *
 * A failed fetch therefore costs nothing: the authored building does not
 * appear, the generated one stays, and the failure is reported. The opposite
 * order — suppress, then load — turns a renamed export into a permanent gap in
 * Manhattan whose only symptom is a missing building.
 *
 * LOD switching lives on the `presentation` stage rather than in this module's
 * own frame callback, so it runs after the player has moved and reads the same
 * frame everything else does.
 */
import * as THREE from 'three'
import { computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'

import { manhattanCollision } from './manhattan-collision'
import {
  type BuildingLookup,
  type HeroCellPlacement,
  type HeroCellRegistry,
} from './hero-cells'

// three-mesh-bvh extends BufferGeometry only when asked, and this module needs
// the extension to give authored geometry a collider.
//
// Installed here rather than relying on ManhattanCity having been imported
// first. That dependency was invisible and real: the loader threw
// "computeBoundsTree is not a function" the moment it ran without the city
// module loaded. Assigning the same function twice is harmless.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree

/** Distance past which LOD1 is used, when a spec does not say. */
export const DEFAULT_LOD1_METRES = 320

export interface LoadedHeroCell {
  buildingId: number
  /** The group added to the scene; owns both tiers. */
  group: THREE.Group
  lod0: THREE.Object3D
  lod1: THREE.Object3D | null
  lod1FromMetres: number
  /** Lot centre, for the distance test. */
  position: THREE.Vector3
}

export interface HeroCellLoadFailure {
  buildingId: number
  url: string
  reason: string
}

/** What a GLTF loader has to offer this module. Structural, so tests can fake it. */
export interface GltfSource {
  loadAsync(url: string): Promise<{ scene: THREE.Group }>
}

/**
 * Load and place one hero cell.
 *
 * Returns null on failure rather than throwing: one missing hero asset must not
 * stop the other hero cells loading, and must not take the city down with it.
 */
export async function loadHeroCell(
  placement: HeroCellPlacement,
  loader: GltfSource,
  parent: THREE.Object3D,
  onFailure?: (failure: HeroCellLoadFailure) => void,
): Promise<LoadedHeroCell | null> {
  const { spec } = placement
  let lod0: THREE.Group
  try {
    lod0 = (await loader.loadAsync(spec.lod0)).scene
  } catch (err) {
    onFailure?.({
      buildingId: placement.buildingId,
      url: spec.lod0,
      reason: err instanceof Error ? err.message : String(err),
    })
    return null
  }

  let lod1: THREE.Group | null = null
  if (spec.lod1) {
    try {
      lod1 = (await loader.loadAsync(spec.lod1)).scene
    } catch (err) {
      // A missing far tier is not fatal. LOD0 everywhere is worse-performing
      // and correct; refusing the whole cell would be neither.
      onFailure?.({
        buildingId: placement.buildingId,
        url: spec.lod1,
        reason: `far tier failed, using near tier at all distances: ${
          err instanceof Error ? err.message : String(err)
        }`,
      })
      lod1 = null
    }
  }

  const group = new THREE.Group()
  // Named for the building it replaces, so anything walking the scene — the
  // placeholder census, a screenshot diff, a person in the inspector — can say
  // what it is and which record it came from.
  group.name = `HERO_${placement.buildingId}`
  group.position.set(placement.position.x, placement.position.y, placement.position.z)
  group.rotation.y = placement.rotationY

  lod0.name = `HERO_${placement.buildingId}_LOD0`
  group.add(lod0)
  if (lod1) {
    lod1.name = `HERO_${placement.buildingId}_LOD1`
    lod1.visible = false
    group.add(lod1)
  }

  parent.add(group)
  // World matrices must be current before collision indexes the meshes, or
  // every collider is registered at the origin.
  group.updateMatrixWorld(true)

  // The authored building answers the same collision queries the generated one
  // did. Registered after placement for the same reason.
  registerHeroCollision(group)

  return {
    buildingId: placement.buildingId,
    group,
    lod0,
    lod1,
    lod1FromMetres: spec.lod1FromMetres ?? DEFAULT_LOD1_METRES,
    position: new THREE.Vector3(
      placement.position.x,
      placement.position.y,
      placement.position.z,
    ),
  }
}

/**
 * Give the authored geometry BVHs and hand it to the collision system.
 *
 * Only LOD0. The far tier is a silhouette seen from hundreds of metres away and
 * the player cannot be standing in it; registering both would double the
 * colliders and let the coarse one win a sweep.
 */
export function registerHeroCollision(group: THREE.Group): number {
  let registered = 0
  const lod0 = group.children.find((c) => /_LOD0$/.test(c.name)) ?? group
  lod0.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (!object.geometry.boundsTree) object.geometry.computeBoundsTree()
    registered++
  })
  if (registered > 0) manhattanCollision.registerTileBuildings(group)
  return registered
}

/**
 * Choose a tier for every loaded cell, given where the camera is.
 *
 * Hysteresis on purpose: switching at exactly `lod1FromMetres` makes a player
 * standing on the boundary flip tiers every frame, which is both a visible pop
 * and a steady stream of draw-call churn. The band is 10% of the switch
 * distance.
 */
export function updateHeroLods(
  cells: Iterable<LoadedHeroCell>,
  cameraPosition: THREE.Vector3,
): { near: number; far: number } {
  let near = 0
  let far = 0
  for (const cell of cells) {
    if (!cell.lod1) {
      near++
      continue
    }
    const distance = cameraPosition.distanceTo(cell.position)
    const band = cell.lod1FromMetres * 0.1
    const showingFar = cell.lod1.visible
    const wantFar = showingFar
      ? distance > cell.lod1FromMetres - band
      : distance > cell.lod1FromMetres + band
    cell.lod0.visible = !wantFar
    cell.lod1.visible = wantFar
    if (wantFar) far++
    else near++
  }
  return { near, far }
}

/** Take a hero cell out of the scene and release what it owns. */
export function unloadHeroCell(cell: LoadedHeroCell): void {
  manhattanCollision.unregisterTileBuildings(cell.group)
  cell.group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (object.geometry.boundsTree) object.geometry.disposeBoundsTree()
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const m of materials) m.dispose()
  })
  cell.group.removeFromParent()
  cell.group.clear()
}

export interface SyncReport {
  loaded: number[]
  unloaded: number[]
  failed: HeroCellLoadFailure[]
}

/**
 * Bring the loaded set in line with the registry.
 *
 * Idempotent: calling it twice with an unchanged registry loads nothing and
 * unloads nothing, so it is safe to run whenever the registry might have
 * changed rather than only when it is known to have.
 */
export async function syncHeroCells(
  registry: HeroCellRegistry,
  city: BuildingLookup,
  loader: GltfSource,
  parent: THREE.Object3D,
  loaded: Map<number, LoadedHeroCell>,
): Promise<SyncReport> {
  const report: SyncReport = { loaded: [], unloaded: [], failed: [] }
  const wanted = registry.placements(city)
  const wantedIds = new Set(wanted.map((p) => p.buildingId))

  for (const [id, cell] of [...loaded]) {
    if (wantedIds.has(id)) continue
    unloadHeroCell(cell)
    loaded.delete(id)
    // Not ready any more, so the generated building comes back on the next
    // suppression pass. The two halves have to move together or the lot is
    // left empty.
    registry.markNotReady(id)
    report.unloaded.push(id)
  }

  for (const placement of wanted) {
    if (loaded.has(placement.buildingId)) continue
    const cell = await loadHeroCell(placement, loader, parent, (f) => report.failed.push(f))
    if (!cell) continue
    loaded.set(placement.buildingId, cell)
    registry.markReady(placement.buildingId)
    report.loaded.push(placement.buildingId)
  }

  return report
}
