import { aabb, type AABB } from './collision'
import type { Interactable } from './interact'

export const RESIDENT_COLLIDER_WIDTH = 0.72
export const RESIDENT_COLLIDER_HEIGHT = 1.84

/**
 * Solid bodies for stationary residents whose interaction point is centered
 * near chest height. Iris is already part of static lobby geometry, while the
 * elevator panel must never become an invisible body.
 */
export function residentColliders(interactables: readonly Interactable[]): AABB[] {
  return interactables
    .filter((target) => target.kind === 'city-character' || target.kind === 'agent-office')
    .map((target) =>
      aabb(
        target.x,
        target.y - 0.53,
        target.z,
        RESIDENT_COLLIDER_WIDTH,
        RESIDENT_COLLIDER_HEIGHT,
        RESIDENT_COLLIDER_WIDTH,
      ),
    )
}
