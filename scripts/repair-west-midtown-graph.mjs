/**
 * Repair the midtown-west street hole (Times Square area) in the runtime
 * graphs.
 *
 * The LION/OSM export that produced street_graph.json and walk_graph.json has
 * a genuine hole west of 6th Avenue in the midtown band (the Times Square
 * area): no drivable edges, no walk lanes, no buildings. The street TILES
 * exist there, so the real road geometry is available â€” this script
 * synthesizes a street grid from geometry-derived line constants and merges
 * it into both graphs.
 *
 * Line constants are measured from the exported tile geometry and the
 * world-aligned subway station data (see the probes): streets run along
 * 28.93 degrees, avenues along 62 degrees, Broadway follows the station
 * polyline. Streets are the mask's strong v-peaks; avenues are anchored on
 * the real 6th-12th Avenues.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const S_ANGLE = 28.93 // street direction, degrees
const A_ANGLE = 62.0 // avenue direction, degrees
const SR = (S_ANGLE * Math.PI) / 180
// Street unit vector (direction of travel along a street):
const SX = Math.cos(SR), SZ = Math.sin(SR)
// v = dot(p, avenueUnit) identifies a street line; u = dot(p, streetUnit)
// identifies an avenue line.
const AVENUE_UNIT = { x: Math.cos(A_ANGLE * Math.PI / 180 + Math.PI / 2), z: Math.sin(A_ANGLE * Math.PI / 180 + Math.PI / 2) }
const vOf = (x, z) => x * AVENUE_UNIT.x + z * AVENUE_UNIT.z
const uOf = (x, z) => x * SX + z * SZ

// Measured street lines (v, metres) from the tile mask, W 24 .. W 60.
const STREET_V = [
  -2296, -2112, -2032, -1808, -1712, -1608, -1528, -1488, -1328, -1136,
  -928, -600, -448, -360, -280, -208, -128, -56, 8, 88, 120, 208, 296, 376,
  448, 528, 616, 704, 792, 880,
]
// Measured avenue lines (u, metres). 6/7/8 AVE anchored on world geometry:
// 7 AVE passes the 42nd St subway entrance (-1634, -2736); avenue spacing is
// 274 m. 9-12 AVE confirmed against the mask peaks.
const AVE_6_U = uOf(-1098, -2433) // 6th Ave at 42nd St latitude
const AVENUE_U = [
  AVE_6_U,
  AVE_6_U - 274, // 7 AVE
  AVE_6_U - 548, // 8 AVE
  AVE_6_U - 822, // 9 AVE
  AVE_6_U - 1096, // 10 AVE
  AVE_6_U - 1370, // 11 AVE
  AVE_6_U - 1644, // 12 AVE
]
const AVE_NAMES = ['6 AVE', '7 AVE', '8 AVE', '9 AVE', '10 AVE', '11 AVE', '12 AVE']

// Broadway: world-aligned subway stations through the band.
const BROADWAY = [
  [-1206, -1177], // 59 St-Columbus Circle
  [-1333, -2070], // 50 St
  [-1476, -2433], // Times Sq-42 St
  [-2156, -3619], // 28 St
  [-2347, -3947], // 23 St
]

// The synthesized grid is clipped to the hole band by construction: the
// street/avenue line constants all fall inside it.

const streetName = (v) => {
  // W 42 ST anchors at v=-1608; blocks step ~80 m in v.
  const n = Math.round(42 - (v + 1608) / 80)
  return `W ${n} ST`
}

/** Point at street v and avenue u (intersection of the two lines). */
function intersection(v, u) {
  // solve: dot(p, avenueUnit) = v, dot(p, streetUnit) = u
  // p = a * streetUnit + b * avenueUnit  with a=u, b=v (units are orthonormal)
  return {
    x: u * SX + v * AVENUE_UNIT.x,
    z: u * SZ + v * AVENUE_UNIT.z,
  }
}

// ---- Build the synthesized edges -------------------------------------------
const synthEdges = [] // { name, segments: [{a, b, aPos, bPos, len}] }
const nodes = new Map() // key x,z -> node id

function addNode(x, z) {
  const key = `${Math.round(x * 10)},${Math.round(z * 10)}`
  if (nodes.has(key)) return nodes.get(key)
  const id = nodes.size
  nodes.set(key, id)
  return id
}

