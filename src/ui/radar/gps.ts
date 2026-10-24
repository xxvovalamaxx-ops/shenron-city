/**
 * The GPS: keeps a route from the player to the map waypoint, along the
 * streets, refreshed a couple of times a second.
 *
 * Module state rather than React state — the radar redraws it every frame and
 * nothing in React needs to re-render when it moves. Routing itself is the
 * tested A* in `route.ts`.
 */
import { findRoute, nearestNode } from './route'
import type { StreetData } from './street-data'

export interface GpsRoute {
  /** World polyline from the player to the waypoint, interleaved x, z. */
  pts: Float32Array
  /** Street distance, metres. */
  length: number
  goalX: number
  goalZ: number
}

export const gps: { route: GpsRoute | null; lastSolve: number; key: string } = {
  route: null,
  lastSolve: 0,
  key: '',
}

const REFRESH_MS = 1200

/** Arrived: GTA clears the waypoint when you reach it. */
export const ARRIVAL_RADIUS = 18

/**
 * Stitch a node route into a world polyline, following each edge's own
 * geometry in the direction of travel.
 */
export function routePolyline(
  data: StreetData,
  nodes: number[],
  edges: number[],
  from: { x: number; z: number },
  to: { x: number; z: number },
): Float32Array {
  const out: number[] = [from.x, from.z]
  for (let i = 0; i < edges.length; i++) {
    const e = data.edges[edges[i]]
    const forward = e.a === nodes[i]
    const pts = e.pts
    const count = pts.length / 2
    for (let j = 0; j < count; j++) {
      const k = forward ? j : count - 1 - j
      out.push(pts[k * 2], pts[k * 2 + 1])
    }
  }
  if (edges.length === 0 && nodes.length > 0) {
    const [nx, nz] = data.nodes[nodes[0]]
    out.push(nx, nz)
  }
  out.push(to.x, to.z)
  return new Float32Array(out)
}

/**
 * Refresh the route if it is due. Returns true when the waypoint has been
 * reached (the caller clears it).
 */
export function updateGps(
  data: StreetData | null,
  waypoint: { x: number; z: number } | null,
  player: { x: number; z: number },
  driving: boolean,
  now: number,
): boolean {
  if (!waypoint) {
    gps.route = null
    gps.key = ''
    return false
  }
  if (Math.hypot(waypoint.x - player.x, waypoint.z - player.z) < ARRIVAL_RADIUS) {
    gps.route = null
    gps.key = ''
    return true
  }
  if (!data) return false
  const key = `${waypoint.x.toFixed(1)},${waypoint.z.toFixed(1)},${driving ? 1 : 0}`
  if (key === gps.key && now - gps.lastSolve < REFRESH_MS) return false
  gps.key = key
  gps.lastSolve = now
  const start = nearestNode(data.graph, player.x, player.z, driving)
  const goal = nearestNode(data.graph, waypoint.x, waypoint.z, driving)
  let result = findRoute(data.graph, start, goal, { respectOneWay: driving })
  // No legal driving route (an island, a dead-end one-way): show the walking
  // one rather than nothing.
  if (!result && driving) result = findRoute(data.graph, start, goal)
  if (!result) {
    gps.route = null
    return false
  }
  gps.route = {
    pts: routePolyline(data, result.nodes, result.edges, player, waypoint),
    length: result.length,
    goalX: waypoint.x,
    goalZ: waypoint.z,
  }
  return false
}
