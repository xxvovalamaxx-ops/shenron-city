/**
 * Finding solid ground near a point that has none.
 *
 * The Phase 2 source data has holes. Measured against the nine dev-teleport
 * landmarks, two of them — Times Square and the Financial District — sit over
 * a gap in `LAND_manhattan`, so a downward ray finds nothing and the player is
 * placed on a hard-coded fallback height with the ocean plane visible below
 * them. `manhattan-collision.ts` already documents the cause: no buildings,
 * props or subway kiosks were generated west of 6th Avenue, the Times Square
 * plaza included.
 *
 * Rather than hard-code better coordinates for two landmarks — which fixes
 * those two and nothing else, and rots the moment the source data changes —
 * this searches outward for real ground and reports how far it had to go. Any
 * caller that puts a player somewhere can use it: teleports, spawn resolution,
 * and eventually vehicle placement.
 *
 * Pure: the probe is injected, so the search is testable without a renderer,
 * a scene, or a loaded island.
 */

export interface GroundHit {
  x: number
  z: number
  y: number
  /** Planar distance from the requested point, metres. 0 when it was solid. */
  movedBy: number
}

export interface GroundSearchOptions {
  /** Stop looking past this radius. */
  maxRadius?: number
  /** Distance between rings. Also the angular sample spacing at radius 1. */
  step?: number
  /** Samples around the first ring; outer rings scale up to keep density. */
  spokes?: number
}

/** A downward ground probe: height at (x, z), or null over a hole. */
export type GroundProbe = (x: number, z: number) => number | null

/**
 * The nearest point to (x, z) with ground under it.
 *
 * Rings outward rather than scanning a grid: the answer is almost always
 * within a ring or two, and a ring search finds the *nearest* hit rather than
 * the first one in raster order — which matters, because being moved 40 m
 * north when 10 m east would have done is a teleport that lands you in the
 * wrong block.
 *
 * Returns null when nothing solid is within `maxRadius`. Callers must decide
 * what that means; silently returning the original point would hand back a
 * position known to be over a hole.
 */
export function nearestGround(
  probe: GroundProbe,
  x: number,
  z: number,
  options: GroundSearchOptions = {},
): GroundHit | null {
  const maxRadius = options.maxRadius ?? 400
  const step = options.step ?? 15
  const spokes = options.spokes ?? 8

  const here = probe(x, z)
  if (here !== null) return { x, z, y: here, movedBy: 0 }

  for (let radius = step; radius <= maxRadius; radius += step) {
    // Keep roughly constant arc spacing as the rings grow, so a distant ring
    // is not sampled more coarsely than a near one.
    const count = Math.max(spokes, Math.round((spokes * radius) / step))
    let best: GroundHit | null = null
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const px = x + Math.cos(angle) * radius
      const pz = z + Math.sin(angle) * radius
      const y = probe(px, pz)
      if (y === null) continue
      const movedBy = Math.hypot(px - x, pz - z)
      if (!best || movedBy < best.movedBy) best = { x: px, z: pz, y, movedBy }
    }
    // Return the best hit on the first ring that has one: every point on a
    // later ring is further away.
    if (best) return best
  }
  return null
}
