// street-nav.js — renderer-free navigation over the LION road graph.
//
// The graph (street_graph.json, from NYC Centerline) is pure data: nodes,
// edges and a per-node degree. Everything that drives vehicles on it — lane
// construction, nearest-lane queries, point-at-distance and the routing
// decision at the end of a lane — lives here with no THREE import, so the
// city traffic sim (traffic.js) and the Phase 3A vehicle sim share one
// authoritative lane model instead of maintaining two street grids.
//
// Coordinates are the LION local plane: +x east, +y north, metres. World z
// is -y, so callers that work in world space negate z before querying.

export const LANE_W = 3.35          // metres, NYC standard travel lane
export const MPH = 0.44704

export function hash1(n) {
  let x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

// ---- lane construction --------------------------------------------------
// Every drivable edge becomes 1..n directed lanes, offset from the
// centreline. Right-hand traffic: forward lanes sit to the right. LION's
// number_travel_lanes is the segment total (both directions); streetwidth is
// the whole carriageway kerb to kerb, and in Manhattan a lot of that is
// parked cars, so travel lanes fit inside what remains.
export function buildLaneGraph(graph, demand = null) {
  const lanes = []
  const nodeLanes = new Map()      // node index -> outgoing lane ids
  const grid = new Map()           // cell key -> lane ids
  const nodes = graph.nodes
  const deg = graph.node_degree

  for (const e of graph.edges) {
    if (!e.drivable) continue
    if (e.kind === 'ferry' || e.kind === 'non_physical') continue
    if (e.length < 8) continue

    const total = Math.max(1, e.lanes)
    const dirs = e.oneway === 0
      ? [{ sign: 1, n: Math.max(1, Math.floor(total / 2)) },
         { sign: -1, n: Math.max(1, Math.ceil(total / 2)) }]
      : [{ sign: e.oneway, n: total }]

    const parked = Math.max(0, e.park_lanes || 0) * 2.45
    const usable = Math.max(LANE_W, e.width - parked)

    for (const d of dirs) {
      const band = e.oneway === 0 ? usable * 0.5 : usable
      const laneW = Math.min(LANE_W * 1.25, band / d.n)
      for (let k = 0; k < d.n; k++) {
        const off = e.oneway === 0
          ? (k + 0.5) * laneW
          : -band * 0.5 + (k + 0.5) * laneW
        const pts = offsetPolyline(e.pts, d.sign, off)
        if (pts.length < 2) continue
        const from = d.sign === 1 ? e.a : e.b
        const to = d.sign === 1 ? e.b : e.a
        const cum = [0]
        for (let i = 1; i < pts.length; i++) {
          cum.push(cum[i - 1] +
            Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
        }
        const id = lanes.length
        const heading = Math.atan2(
          pts[pts.length - 1][1] - pts[0][1],
          pts[pts.length - 1][0] - pts[0][0])
        lanes.push({
          id, from, to, pts, cum, len: cum[cum.length - 1],
          speed: Math.max(4, e.speed_mph * MPH),
          kind: e.kind, name: e.name, heading,
          eid: e.id,
          weight: demand?.ready ? demand.vehNorm(e.id) : 0.6,
          signalled: deg ? deg[to] >= 3 : false,
          axis: (Math.abs(Math.cos(heading)) > 0.5) ? 0 : 1,
          laneW,
          // Curb offset for parking, metres right of travel. Only lanes with
          // a parking lane on the carriageway can hold parked cars.
          park: e.park_lanes > 0 ? usable * 0.5 + 1.0 : null,
          queue: [],
        })
        if (!nodeLanes.has(from)) nodeLanes.set(from, [])
        nodeLanes.get(from).push(id)
        indexLane(grid, id, pts)
      }
    }
  }

  for (const l of lanes) {
    l.next = nodeLanes.get(l.to) || []
  }
  return { lanes, nodeLanes, grid, nodes }
}

function offsetPolyline(pts, sign, off) {
  const src = sign === 1 ? pts : pts.slice().reverse()
  const out = []
  for (let i = 0; i < src.length; i++) {
    const a = src[Math.max(0, i - 1)]
    const b = src[Math.min(src.length - 1, i + 1)]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const d = Math.hypot(dx, dy) || 1
    out.push([src[i][0] + (dy / d) * off, src[i][1] + (-dx / d) * off])
  }
  return out
}

function indexLane(grid, id, pts) {
  const seen = new Set()
  for (const p of pts) {
    const k = `${Math.floor(p[0] / 200)},${Math.floor(p[1] / 200)}`
    if (seen.has(k)) continue
    seen.add(k)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(id)
  }
}

// ---- spatial queries -----------------------------------------------------
export function lanesNear(grid, xM, yM, radius) {
  const r = Math.ceil(radius / 200)
  const cx = Math.floor(xM / 200)
  const cy = Math.floor(yM / 200)
  const out = new Set()
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      const list = grid.get(`${cx + dx},${cy + dy}`)
      if (list) for (const id of list) out.add(id)
    }
  }
  return out
}

