import { aabb, type AABB } from '../gameplay/collision'
import { BREAKABLES, type BreakableDef } from './BreakableRegistry'

/** Solid bounds for destructible props that still exist this frame. */
export function breakableColliders(
  destroyed: ReadonlySet<string>,
  definitions: readonly BreakableDef[] = BREAKABLES,
): AABB[] {
  return definitions
    .filter((definition) => !destroyed.has(definition.id))
    .map((definition) =>
      aabb(
        definition.pos.x,
        definition.pos.y,
        definition.pos.z,
        definition.size[0],
        definition.size[1],
        definition.size[2],
      ),
    )
}