function pushSegments(list, name, waypoints) {
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len < 4) continue
    list.push({
      name,
      a: addNode(a.x, a.z),
      b: addNode(b.x, b.z),
      aPos: a,
      bPos: b,
      len,
    })
  }
}

// Broadway polyline segments (world x, z).
const BROADWAY_SEGS = []
for (let i = 0; i + 1 < BROADWAY.length; i++) {
  const [ax, az] = BROADWAY[i]
  const [bx, bz] = BROADWAY[i + 1]
  const len = Math.hypot(bx - ax, bz - az)
  if (len < 8) continue
  BROADWAY_SEGS.push({ ax, az, bx, bz, len })
}

// Crossings of the line (v=const) with every Broadway segment, as u values.
function streetBroadwayCrossings(v) {
  const us = []
  for (const s of BROADWAY_SEGS) {
    const vA = vOf(s.ax, s.az)
    const vB = vOf(s.bx, s.bz)
    const d = vB - vA
    if (Math.abs(d) < 1e-6) continue
    const t = (v - vA) / d
    if (t <= 1e-3 || t >= 1 - 1e-3) continue
    us.push(uOf(s.ax, s.az) + t * (uOf(s.bx, s.bz) - uOf(s.ax, s.az)))
  }
  return us
}

// Crossings of the line (u=const) with every Broadway segment, as v values.
function avenueBroadwayCrossings(u) {
  const vs = []
  for (const s of BROADWAY_SEGS) {
    const uA = uOf(s.ax, s.az)
    const uB = uOf(s.bx, s.bz)
    const d = uB - uA
    if (Math.abs(d) < 1e-6) continue
    const t = (u - uA) / d
    if (t <= 1e-3 || t >= 1 - 1e-3) continue
    vs.push(vOf(s.ax, s.az) + t * (vOf(s.bx, s.bz) - vOf(s.ax, s.az)))
  }
  return vs
}

// Streets: each street line crosses the avenues and Broadway; edges run
// between consecutive waypoints so every junction is a shared node.
for (const v of STREET_V) {
  const name = streetName(v)
  const wayU = [...AVENUE_U, ...streetBroadwayCrossings(v)]
  wayU.sort((a, b) => a - b)
  const waypoints = []
  for (const u of wayU) {
    const p = intersection(v, u)
    const last = waypoints[waypoints.length - 1]
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 4) continue
    waypoints.push(p)
  }
  const segments = []
  pushSegments(segments, name, waypoints)
  synthEdges.push({ kind: 'street', name, segments })
}

// Avenues.
for (let j = 0; j < AVENUE_U.length; j++) {
  const name = AVE_NAMES[j]
  const u = AVENUE_U[j]
  const wayV = [...STREET_V, ...avenueBroadwayCrossings(u)]
  wayV.sort((a, b) => a - b)
  const waypoints = []
  for (const v of wayV) {
    const p = intersection(v, u)
    const last = waypoints[waypoints.length - 1]
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 4) continue
    waypoints.push(p)
  }
  const segments = []
  pushSegments(segments, name, waypoints)
  synthEdges.push({ kind: 'avenue', name, segments })
}

// Broadway: split at every street/avenue crossing so traffic can turn.
{
  const segments = []
  for (const s of BROADWAY_SEGS) {
    const vA = vOf(s.ax, s.az)
    const vB = vOf(s.bx, s.bz)
    const uA = uOf(s.ax, s.az)
    const uB = uOf(s.bx, s.bz)
    const cuts = [0, 1]
    for (const v of STREET_V) {
      const d = vB - vA
      if (Math.abs(d) < 1e-6) continue
      const t = (v - vA) / d
      if (t > 1e-3 && t < 1 - 1e-3) cuts.push(t)
    }
    for (const u of AVENUE_U) {
      const d = uB - uA
      if (Math.abs(d) < 1e-6) continue
      const t = (u - uA) / d
      if (t > 1e-3 && t < 1 - 1e-3) cuts.push(t)
    }
    cuts.sort((a, b) => a - b)
    const waypoints = []
    for (const t of cuts) {
      waypoints.push({ x: s.ax + (s.bx - s.ax) * t, z: s.az + (s.bz - s.az) * t })
    }
    pushSegments(segments, 'BROADWAY', waypoints)
  }
  synthEdges.push({ kind: 'broadway', name: 'BROADWAY', segments })
}

