/**
 * The island's shape for the map: land, parks, lakes and piers, as flat
 * triangles in world (x, z).
 *
 * Read straight off the base GLB the streamer already holds (LAND_*,
 * PARK_ground, PARK_water, PIER_decks), so the radar's coastline is the one the
 * player walks on and costs no extra download. The meshes are small — about
 * 75k triangles for the whole harbour — and this runs once.
 */
import * as THREE from 'three'
import { cityWorld } from '../../city/registry.js'
import { INDEX_CELL, cellKey } from './street-data'

export type LandLayer = 'land' | 'pier' | 'park' | 'water'

export interface LandTriangles {
  layer: LandLayer
  /** Interleaved x0, z0, x1, z1, x2, z2 per triangle. */
  tris: Float32Array
  /** Triangle indices per INDEX_CELL cell. */
  cells: Map<string, number[]>
}

function layerFor(name: string): LandLayer | null {
  const n = name.toUpperCase()
  if (n.startsWith('LAND_')) return 'land'
  if (n.startsWith('PIER_')) return 'pier'
  if (n === 'PARK_GROUND') return 'park'
  if (n === 'PARK_WATER') return 'water'
  return null
}

/** Draw order: later layers paint over earlier ones. */
export const LAND_LAYER_ORDER: readonly LandLayer[] = ['land', 'pier', 'park', 'water']

let cached: LandTriangles[] | null = null

/** The base's land layers, or null until the base tile has streamed in. */
export function landTriangles(): LandTriangles[] | null {
  if (cached) return cached
  const streamer = cityWorld.streamer
  if (!streamer) return null
  let base: THREE.Group | null = null
  for (const tile of streamer.tiles.values()) {
    if (tile.always && tile.state === 'ready' && tile.group) {
      base = tile.group
      break
    }
  }
  if (!base) return null

  const buckets = new Map<LandLayer, number[]>()
  const v = new THREE.Vector3()
  base.updateMatrixWorld(true)
  base.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const layer = layerFor(object.name)
    if (!layer) return
    const geometry = object.geometry as THREE.BufferGeometry
    const position = geometry.getAttribute('position')
    if (!position) return
    const index = geometry.getIndex()
    const count = index ? index.count : position.count
    let out = buckets.get(layer)
    if (!out) {
      out = []
      buckets.set(layer, out)
    }
    for (let i = 0; i + 2 < count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(i + k) : i + k
        v.fromBufferAttribute(position, vi).applyMatrix4(object.matrixWorld)
        out.push(v.x, v.z)
      }
    }
  })

  const result: LandTriangles[] = []
  for (const layer of LAND_LAYER_ORDER) {
    const flat = buckets.get(layer)
    if (!flat || flat.length === 0) continue
    const tris = new Float32Array(flat)
    const cells = new Map<string, number[]>()
    for (let t = 0; t < tris.length / 6; t++) {
      const o = t * 6
      const x0 = Math.min(tris[o], tris[o + 2], tris[o + 4])
      const x1 = Math.max(tris[o], tris[o + 2], tris[o + 4])
      const z0 = Math.min(tris[o + 1], tris[o + 3], tris[o + 5])
      const z1 = Math.max(tris[o + 1], tris[o + 3], tris[o + 5])
      // Degenerate slivers (the vertical sea walls seen from above) add nothing.
      if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3) continue
      for (let cx = Math.floor(x0 / INDEX_CELL); cx <= Math.floor(x1 / INDEX_CELL); cx++) {
        for (let cz = Math.floor(z0 / INDEX_CELL); cz <= Math.floor(z1 / INDEX_CELL); cz++) {
          const key = cellKey(cx, cz)
          let list = cells.get(key)
          if (!list) {
            list = []
            cells.set(key, list)
          }
          list.push(t)
        }
      }
    }
    result.push({ layer, tris, cells })
  }
  cached = result
  return result
}
