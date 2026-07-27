/**
 * Landing guards.
 *
 * Every floor's shaft opening is solid unless the car is actually sitting at
 * that floor with its doors open. Without this the player walks into the
 * opening on floor 45 while the car is in the lobby and falls 180 metres —
 * the single most obvious way this world could betray them.
 *
 * Real buildings solve it with interlocked landing doors. This is the same
 * idea expressed as collision.
 */
import { aabb, type AABB } from './collision'
import { FLOORS, type FloorId } from './elevator'
import { SHAFT } from '../world/layout'

/** How close the car must be to a floor to count as "at" it. */
const ALIGN_TOLERANCE = 0.35

/** Doors must be at least this open before the opening is walkable. */
const PASSABLE = 0.75

export function isLandingOpen(floor: FloorId, carY: number, doorOpenness: number): boolean {
  return Math.abs(carY - FLOORS[floor].y) <= ALIGN_TOLERANCE && doorOpenness >= PASSABLE
}

export function shaftGuards(carY: number, doorOpenness: number): AABB[] {
  const guards: AABB[] = []
  const width = SHAFT.halfWidth * 2
  const height = 4.5

  for (const id of Object.keys(FLOORS) as FloorId[]) {
    if (isLandingOpen(id, carY, doorOpenness)) continue
    guards.push(aabb(0, FLOORS[id].y + height / 2, SHAFT.doorZ, width, height, 0.35))
  }

  return guards
}
