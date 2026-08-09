/**
 * Applying hero cells to the streamed city, and lifting them again.
 *
 * The THREE-facing half of {@link ./hero-cells}. That module is the arithmetic
 * — which tile, which triangles, what the original index was — and this one
 * owns the buffers.
 *
 * Called from `CityPipeline._onTileReady` *before* collision registration, so
 * the BVH is built from the suppressed index. Doing it afterwards would leave
 * the player walking into a building that is no longer drawn, which is a worse
 * bug than a visible one: nothing on screen explains it.
 */
import * as THREE from 'three'

import {
  HeroCellRegistry,
  meshBelongsToTile,
  parseTileFromMeshName,
  rememberIndex,
  restoreIndex,
  suppressBuildings,
  type BuildingLookup,
} from './hero-cells'

export interface ApplyReport {
  /** Meshes examined — anything named like a streamed building mesh. */
  meshes: number
  /** Meshes whose index was rewritten. */
  changed: number
  /** Triangles removed across the tile. */
  removed: number
  /** Building ids that actually matched geometry. */
  hit: number[]
  /**
   * Ids the registry wanted suppressed in this tile that matched nothing.
   *
   * The difference between "the override applied" and "the override was
   * configured". A hero cell whose id is wrong by one is invisible otherwise:
   * the authored building appears, the generated one stays standing inside it,
   * and nothing anywhere reports a problem.
   */
  missed: number[]
}

function emptyReport(): ApplyReport {
  return { meshes: 0, changed: 0, removed: 0, hit: [], missed: [] }
}

/** The `_bid` attribute under either spelling the exporter uses. */
function bidAttribute(geometry: THREE.BufferGeometry): THREE.BufferAttribute | null {
  const attr =
    (geometry.attributes._bid as THREE.BufferAttribute | undefined) ??
    (geometry.attributes._BID as THREE.BufferAttribute | undefined)
  return attr ?? null
}

/**
 * Hide the generated version of every overridden building in this tile.
 *
 * Walks the tile root rather than taking a mesh: a building's geometry is split
 * across several meshes of its own tile — measured, 34877 sits in both
 * `BLD_lowrise_-01_-01_1` and `_2` — so stopping at the first match would leave
 * part of it standing.
 */
export function applyHeroCells(
  root: THREE.Object3D,
  registry: HeroCellRegistry,
  city: BuildingLookup,
): ApplyReport {
  const report = emptyReport()
  if (registry.size === 0) return report

  // Which ids belong to which tile, computed once rather than per mesh.
  const wantedByTile = new Map<string, Set<number>>()
  const tileOf = (tx: number, ty: number) => `${tx}|${ty}`
  for (const placement of registry.placements(city)) {
    const key = tileOf(placement.tile.tx, placement.tile.ty)
    let set = wantedByTile.get(key)
    if (!set) {
      set = new Set<number>()
      wantedByTile.set(key, set)
    }
    set.add(placement.buildingId)
  }
  if (wantedByTile.size === 0) return report

  const hit = new Set<number>()
  const wantedHere = new Set<number>()

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const tile = parseTileFromMeshName(object.name)
    if (!tile) return
    report.meshes++

    const wanted = wantedByTile.get(tileOf(tile.tx, tile.ty))
    if (!wanted || wanted.size === 0) return
    // Belt and braces: the tile came from this mesh's own name, so this cannot
    // currently disagree — but the confinement rule is the one property of this
    // system that must not quietly stop holding.
    if (!meshBelongsToTile(object.name, tile)) return
    for (const id of wanted) wantedHere.add(id)

    const geometry = object.geometry as THREE.BufferGeometry
    const bid = bidAttribute(geometry)
    if (!bid) return

    const index = geometry.index
    rememberIndex(geometry, index ? (index.array as ArrayLike<number>) : null)

    const result = suppressBuildings(
      index ? (index.array as ArrayLike<number>) : null,
      bid.array as ArrayLike<number>,
      wanted,
      bid.count,
    )
    if (result.removed === 0) return

    geometry.setIndex(new THREE.BufferAttribute(result.index, 1))
    // The BVH was built from the old index, so it still contains the triangles
    // that are no longer drawn. Dropping it here means collision is rebuilt
    // from what is actually rendered.
    if (geometry.boundsTree) geometry.disposeBoundsTree()
    geometry.computeBoundingSphere()
    report.changed++
    report.removed += result.removed
    for (const id of result.hit) hit.add(id)
  })

  report.hit = [...hit].sort((a, b) => a - b)
  report.missed = [...wantedHere].filter((id) => !hit.has(id)).sort((a, b) => a - b)
  return report
}

/**
 * Put back everything {@link applyHeroCells} took out of this tile.
 *
 * "Removal restores the original", from the stage brief. The original index was
 * kept on the geometry's own userData, so this restores exactly the triangles
 * that were there — not an approximation rebuilt from the registry, which would
 * be a second implementation of the same rule and could disagree with the first.
 */
export function liftHeroCells(root: THREE.Object3D): { restored: number } {
  let restored = 0
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const geometry = object.geometry as THREE.BufferGeometry
    const original = restoreIndex(geometry)
    if (original === undefined) return
    geometry.setIndex(original ? new THREE.BufferAttribute(original, 1) : null)
    if (geometry.boundsTree) geometry.disposeBoundsTree()
    geometry.computeBoundingSphere()
    restored++
  })
  return { restored }
}
