/**
 * Collision for the generated city.
 *
 * 331 buildings is far too many to feed the sweep every frame — the player can
 * only ever touch the handful within a stride of them, and testing the rest is
 * pure cost across a 2 km map.
 *
 * So the lots are bucketed into a fixed grid once, and each frame only the
 * buckets around the player are read. That turns an O(buildings) scan into an
 * O(1) lookup, and it stays O(1) when the city grows.
 *
 * Pure and renderer-free, so the spatial logic is testable.
 */
import type { Lot } from '../world/city-plan'
import { aabb, type AABB, type Vec3 } from './collision'

/** Bucket size, metres. Comfortably wider than the largest building. */
export const CELL = 160

/** How far around the player to collect. One cell each way is ample at 7 m/s. */
export const NEIGHBOURHOOD = 1

const key = (cx: number, cz: number) => `${cx}:${cz}`
const cellOf = (v: number) => Math.floor(v / CELL)

export interface CityCollision {
  /** Colliders near a world position. */
  near(position: Vec3): AABB[]
  /** Bucket count, for tests and diagnostics. */
  readonly cells: number
}

/**
 * Bucket the lots once.
 *
 * A building can straddle a boundary, so it is registered in every cell its
 * footprint touches. Registering only the centre cell leaves a wall you can
 * walk through from one side and not the other, which is worse than no
 * collision at all because it looks intentional.
 */
export function buildCityCollision(lots: readonly Lot[]): CityCollision {
  const buckets = new Map<string, AABB[]>()

  for (const lot of lots) {
    // Rotation is a multiple of 90 degrees, so a quarter turn swaps the axes
    // and the footprint stays axis-aligned.
    const turned = Math.round(lot.rotation / (Math.PI / 2)) % 2 !== 0
    const w = turned ? lot.depth : lot.width
    const d = turned ? lot.width : lot.depth

    const box = aabb(lot.x, lot.height / 2, lot.z, w, lot.height, d)

    const minCx = cellOf(lot.x - w / 2)
    const maxCx = cellOf(lot.x + w / 2)
    const minCz = cellOf(lot.z - d / 2)
    const maxCz = cellOf(lot.z + d / 2)

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const k = key(cx, cz)
        const list = buckets.get(k)
        if (list) list.push(box)
        else buckets.set(k, [box])
      }
    }
  }

  return {
    cells: buckets.size,
    near(position: Vec3): AABB[] {
      const cx = cellOf(position.x)
      const cz = cellOf(position.z)
      const out: AABB[] = []
      for (let dx = -NEIGHBOURHOOD; dx <= NEIGHBOURHOOD; dx++) {
        for (let dz = -NEIGHBOURHOOD; dz <= NEIGHBOURHOOD; dz++) {
          const list = buckets.get(key(cx + dx, cz + dz))
          if (list) out.push(...list)
        }
      }
      return out
    },
  }
}
