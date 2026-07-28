/**
 * Renderer-free minimap projection.
 *
 * North is -Z, matching the player's initial forward direction and keeping the
 * headquarters at the top of the map. DOM, Three.js, and CSS stay outside this
 * module so coordinate and heading conventions are unit tested.
 */

export interface MinimapPoint {
  x: number
  z: number
}

export interface MinimapBox extends MinimapPoint {
  width: number
  depth: number
}

export interface MinimapPlacement {
  left: number
  top: number
  clamped: boolean
}

export interface MinimapRect {
  left: number
  top: number
  width: number
  height: number
}

export const MINIMAP_BOUNDS = {
  minX: -52,
  maxX: 52,
  minZ: -40,
  maxZ: 155,
} as const

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function minimapPoint(point: MinimapPoint): MinimapPlacement {
  const x = (point.x - MINIMAP_BOUNDS.minX) / (MINIMAP_BOUNDS.maxX - MINIMAP_BOUNDS.minX)
  const z = (point.z - MINIMAP_BOUNDS.minZ) / (MINIMAP_BOUNDS.maxZ - MINIMAP_BOUNDS.minZ)
  return {
    left: clamp01(x) * 100,
    top: clamp01(z) * 100,
    clamped: x < 0 || x > 1 || z < 0 || z > 1,
  }
}

export function minimapRect(box: MinimapBox): MinimapRect {
  const northWest = minimapPoint({
    x: box.x - box.width / 2,
    z: box.z - box.depth / 2,
  })
  const southEast = minimapPoint({
    x: box.x + box.width / 2,
    z: box.z + box.depth / 2,
  })
  return {
    left: northWest.left,
    top: northWest.top,
    width: Math.max(0, southEast.left - northWest.left),
    height: Math.max(0, southEast.top - northWest.top),
  }
}

/** CSS clockwise degrees for an arrow whose unrotated direction is up/north. */
export function minimapHeading(forward: MinimapPoint): number {
  if (Math.hypot(forward.x, forward.z) < 1e-6) return 0
  return Math.atan2(forward.x, -forward.z) * (180 / Math.PI)
}
