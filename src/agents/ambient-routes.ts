import type { RoutePoint } from '../world/city-data'
import { AMBIENT_ROUTES } from '../world/city-data'
import { aabb, type AABB } from '../gameplay/collision'

export interface RouteSample extends RoutePoint {
  heading: number
}

export interface PedestrianGait {
  bob: number
  stride: number
  sway: number
}

/**
 * Deterministic walk-cycle values shared by the articulated crowd renderer.
 * Keeping this pure makes the opposing limb phase and stride limits testable.
 */
export function pedestrianGait(index: number, elapsed: number): PedestrianGait {
  const phase = elapsed * (6.2 + (index % 4) * 0.22) + index * 1.73
  return {
    bob: Math.abs(Math.sin(phase)) * 0.025,
    stride: Math.sin(phase) * 0.48,
    sway: Math.sin(phase * 0.5) * 0.035,
  }
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

/** Exact deterministic pose consumed by both rendering and collision. */
export function ambientPedestrianPose(index: number, elapsed: number): RouteSample {
  const route = AMBIENT_ROUTES[index % AMBIENT_ROUTES.length]
  const speed = 0.82 + (index % 5) * 0.11
  const phase = index * 19.7
  return sampleLoop(route.points, elapsed * speed + phase)
}

/** Full articulated pedestrian bounds. */
export const NPC_HALF_W = 0.28
export const NPC_HALF_H = 0.92

/**
 * Generate collision boxes for all ambient NPCs at a given elapsed time.
 * Must match the speed/phase logic in AmbientCrowd exactly.
 */
export function npcColliders(elapsed: number, count: number): AABB[] {
  const boxes: AABB[] = []
  for (let i = 0; i < count; i++) {
    const sample = ambientPedestrianPose(i, elapsed)
    boxes.push(aabb(sample.x, NPC_HALF_H, sample.z, NPC_HALF_W * 2, NPC_HALF_H * 2, NPC_HALF_W * 2))
  }
  return boxes
}