// ---- Merge into street_graph.json ------------------------------------------
const graph = JSON.parse(readFileSync('public/models/manhattan/streets/street_graph.json', 'utf8'))
const nodeById = new Map(graph.nodes.map((n, i) => [i, n]))
let nextNodeId = graph.nodes.length
let nextEdgeId = graph.edges.length

// Snapping: find the existing node nearest to a world position (the graph
// nodes are in the same frame: node coords are [x_m, y_m], world z = -y).
const existingNodeIndex = []
for (let i = 0; i < graph.nodes.length; i++) {
  const [nx, ny] = graph.nodes[i]
  existingNodeIndex.push({ id: i, x: nx, z: -ny })
}

function findNearbyNode(x, z, maxDist) {
  let best = null
  let bestD = maxDist
  for (const n of existingNodeIndex) {
    const d = Math.hypot(n.x - x, n.z - z)
    if (d < bestD) {
      bestD = d
      best = n.id
    }
  }
  return best
}

// Add synthesized nodes as graph nodes; snap to existing nodes when close.
const synNodeIds = new Map() // local node id -> graph node id
for (const [key, localId] of nodes) {
  const [xs, zs] = key.split(',').map((v) => Number(v) / 10)
  const near = findNearbyNode(xs, zs, 25)
  if (near !== null) {
    synNodeIds.set(localId, near)
  } else {
    nodeById.set(nextNodeId, [xs, -zs])
    existingNodeIndex.push({ id: nextNodeId, x: xs, z: zs })
    synNodeIds.set(localId, nextNodeId)
    nextNodeId++
  }
}

// Emit edges as graph records, skipping segments already covered (a segment
// whose true midpoint has a graph edge within ~40 m is likely already there;
// this makes the script idempotent â€” a re-run re-adds nothing).
const edgeMids = []
for (const e of graph.edges) {
  if (e.pts.length < 2) continue
  // True chord midpoint: for the two-point edges this synthesis writes it is
  // exact, and for the longer originals it is close enough to detect overlap.
  const mid = [
    (e.pts[0][0] + e.pts[e.pts.length - 1][0]) / 2,
    (e.pts[0][1] + e.pts[e.pts.length - 1][1]) / 2,
  ]
  edgeMids.push({ x: mid[0], z: -mid[1] })
}
const hasNearbyEdge = (x, z) => {
  for (const m of edgeMids) {
    if (Math.hypot(m.x - x, m.z - z) < 40) return true
  }
  return false
}

let added = 0
for (const { name, segments } of synthEdges) {
  for (const seg of segments) {
    const aId = synNodeIds.get(seg.a)
    const bId = synNodeIds.get(seg.b)
    if (aId === undefined || bId === undefined || aId === bId) continue
    const mx = (seg.aPos.x + seg.bPos.x) / 2
    const mz = (seg.aPos.z + seg.bPos.z) / 2
    if (hasNearbyEdge(mx, mz)) continue
    graph.edges.push({
      id: nextEdgeId,
      pid: 900000 + nextEdgeId,
      a: aId,
      b: bId,
      name,
      kind: 'street',
      drivable: true,
      width: 16.0,
      lanes: 2,
      park_lanes: 1,
      oneway: 0,
      speed_mph: 25,
      length: +seg.len.toFixed(2),
      pts: [[seg.aPos.x, -seg.aPos.z], [seg.bPos.x, -seg.bPos.z]],
    })
    nextEdgeId++
    added++
  }
}

// Node degree table.
const degree = new Map()
for (const e of graph.edges) {
  degree.set(e.a, (degree.get(e.a) ?? 0) + 1)
  degree.set(e.b, (degree.get(e.b) ?? 0) + 1)
}
graph.nodes = Array.from({ length: nextNodeId }, (_, i) => nodeById.get(i))
graph.node_degree = Object.fromEntries(degree)