// ---- point / projection --------------------------------------------------
// Point at distance s along a lane. Returns [x, y, heading] in LION coords.
export function pointAt(lane, s) {
  const cum = lane.cum
  let i = 1
  while (i < cum.length - 1 && cum[i] < s) i++
  const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
  const a = lane.pts[i - 1]
  const b = lane.pts[i]
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
          Math.atan2(b[1] - a[1], b[0] - a[0])]
}

// Nearest point on a lane to (xM, yM): distance along the lane, off-lane
// distance and signed lateral offset (positive to the right of travel).
export function projectLane(lane, xM, yM) {
  const pts = lane.pts
  let bestS = 0
  let bestDist = Infinity
  let bestLat = 0
  let cum = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const len = Math.sqrt(len2)
    let t = len2 > 1e-12 ? ((xM - a[0]) * dx + (yM - a[1]) * dy) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const px = a[0] + t * dx
    const py = a[1] + t * dy
    const dist = Math.hypot(xM - px, yM - py)
    if (dist < bestDist) {
      bestDist = dist
      bestS = cum + t * len
      // right of travel is (dy, -dx) normalised
      const dl = Math.hypot(dx, dy) || 1
      bestLat = ((xM - px) * (dy / dl) + (yM - py) * (-dx / dl))
    }
    cum += len
  }
  return { s: bestS, dist: bestDist, lateral: bestLat }
}

// Nearest lane to (xM, yM) within radius, optionally restricted to lanes
// with a parking bay. Lane ids are stable across calls for the same graph.
export function nearestLane(grid, lanes, xM, yM, radius, parkable = false) {
  let bestId = -1
  let bestDist = Infinity
  let bestS = 0
  for (const id of lanesNear(grid, xM, yM, radius)) {
    const lane = lanes[id]
    if (parkable && !lane.park) continue
    const proj = projectLane(lane, xM, yM)
    if (proj.dist < bestDist) {
      bestDist = proj.dist
      bestId = id
      bestS = proj.s
    }
  }
  if (bestId < 0) return null
  return { laneId: bestId, s: bestS, dist: bestDist }
}

// ---- routing --------------------------------------------------------------
// Pick the outgoing lane at the end of `lane`, preferring to go straight
// and refusing a U-turn unless it is the only option. Deterministic in seed.
// `lanes` is the full lane array of the graph the lane belongs to, so the
// candidate headings resolve without a module-level registry.
export function routeNextLaneWith(lanes, lane, seed) {
  const next = lane.next
  if (!next || !next.length) return -1
  if (next.length === 1) return next[0]
  let best = -1
  let bestScore = -Infinity
  for (const id of next) {
    const n = lanes[id]
    if (!n) continue
    let d = n.heading - lane.heading
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    if (Math.abs(d) > 2.7) continue
    const score = Math.cos(d) * 2.0 + hash1(seed + id) * 1.4
    if (score > bestScore) { bestScore = score; best = id }
  }
  return best >= 0 ? best : next[(seed | 0) % next.length]
}
