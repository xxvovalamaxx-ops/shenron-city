/**
 * The street network for the radar, the pause map and the GPS.
 *
 * Source: the LION centreline graph that the traffic simulation already
 * drives (`/models/manhattan/streets/street_graph.json`, written by
 * scripts/phase2/47_build_streets.py) — so the radar draws the streets the
 * cars are actually on. Projection: x east, y north in metres; world z = -y.
 *
 * `parseStreetGraph` is pure (tested); `loadStreetData` fetches through
 * three's FileLoader — the same same-origin loader path every GLB takes — and
 * caches the parse for the session. It is the browser's HTTP cache that
 * serves the file: traffic has already loaded it by the time the HUD asks.
 */
import { FileLoader } from 'three'
import { buildRoadGraph, type RoadGraph } from './route'

export const STREET_GRAPH_URL = '/models/manhattan/streets/street_graph.json'

/** Drawing classes, from least to most important. */
export type RoadClass = 'path' | 'minor' | 'street' | 'avenue' | 'highway' | 'bridge' | 'tunnel'

export interface RawStreetEdge {
  a: number
  b: number
  name?: string
  kind?: string
  drivable?: boolean
  width?: number
  oneway?: number
  length?: number
  pts?: Array<[number, number]>
}

export interface RawStreetGraph {
  nodes: Array<[number, number]>
  edges: RawStreetEdge[]
}

export interface StreetEdge {
  a: number
  b: number
  cls: RoadClass
  /** Kerb-to-kerb width, metres. */
  width: number
  oneway: number
  drivable: boolean
  length: number
  name: string
  /** World polyline, interleaved x, z. */
  pts: Float32Array
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface StreetData {
  nodes: Array<[number, number]>
  edges: StreetEdge[]
  graph: RoadGraph
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** Edge indices by INDEX_CELL-metre cell, key `${cx},${cz}`. */
  cells: Map<string, number[]>
}

/** Spatial index cell, metres. Also the radar's finest tile size. */
export const INDEX_CELL = 256

export function roadClass(kind: string | undefined, width: number, drivable: boolean): RoadClass {
  switch (kind) {
    case 'highway':
      return 'highway'
    case 'bridge':
      return drivable ? 'bridge' : 'path'
    case 'tunnel':
      return 'tunnel'
    case 'path':
    case 'step_street':
      return 'path'
    case 'alley':
    case 'driveway':
    case 'uturn':
      return 'minor'
    default:
      if (!drivable) return 'path'
      return width >= 15 ? 'avenue' : 'street'
  }
}

export function cellKey(cx: number, cz: number): string {
  return `${cx},${cz}`
}

export function parseStreetGraph(raw: RawStreetGraph): StreetData {
  const nodes: Array<[number, number]> = raw.nodes.map(([x, y]) => [x, -y])
  const edges: StreetEdge[] = []
  const cells = new Map<string, number[]>()
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const e of raw.edges) {
    const src = e.pts && e.pts.length >= 2 ? e.pts : null
    const a = nodes[e.a]
    const b = nodes[e.b]
    if (!a || !b) continue
    const coords = src ?? [
      [a[0], -a[1]],
      [b[0], -b[1]],
    ]
    const pts = new Float32Array(coords.length * 2)
    let ex0 = Infinity
    let ex1 = -Infinity
    let ez0 = Infinity
    let ez1 = -Infinity
    coords.forEach(([x, y], i) => {
      const z = -y
      pts[i * 2] = x
      pts[i * 2 + 1] = z
      if (x < ex0) ex0 = x
      if (x > ex1) ex1 = x
      if (z < ez0) ez0 = z
      if (z > ez1) ez1 = z
    })
    const drivable = e.drivable !== false
    const width = Number.isFinite(e.width) ? (e.width as number) : 8
    const length = Number.isFinite(e.length) ? (e.length as number) : Math.hypot(b[0] - a[0], b[1] - a[1])
    const index = edges.length
    edges.push({
      a: e.a,
      b: e.b,
      cls: roadClass(e.kind, width, drivable),
      width,
      oneway: e.oneway === 1 || e.oneway === -1 ? e.oneway : 0,
      drivable,
      length,
      name: e.name ?? '',
      pts,
      minX: ex0,
      maxX: ex1,
      minZ: ez0,
      maxZ: ez1,
    })
    if (ex0 < minX) minX = ex0
    if (ex1 > maxX) maxX = ex1
    if (ez0 < minZ) minZ = ez0
    if (ez1 > maxZ) maxZ = ez1
    const pad = width / 2
    for (let cx = Math.floor((ex0 - pad) / INDEX_CELL); cx <= Math.floor((ex1 + pad) / INDEX_CELL); cx++) {
      for (let cz = Math.floor((ez0 - pad) / INDEX_CELL); cz <= Math.floor((ez1 + pad) / INDEX_CELL); cz++) {
        const key = cellKey(cx, cz)
        let list = cells.get(key)
        if (!list) {
          list = []
          cells.set(key, list)
        }
        list.push(index)
      }
    }
  }
  const graph = buildRoadGraph(
    nodes,
    edges.map((e) => ({
      a: e.a,
      b: e.b,
      length: e.length,
      oneway: e.oneway,
      // Tunnels and bridges are real roads; footpaths are for walking only.
      drivable: e.drivable && e.cls !== 'path',
    })),
  )
  return { nodes, edges, graph, bounds: { minX, maxX, minZ, maxZ }, cells }
}

/** Squared distance from (px, pz) to segment (ax, az)–(bx, bz). */
function segmentDistance2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const qx = ax + dx * t - px
  const qz = az + dz * t - pz
  return qx * qx + qz * qz
}

/**
 * The street the point is on or beside — for the location readout. Prefers
 * named, drivable streets; `maxDistance` keeps a park path from naming
 * itself after the avenue a block away.
 */
export function nearestStreet(data: StreetData, x: number, z: number, maxDistance = 40): StreetEdge | null {
  const cx = Math.floor(x / INDEX_CELL)
  const cz = Math.floor(z / INDEX_CELL)
  let best: StreetEdge | null = null
  let bestD = maxDistance * maxDistance
  const seen = new Set<number>()
  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      const list = data.cells.get(cellKey(cx + ox, cz + oz))
      if (!list) continue
      for (const index of list) {
        if (seen.has(index)) continue
        seen.add(index)
        const e = data.edges[index]
        if (!e.name || e.cls === 'path' || e.cls === 'tunnel') continue
        const pts = e.pts
        for (let i = 0; i + 3 < pts.length; i += 2) {
          // Width counts: standing on a broad avenue's kerb is still the avenue.
          const d = Math.max(0, Math.sqrt(segmentDistance2(x, z, pts[i], pts[i + 1], pts[i + 2], pts[i + 3])) - e.width / 2)
          if (d * d < bestD) {
            bestD = d * d
            best = e
          }
        }
      }
    }
  }
  return best
}

let pending: Promise<StreetData> | null = null
let loaded: StreetData | null = null

/** The parsed street data, if it has arrived. */
export function streetDataNow(): StreetData | null {
  return loaded
}

/** Load (once) and parse the street graph. */
export function loadStreetData(): Promise<StreetData> {
  if (loaded) return Promise.resolve(loaded)
  if (!pending) {
    const loader = new FileLoader()
    loader.setResponseType('json')
    pending = loader
      .loadAsync(STREET_GRAPH_URL)
      .then((raw) => {
        loaded = parseStreetGraph(raw as unknown as RawStreetGraph)
        return loaded
      })
      .catch((error: unknown) => {
        pending = null
        throw error
      })
  }
  return pending
}
