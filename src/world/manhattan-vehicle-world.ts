/**
 * The Manhattan BVH world as the vehicle simulation sees it.
 *
 * The pure vehicle core moves through the {@link VehicleWorld} interface; in
 * the live build that interface is backed by the island's BVH collision
 * (`manhattan-collision.ts`) instead of the AABB arena the tests use. This
 * module is the only place the vehicle simulation touches THREE.
 */
import type { VehicleWorld } from '../gameplay/vehicles/vehicle-collision'
import { manhattanCollision } from './manhattan-collision'

export const manhattanVehicleWorld: VehicleWorld = {
  groundHeightAt(x, z) {
    return manhattanCollision.groundHeightAt(x, z)
  },

  moveCircle(from, dx, dz, radius) {
    return manhattanCollision.move(from, dx, dz, radius)
  },

  castDistance(origin, direction, maxDistance) {
    return manhattanCollision.castDistance(origin, direction, maxDistance)
  },

  isCircleClear(x, z, radius) {
    const groundY = manhattanCollision.groundHeightAt(x, z)
    if (groundY === null) return false
    if (manhattanCollision.isInsideBuilding(x, groundY, z)) return false
    // Probe the footprint so a circle straddling a building edge is rejected.
    for (const [ox, oz] of [
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ] as const) {
      if (manhattanCollision.isInsideBuilding(x + ox, groundY, z + oz)) return false
    }
    return true
  },
}
