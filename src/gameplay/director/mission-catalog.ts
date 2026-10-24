/**
 * The job board: GTA-style missions laid out on the real street graph around
 * a spawn point.
 *
 * Every position comes from the LION graph, so pick-ups stand on a street
 * corner and destinations are reachable by road; distances are road metres,
 * not crow-flies. Layout is a pure function of (street data, anchor, seed) —
 * the same city and spawn give the same jobs on every machine — and it is
 * unit tested on a synthetic grid.
 */
import type { StreetData } from '../../ui/radar/street-data'
import { findRoute, nearestNode, type RoadGraph } from '../../ui/radar/route'
import { routePolyline } from '../../ui/radar/gps'
import type { MissionDef, Vec2 } from '../missions/missions'

const FLAG_DRIVE = 1

/** Small deterministic hash → [0, 1). */
export function hash01(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/**
 * Road distance from `start` to every node, up to `maxMeters` (Dijkstra).
 * Unreached nodes are Infinity.
 */
export function roadDistances(graph: RoadGraph, start: number, maxMeters: number, drive: boolean): Float64Array {
  const dist = new Float64Array(graph.nodeCount).fill(Infinity)
  if (start < 0 || start >= graph.nodeCount) return dist
  dist[start] = 0
  // Binary heap of [distance, node] pairs, flattened.
  const heapD: number[] = [0]
  const heapN: number[] = [start]
  const swap = (i: number, j: number) => {
    ;[heapD[i], heapD[j]] = [heapD[j], heapD[i]]
    ;[heapN[i], heapN[j]] = [heapN[j], heapN[i]]
  }
  const pop = (): [number, number] => {
    const top: [number, number] = [heapD[0], heapN[0]]
    const lastD = heapD.pop() as number
    const lastN = heapN.pop() as number
    if (heapD.length > 0) {
      heapD[0] = lastD
      heapN[0] = lastN
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < heapD.length && heapD[l] < heapD[m]) m = l
        if (r < heapD.length && heapD[r] < heapD[m]) m = r
        if (m === i) break
        swap(i, m)
        i = m
      }
    }
    return top
  }
  const push = (d: number, n: number) => {
    heapD.push(d)
    heapN.push(n)
    let i = heapD.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heapD[p] <= heapD[i]) break
      swap(i, p)
      i = p
    }
  }
  while (heapD.length > 0) {
    const [d, n] = pop()
    if (d > dist[n] || d > maxMeters) continue
    for (let s = graph.offsets[n]; s < graph.offsets[n + 1]; s++) {
      if (drive && !(graph.flags[s] & FLAG_DRIVE)) continue
      const next = graph.target[s]
      const nd = d + graph.cost[s]
      if (nd < dist[next]) {
        dist[next] = nd
        push(nd, next)
      }
    }
  }
  return dist
}

/** Does this node carry at least one drivable, legal-to-leave connection? */
function isDrivableNode(graph: RoadGraph, n: number): boolean {
  for (let s = graph.offsets[n]; s < graph.offsets[n + 1]; s++) if (graph.flags[s] & FLAG_DRIVE) return true
  return false
}

/**
 * A node roughly `meters` of road away from `from`, chosen deterministically
 * by `seed` among the candidates in a ±15 % band. Prefers nodes that also
 * lie in the half-plane of `bias` when given, so jobs lead somewhere
 * interesting (downtown, across the island) instead of doubling back.
 */
