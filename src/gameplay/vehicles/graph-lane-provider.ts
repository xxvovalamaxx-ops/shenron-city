/**
 * The LION street graph as a {@link LaneProvider}.
 *
 * The city pipeline builds the graph's lanes once (city/street-nav.js) and
 * shares them with the LION traffic sim; this provider adapts those same
 * lane objects to the Phase 3A `Lane` shape, converting the LION plane
 * (+x east, +y north) into world space (z = -y) and string ids. Because the
 * lane ids, geometry and routing come from the same build, the player's car
 * and the city traffic literally drive the same streets: the ghost sync
 * (vehicle-session.ts) projects the Phase 3A vehicles onto these lanes and
 * hands them to the LION sim as braking obstacles.
 */
import { nearestLane as lionNearestLane, type NavLane } from '../../city/street-nav.js'
import type { Lane, LanePoint, LaneProvider } from './vehicle-lanes'

export function createGraphLaneProvider(
  navLanes: NavLane[],
  grid: Map<string, number[]>,
): LaneProvider {
  const table: Record<string, Lane> = {}
  for (const lane of navLanes) {
    table[String(lane.id)] = {
      id: String(lane.id),
      loop: false,
      speedLimit: lane.speed,
      laneWidth: lane.laneW,
      points: lane.pts.map(([x, y]): LanePoint => ({ x, z: -y })),
      next: lane.next.map((n) => String(n)),
      parkOffset: lane.park ?? undefined,
    }
  }

  function lion(x: number, z: number): [number, number] {
    return [x, -z]
  }

  return {
    graph: true,
    lanes: table,
    nearestLane(x, z, radius, parkable = false) {
      const [lx, ly] = lion(x, z)
      const hit = lionNearestLane(grid, navLanes, lx, ly, radius, parkable)
      if (!hit) return null
      return table[String(hit.laneId)] ?? null
    },
    project(x, z, radius) {
      const [lx, ly] = lion(x, z)
      const hit = lionNearestLane(grid, navLanes, lx, ly, radius)
      if (!hit) return null
      const lane = table[String(hit.laneId)]
      if (!lane) return null
      return { lane, distance: hit.s }
    },
  }
}
