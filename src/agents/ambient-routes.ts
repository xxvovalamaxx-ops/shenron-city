import type { RoutePoint } from '../world/city-data'
import { AMBIENT_ROUTES } from '../world/city-data'
import { aabb, type AABB } from '../gameplay/collision'

export interface RouteSample extends RoutePoint {
  heading: number
}

function segmentLength(a: RoutePoint, b: RoutePoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z)
}

/** Total length of a route, including its closing segment. */
export function loopLength(points: readonly RoutePoint[]): number {
  if (points.length < 2) return 0

  let total = 0
  for (let i = 0; i < points.length; i++) {
    total += segmentLength(points[i], points[(i + 1) % points.length])
  }
  return total
}

/**
 * Sample a constant-speed position and heading around a closed polyline.
 * Distance wraps in both directions so pedestrian phases stay deterministic.
 */
export function sampleLoop(points: readonly RoutePoint[], distance: number): RouteSample {
  if (points.length === 0) return { x: 0, z: 0, heading: 0 }
  if (points.length === 1) return { ...points[0], heading: 0 }

  const total = loopLength(points)
  if (total <= 0) return { ...points[0], heading: 0 }

  let remaining = ((distance % total) + total) % total
  for (let i = 0; i < points.length; i++) {
    const from = points[i]
    const to = points[(i + 1) % points.length]
    const length = segmentLength(from, to)
    if (length === 0) continue
    if (remaining <= length) {
      const t = remaining / length
      return {
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
        heading: Math.atan2(to.x - from.x, to.z - from.z),
      }
    }
    remaining -= length
  }

  return { ...points[0], heading: 0 }
}

/** NPC body half-extents matching AmbientCrowd's capsule scale (0.26 x 0.38). */
const NPC_HALF_W = 0.26
const NPC_HALF_H = 0.38

/**
 * Generate collision boxes for all ambient NPCs at a given elapsed time.
 * Must match the speed/phase logic in AmbientCrowd exactly.
 */
export function npcColliders(elapsed: number): AABB[] {
  const boxes: AABB[] = []
  for (let i = 0; i < AMBIENT_ROUTES.length; i++) {
    const route = AMBIENT_ROUTES[i]
    const speed = 0.82 + (i % 5) * 0.11
    const phase = i * 19.7
    const sample = sampleLoop(route.points, elapsed * speed + phase)
    boxes.push(aabb(sample.x, NPC_HALF_H, sample.z, NPC_HALF_W * 2, NPC_HALF_H * 2, NPC_HALF_W * 2))
  }
  return boxes
}