// ---- Merge into walk_graph.json ---------------------------------------------
const walk = JSON.parse(readFileSync('public/models/manhattan/streets/walk_graph.json', 'utf8'))
const wNodeById = new Map(walk.nodes.map((n, i) => [i, n]))
let wNextNode = walk.nodes.length
let wNextLane = walk.lanes.length
const wNodeIndex = []
for (let i = 0; i < walk.nodes.length; i++) {
  const [nx, ny] = walk.nodes[i]
  wNodeIndex.push({ id: i, x: nx, z: -ny })
}
const wSynNode = new Map()
for (const [key, localId] of nodes) {
  const [xs, zs] = key.split(',').map((v) => Number(v) / 10)
  let near = null
  let nearD = 25
  for (const n of wNodeIndex) {
    const d = Math.hypot(n.x - xs, n.z - zs)
    if (d < nearD) {
      nearD = d
      near = n.id
    }
  }
  if (near !== null) wSynNode.set(localId, near)
  else {
    wNodeById.set(wNextNode, [xs, -zs])
    wNodeIndex.push({ id: wNextNode, x: xs, z: zs })
    wSynNode.set(localId, wNextNode)
    wNextNode++
  }
}
// Walk lanes: both sides get the full width (the pedestrian sim reads wl for
// one travel direction and wr for the other), and a midpoint guard keeps the
// merge idempotent.
const wLaneMids = walk.lanes.map((l) => {
  const mid = [
    (l.pts[0][0] + l.pts[l.pts.length - 1][0]) / 2,
    (l.pts[0][1] + l.pts[l.pts.length - 1][1]) / 2,
  ]
  return { x: mid[0], z: -mid[1] }
})
const wHasNearby = (x, z) => wLaneMids.some((m) => Math.hypot(m.x - x, m.z - z) < 40)

let wAdded = 0
for (const { name, segments } of synthEdges) {
  for (const seg of segments) {
    const aId = wSynNode.get(seg.a)
    const bId = wSynNode.get(seg.b)
    if (aId === undefined || bId === undefined || aId === bId) continue
    const mx = (seg.aPos.x + seg.bPos.x) / 2
    const mz = (seg.aPos.z + seg.bPos.z) / 2
    if (wHasNearby(mx, mz)) continue
    walk.lanes.push({
      id: wNextLane,
      a: aId,
      b: bId,
      w: 3.6,
      wl: [3, 3, 3, 3, 3],
      wr: [3, 3, 3, 3, 3],
      len: +seg.len.toFixed(2),
      nm: name,
      pts: [[seg.aPos.x, -seg.aPos.z], [seg.bPos.x, -seg.bPos.z]],
    })
    wLaneMids.push({ x: mx, z: mz })
    wNextLane++
    wAdded++
  }
}
walk.nodes = Array.from({ length: wNextNode }, (_, i) => wNodeById.get(i))

// ---- Regenerate the subway footfall field -----------------------------------
// The demand model adds station footfall on top of floor area; the field is
// generated from the entrance layout (entrances per 200 m cell), which is the
// same fact the kiosks render. Deterministic, so regeneration is stable.
{
  const subway = JSON.parse(readFileSync('public/models/manhattan/subway/subway.json', 'utf8'))
  const cells = {}
  const stations = new Set()
  for (const e of subway.entrances) {
    const k = `${Math.floor(e.x / 200)},${Math.floor(e.y / 200)}`
    cells[k] = (cells[k] ?? 0) + 1
    stations.add(e.stop)
  }
  const footfall = {
    generated_by: 'scripts/repair-west-midtown-graph.mjs',
    source: 'public/models/manhattan/subway/subway.json',
    cell_m: 200,
    stations: stations.size,
    cells,
  }
  writeFileSync('public/models/manhattan/subway/footfall.json', JSON.stringify(footfall))
  console.log(`subway footfall: ${Object.keys(cells).length} cells, ${stations.size} stations`)
}

writeFileSync('public/models/manhattan/streets/street_graph.json', JSON.stringify(graph))
writeFileSync('public/models/manhattan/streets/walk_graph.json', JSON.stringify(walk))

console.log(`street_graph: +${added} edges (now ${graph.edges.length}), ${nextNodeId} nodes`)
console.log(`walk_graph: +${wAdded} lanes (now ${walk.lanes.length}), ${wNextNode} nodes`)
