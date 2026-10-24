/**
 * GPS routing over the LION street graph: A* from the player to a waypoint.
 *
 * Renderer-free and deterministic so it is unit tested. The graph arrives as
 * plain arrays (see `street-data.ts`); this builds a compact adjacency (CSR)
 * once and answers queries against it.
 *
 * One-way streets: a pedestrian may walk either way down any street, a driver
 * may not. `respectOneWay` picks which rule the route follows.
 */

export interface RouteEdgeInput {
  a: number
  b: number
  /** Metres. */
  length: number
  /** 0 two-way, 1 a→b only, -1 b→a only. */
  oneway: number
  /** False for footpaths, park paths and the like. */
  drivable: boolean
}

export interface RoadGraph {
  nodeCount: number
  nodeX: Float64Array
  nodeZ: Float64Array
  /** CSR offsets into the neighbour arrays, length nodeCount + 1. */
  offsets: Int32Array
  /** Neighbour node per slot. */
  target: Int32Array
  /** Edge index per slot. */
  edge: Int32Array
  /** Metres per slot. */
  cost: Float64Array
  /** Bit 0: traversal allowed for drivers (one-way respected, drivable). */
  flags: Uint8Array
}

const FLAG_DRIVE = 1

/**
 * Build the adjacency. `nodes` are world (x, z) pairs.
 */
export function buildRoadGraph(
  nodes: ReadonlyArray<readonly [number, number]>,
  edges: ReadonlyArray<RouteEdgeInput>,
): RoadGraph {
  const n = nodes.length
  const nodeX = new Float64Array(n)
  const nodeZ = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    nodeX[i] = nodes[i][0]
    nodeZ[i] = nodes[i][1]
  }
  const degree = new Int32Array(n + 1)
  const valid = (e: RouteEdgeInput) =>
    e.a >= 0 && e.a < n && e.b >= 0 && e.b < n && e.a !== e.b && Number.isFinite(e.length)
  for (const e of edges) {
    if (!valid(e)) continue
    degree[e.a] += 1
    degree[e.b] += 1
  }
  const offsets = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + degree[i]
  const slots = offsets[n]
  const target = new Int32Array(slots)
  const edge = new Int32Array(slots)
  const cost = new Float64Array(slots)
  const flags = new Uint8Array(slots)
  const fill = offsets.slice(0, n)
  edges.forEach((e, index) => {
    if (!valid(e)) return
    const length = Math.max(0.01, e.length)
    // a → b
    let s = fill[e.a]++
    target[s] = e.b
    edge[s] = index
    cost[s] = length
    flags[s] = e.drivable && e.oneway !== -1 ? FLAG_DRIVE : 0
    // b → a
    s = fill[e.b]++
    target[s] = e.a
    edge[s] = index
    cost[s] = length
    flags[s] = e.drivable && e.oneway !== 1 ? FLAG_DRIVE : 0
  })
  return { nodeCount: n, nodeX, nodeZ, offsets, target, edge, cost, flags }
}

/** Binary min-heap of (priority, node). */
class MinHeap {
  private pri: number[] = []
  private val: number[] = []
  get size(): number {
    return this.val.length
  }
  push(priority: number, value: number): void {
    const pri = this.pri
    const val = this.val
    let i = val.length
    pri.push(priority)
    val.push(value)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (pri[parent] <= priority) break
      pri[i] = pri[parent]
      val[i] = val[parent]
      i = parent
    }
    pri[i] = priority
    val[i] = value
  }
  pop(): number {
    const pri = this.pri
    const val = this.val
    const top = val[0]
    const lastP = pri.pop() as number
    const lastV = val.pop() as number
    const n = val.length
    if (n > 0) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        if (l >= n) break
        const r = l + 1
        const c = r < n && pri[r] < pri[l] ? r : l
        if (pri[c] >= lastP) break
        pri[i] = pri[c]
        val[i] = val[c]
        i = c
      }
      pri[i] = lastP
      val[i] = lastV
    }
    return top
  }
}

export interface RouteOptions {
  /** Drivers keep to one-way rules and drivable streets. */
  respectOneWay?: boolean
  /** Give up after expanding this many nodes (guards the frame). */
  maxExpansions?: number
}

export interface RouteResult {
  /** Node indices from start to goal, inclusive. */
  nodes: number[]
  /** Edge index used for each hop (length nodes.length - 1). */
  edges: number[]
  /** Total metres. */
  length: number
}

/**
 * A* with a straight-line heuristic (admissible: no street is shorter than
 * the crow flies). Returns null when the goal is unreachable.
 */
export function findRoute(
  graph: RoadGraph,
  start: number,
  goal: number,
  options: RouteOptions = {},
): RouteResult | null {
  const n = graph.nodeCount
  if (!(start >= 0 && start < n && goal >= 0 && goal < n)) return null
  if (start === goal) return { nodes: [start], edges: [], length: 0 }
  const drive = options.respectOneWay === true
  const limit = options.maxExpansions ?? 200000
  const { nodeX, nodeZ, offsets, target, edge, cost, flags } = graph
  const gx = nodeX[goal]
  const gz = nodeZ[goal]
  const g = new Float64Array(n).fill(Infinity)
  const via = new Int32Array(n).fill(-1)
  const viaEdge = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const open = new MinHeap()
  g[start] = 0
  open.push(Math.hypot(nodeX[start] - gx, nodeZ[start] - gz), start)
  let expansions = 0
  while (open.size > 0) {
    const current = open.pop()
    if (closed[current]) continue
    if (current === goal) break
    closed[current] = 1
    if (++expansions > limit) return null
    const base = g[current]
    for (let s = offsets[current]; s < offsets[current + 1]; s++) {
      if (drive && !(flags[s] & FLAG_DRIVE)) continue
      const next = target[s]
      if (closed[next]) continue
      const tentative = base + cost[s]
      if (tentative < g[next]) {
        g[next] = tentative
        via[next] = current
        viaEdge[next] = edge[s]
        open.push(tentative + Math.hypot(nodeX[next] - gx, nodeZ[next] - gz), next)
      }
    }
  }
  if (!Number.isFinite(g[goal])) return null
  const nodes: number[] = []
  const edges: number[] = []
  for (let v = goal; v !== -1; v = via[v]) {
    nodes.push(v)
    if (viaEdge[v] !== -1) edges.push(viaEdge[v])
  }
  nodes.reverse()
  edges.reverse()
  return { nodes, edges, length: g[goal] }
}

/**
 * Nearest node to (x, z), optionally limited to nodes that have at least one
 * drivable connection. Linear scan: 11k nodes is ~0.1 ms, and this runs a few
 * times a second at most.
 */
export function nearestNode(graph: RoadGraph, x: number, z: number, drivableOnly = false): number {
  let best = -1
  let bestD = Infinity
  const { nodeX, nodeZ, offsets, flags } = graph
  for (let i = 0; i < graph.nodeCount; i++) {
    if (drivableOnly) {
      let ok = false
      for (let s = offsets[i]; s < offsets[i + 1]; s++) {
        if (flags[s] & FLAG_DRIVE) {
          ok = true
          break
        }
      }
      if (!ok) continue
    }
    const dx = nodeX[i] - x
    const dz = nodeZ[i] - z
    const d = dx * dx + dz * dz
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}