export function nodeAtRoadDistance(
  graph: RoadGraph,
  from: number,
  meters: number,
  seed: string,
  drive: boolean,
  bias?: Vec2,
): number | null {
  const dist = roadDistances(graph, from, meters * 2, drive)
  const fx = graph.nodeX[from]
  const fz = graph.nodeZ[from]
  const inBand: number[] = []
  const biased: number[] = []
  for (let n = 0; n < graph.nodeCount; n++) {
    const d = dist[n]
    if (!(d >= meters * 0.85 && d <= meters * 1.15)) continue
    if (drive && !isDrivableNode(graph, n)) continue
    inBand.push(n)
    if (bias && (graph.nodeX[n] - fx) * bias.x + (graph.nodeZ[n] - fz) * bias.z > 0) biased.push(n)
  }
  const pool = biased.length > 0 ? biased : inBand
  if (pool.length > 0) return pool[Math.floor(hash01(seed) * pool.length) % pool.length]
  // A sparse neighbourhood (long blocks, a park edge) can leave the band
  // empty: settle for the reachable node whose road distance is closest.
  let best = -1
  let bestError = Infinity
  for (let n = 0; n < graph.nodeCount; n++) {
    if (n === from || !Number.isFinite(dist[n])) continue
    if (drive && !isDrivableNode(graph, n)) continue
    const error = Math.abs(dist[n] - meters)
    if (error < bestError) {
      bestError = error
      best = n
    }
  }
  return best >= 0 ? best : null
}

/**
 * A pedestrian-friendly spot at an intersection: the corner between the two
 * widest streets meeting at `node`, pushed out past the kerb onto the
 * pavement. Falls back to the node itself for dead ends.
 */
export function cornerOf(data: StreetData, node: number): Vec2 {
  const g = data.graph
  const nx = g.nodeX[node]
  const nz = g.nodeZ[node]
  const arms: Array<{ angle: number; width: number; dx: number; dz: number }> = []
  for (let s = g.offsets[node]; s < g.offsets[node + 1]; s++) {
    const e = data.edges[g.edge[s]]
    if (!e) continue
    // Direction leaving the node along the edge's own geometry.
    const pts = e.pts
    const count = pts.length / 2
    const fromA = e.a === node
    const k = fromA ? Math.min(1, count - 1) : Math.max(0, count - 2)
    let dx = pts[k * 2] - nx
    let dz = pts[k * 2 + 1] - nz
    const len = Math.hypot(dx, dz)
    if (len < 1e-3) continue
    dx /= len
    dz /= len
    arms.push({ angle: Math.atan2(dz, dx), width: e.width, dx, dz })
  }
  if (arms.length < 2) return { x: nx, z: nz }
  arms.sort((a, b) => a.angle - b.angle)
  // The corner between two neighbouring arms with the widest combined width.
  let best = 0
  let bestScore = -Infinity
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i]
    const b = arms[(i + 1) % arms.length]
    let gap = b.angle - a.angle
    if (gap <= 0) gap += Math.PI * 2
    // Skip reflex gaps (a T-junction's straight-through side has no corner).
    if (gap > Math.PI * 0.9) continue
    const score = a.width + b.width
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  const a = arms[best]
  const b = arms[(best + 1) % arms.length]
  let bx = a.dx + b.dx
  let bz = a.dz + b.dz
  const bl = Math.hypot(bx, bz) || 1
  bx /= bl
  bz /= bl
  const reach = Math.hypot(a.width / 2, b.width / 2) + 2.5
  return { x: nx + bx * reach, z: nz + bz * reach }
}

/** Points every `spacing` metres along a polyline, ending exactly at its end. */
export function samplePolyline(pts: Float32Array, spacing: number): Vec2[] {
  const out: Vec2[] = []
  let carried = 0
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i]
    const az = pts[i + 1]
    const bx = pts[i + 2]
    const bz = pts[i + 3]
    const seg = Math.hypot(bx - ax, bz - az)
    let t = spacing - carried
    while (t <= seg) {
      out.push({ x: ax + ((bx - ax) * t) / seg, z: az + ((bz - az) * t) / seg })
      t += spacing
    }
    carried = seg - (t - spacing)
  }
  const endX = pts[pts.length - 2]
  const endZ = pts[pts.length - 1]
  const last = out[out.length - 1]
  if (!last || Math.hypot(last.x - endX, last.z - endZ) > spacing * 0.35) out.push({ x: endX, z: endZ })
  else out[out.length - 1] = { x: endX, z: endZ }
  return out
}

