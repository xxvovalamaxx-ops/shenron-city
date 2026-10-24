import { describe, expect, it } from 'vitest'
import { parseStreetGraph, type RawStreetGraph } from '../../ui/radar/street-data'
import { findRoute } from '../../ui/radar/route'
import {
  buildMissionCatalog,
  cornerOf,
  hash01,
  nodeAtRoadDistance,
  roadDistances,
  samplePolyline,
} from './mission-catalog'

/**
 * A 12 x 12 street grid with 100 m blocks, two-way, 12 m wide. Raw graphs
 * are in the city's local plane (y north); parseStreetGraph maps y → -z.
 */
function gridCity(n = 12, block = 100): RawStreetGraph {
  const nodes: Array<[number, number]> = []
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) nodes.push([c * block, r * block])
  const edges: RawStreetGraph['edges'] = []
  const id = (r: number, c: number) => r * n + c
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (c < n - 1) edges.push({ a: id(r, c), b: id(r, c + 1), name: `Street ${r}`, kind: 'street', width: 12, length: block })
      if (r < n - 1) edges.push({ a: id(r, c), b: id(r + 1, c), name: `Avenue ${c}`, kind: 'avenue', width: 12, length: block })
    }
  }
  return { nodes, edges }
}

describe('mission catalog', () => {
  const data = parseStreetGraph(gridCity())

  it('measures road distance, not straight-line distance', () => {
    const dist = roadDistances(data.graph, 0, 10000, false)
    // Diagonal neighbour on a grid is two blocks of road away.
    expect(dist[13]).toBe(200)
    expect(dist[143]).toBe(2200)
  })

  it('stops the search at the distance cap', () => {
    const dist = roadDistances(data.graph, 0, 250, false)
    expect(Number.isFinite(dist[143])).toBe(false)
  })

  it('picks a node inside the requested road-distance band, deterministically', () => {
    const a = nodeAtRoadDistance(data.graph, 0, 800, 'seed', true)!
    const b = nodeAtRoadDistance(data.graph, 0, 800, 'seed', true)!
    expect(a).toBe(b)
    const d = roadDistances(data.graph, 0, 5000, true)[a]
    expect(d).toBeGreaterThanOrEqual(800 * 0.85)
    expect(d).toBeLessThanOrEqual(800 * 1.15)
  })

  it('honours a direction bias when the grid allows it', () => {
    const centre = 6 * 12 + 6
    const east = nodeAtRoadDistance(data.graph, centre, 300, 'x', false, { x: 1, z: 0 })!
    expect(data.graph.nodeX[east]).toBeGreaterThan(data.graph.nodeX[centre])
  })

  it('puts pick-ups on a street corner, off the carriageway', () => {
    const centre = 6 * 12 + 6
    const corner = cornerOf(data, centre)
    const dx = Math.abs(corner.x - data.graph.nodeX[centre])
    const dz = Math.abs(corner.z - data.graph.nodeZ[centre])
    // Past the 6 m half-width of both streets: on the pavement.
    expect(dx).toBeGreaterThan(6)
    expect(dz).toBeGreaterThan(6)
  })

  it('samples a polyline at even spacing and ends on the end point', () => {
    const line = new Float32Array([0, 0, 600, 0, 1100, 0])
    const pts = samplePolyline(line, 300)
    expect(pts.map((p) => Math.round(p.x))).toEqual([300, 600, 900, 1100])
    // A last gap shorter than about a third of the spacing folds into the finish.
    expect(samplePolyline(new Float32Array([0, 0, 1000, 0]), 300).map((p) => Math.round(p.x))).toEqual([300, 600, 1000])
  })

  it('lays out all four jobs with reachable destinations', () => {
    const anchor = { x: data.graph.nodeX[0] + 5, z: data.graph.nodeZ[0] + 5 }
    const jobs = buildMissionCatalog(data, anchor, { x: 1, z: -1 })
    expect(jobs.map((j) => j.id)).toEqual(['wheels', 'sprint', 'heat', 'fare'])
    for (const job of jobs) {
      expect(job.reward).toBeGreaterThan(0)
      expect(job.objectives.length).toBeGreaterThan(0)
    }
    const sprint = jobs.find((j) => j.id === 'sprint')!
    const race = sprint.objectives[1]
    expect(race.kind).toBe('checkpoints')
    if (race.kind === 'checkpoints') expect(race.points.length).toBeGreaterThan(4)
  })

  it('is deterministic for the same city and anchor', () => {
    const anchor = { x: 300, z: -300 }
    expect(buildMissionCatalog(data, anchor, { x: 0, z: -1 })).toEqual(
      buildMissionCatalog(data, anchor, { x: 0, z: -1 }),
    )
  })

  it('routes between catalog points exist', () => {
    const jobs = buildMissionCatalog(data, { x: 0, z: 0 }, { x: 1, z: -1 })
    const wheels = jobs.find((j) => j.id === 'wheels')!
    const drop = wheels.objectives[1]
    if (drop.kind !== 'drive-to') throw new Error('expected a drive-to objective')
    const g = data.graph
    let goal = -1
    for (let i = 0; i < g.nodeCount; i++) if (g.nodeX[i] === drop.at.x && g.nodeZ[i] === drop.at.z) goal = i
    expect(findRoute(g, 0, goal, { respectOneWay: true })).not.toBeNull()
  })

  it('hash01 is stable and in range', () => {
    expect(hash01('wheels:shop')).toBe(hash01('wheels:shop'))
    for (const s of ['a', 'b', 'heat:start', 'x'.repeat(40)]) {
      expect(hash01(s)).toBeGreaterThanOrEqual(0)
      expect(hash01(s)).toBeLessThan(1)
    }
  })
})
