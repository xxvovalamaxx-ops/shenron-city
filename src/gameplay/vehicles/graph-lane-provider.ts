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
import {
  nearestLane as lionNearestLane,
  hash1,
  type NavLane,
} from '../../city/street-nav.js'
import { SIGNAL_CYCLE, SIGNAL_GREEN, SIGNAL_AMBER, buildIntersections, STOP_LINE } from '../../city/intersections.js'
import type { Lane, LanePoint, LaneProvider } from './vehicle-lanes'

export function createGraphLaneProvider(
  navLanes: NavLane[],
  grid: Map<string, number[]>,
): LaneProvider {
  // The intersection model over the same lane graph, for the baked
  // per-approach arbitration data.
  const nodeLanes = new Map<number, number[]>()
  for (const lane of navLanes) {
    const list = nodeLanes.get(lane.from) ?? []
    list.push(lane.id)
    nodeLanes.set(lane.from, list)
  }
  const ixByNode = buildIntersections(null, navLanes, nodeLanes).byNode

  const table: Record<string, Lane> = {}
  for (const lane of navLanes) {
    const ix = ixByNode.get(lane.to)
    const approachIndex = ix?.approaches.indexOf(lane.id) ?? -1
    table[String(lane.id)] = {
      id: String(lane.id),
      loop: false,
      speedLimit: lane.speed,
      laneWidth: lane.laneW,
      points: lane.pts.map(([x, y]): LanePoint => ({ x, z: -y })),
      next: lane.next.map((n) => String(n)),
      parkOffset: lane.park ?? undefined,
      signalled: lane.signalled || undefined,
      axis: lane.axis,
      // Same fixed program the LION traffic sim arbitrates with, so both
      // sims show the same colour at the same sim time.
      signal: lane.signalled
        ? {
            cycle: SIGNAL_CYCLE,
            green: SIGNAL_GREEN,
            amber: SIGNAL_AMBER,
            offset: hash1(lane.to) * SIGNAL_CYCLE,
          }
        : undefined,
      junction: ix && approachIndex >= 0
        ? {
            id: lane.to,
            boxRadius: STOP_LINE + 4.5,
            crossingLaneIds: ix.conflicts
              .filter(([a, b]) => a === approachIndex || b === approachIndex)
              .map(([a, b]) => String(ix.approaches[a === approachIndex ? b : a])),
            opposingLaneIds: ix.approaches
              .filter((_, j) => j !== approachIndex && Math.abs(wrapHeading(ix.headings[approachIndex] - ix.headings[j])) > 2.4)
              .map(String),
          }
        : undefined,
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

function wrapHeading(h: number): number {
  let d = h
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}