function nodePos(graph: RoadGraph, n: number): Vec2 {
  return { x: graph.nodeX[n], z: graph.nodeZ[n] }
}

/**
 * The four jobs, laid out around `anchor` (the player's spawn), leading in
 * the `facing` direction where the street grid allows it.
 */
export function buildMissionCatalog(data: StreetData, anchor: Vec2, facing: Vec2): MissionDef[] {
  const g = data.graph
  const home = nearestNode(g, anchor.x, anchor.z, false)
  if (home < 0) return []
  const missions: MissionDef[] = []

  const pickup = (id: string, meters: number): { node: number; at: Vec2 } | null => {
    const node = nodeAtRoadDistance(g, home, meters, `${id}:start`, false, facing)
    return node === null ? null : { node, at: cornerOf(data, node) }
  }

  // 1. Wheels: steal any car, deliver it to a chop shop across the district.
  const wheels = pickup('wheels', 70)
  if (wheels) {
    const shop = nodeAtRoadDistance(g, wheels.node, 1100, 'wheels:shop', true, facing)
    if (shop !== null) {
      missions.push({
        id: 'wheels',
        title: 'Wheels',
        start: wheels.at,
        objectives: [
          { kind: 'enter-vehicle', text: 'Steal a car. Any car will do.' },
          { kind: 'drive-to', text: 'Take it to the chop shop.', at: nodePos(g, shop), radius: 7, stopBelowKmh: 14 },
        ],
        timeLimit: 210,
        reward: 1500,
      })
    }
  }

  // 2. Midtown Sprint: checkpoints along a real 2 km route.
  const sprint = pickup('sprint', 260)
  if (sprint) {
    const finish = nodeAtRoadDistance(g, sprint.node, 2200, 'sprint:finish', true, facing)
    const route = finish === null ? null : findRoute(g, sprint.node, finish, { respectOneWay: true })
    if (route && finish !== null) {
      const line = routePolyline(data, route.nodes, route.edges, nodePos(g, sprint.node), nodePos(g, finish))
      const points = samplePolyline(line, 300)
      missions.push({
        id: 'sprint',
        title: 'Midtown Sprint',
        start: sprint.at,
        objectives: [
          { kind: 'enter-vehicle', text: 'Get a car.' },
          { kind: 'checkpoints', text: 'Hit every checkpoint before time runs out.', points, radius: 10 },
        ],
        timeLimit: Math.round(75 + route.length / 11),
        reward: 3000,
      })
    }
  }

  // 3. Heat: earn two stars, then shake them.
  const heat = pickup('heat', 480)
  if (heat) {
    missions.push({
      id: 'heat',
      title: 'Heat',
      start: heat.at,
      objectives: [
        { kind: 'get-wanted', text: 'Get a 2-star wanted level.', stars: 2 },
        { kind: 'lose-wanted', text: 'Lose the cops.' },
      ],
      reward: 2500,
    })
  }

  // 4. Night Fare: find a cab, collect a passenger, drop them across town.
  const fare = pickup('fare', 720)
  if (fare) {
    const passenger = nodeAtRoadDistance(g, fare.node, 350, 'fare:pickup', true)
    const dropoff = passenger === null ? null : nodeAtRoadDistance(g, passenger, 1500, 'fare:dropoff', true, facing)
    if (passenger !== null && dropoff !== null) {
      missions.push({
        id: 'fare',
        title: 'Night Fare',
        start: fare.at,
        objectives: [
          { kind: 'enter-vehicle', text: 'Find a taxi.', vehicleKinds: ['taxi'] },
          { kind: 'drive-to', text: 'Pick up the fare.', at: nodePos(g, passenger), radius: 7, stopBelowKmh: 10 },
          { kind: 'drive-to', text: 'Drop the passenger off.', at: nodePos(g, dropoff), radius: 7, stopBelowKmh: 10 },
        ],
        timeLimit: 300,
        reward: 1800,
      })
    }
  }

  return missions
}
