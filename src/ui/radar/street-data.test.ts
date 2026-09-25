import { describe, expect, it } from 'vitest'
import { INDEX_CELL, cellKey, nearestStreet, parseStreetGraph, roadClass, type RawStreetGraph } from './street-data'
import { findRoute } from './route'
import { routePolyline } from './gps'

/** Local metres, x east / y north, as the LION export writes them. */
const RAW: RawStreetGraph = {
  nodes: [
    [0, 0],
    [0, 100],
    [100, 100],
  ],
  edges: [
    {
      a: 0,
      b: 1,
      name: '5 AVE',
      kind: 'street',
      drivable: true,
      width: 16.5,
      oneway: -1,
      length: 100,
      pts: [
        [0, 0],
        [0, 50],
        [0, 100],
      ],
    },
    { a: 1, b: 2, name: 'W 49 ST', kind: 'street', drivable: true, width: 9, oneway: 1, length: 100 },
    { a: 0, b: 2, name: '', kind: 'path', drivable: false, width: 4, oneway: 0, length: 150 },
  ],
}

describe('parseStreetGraph', () => {
  const data = parseStreetGraph(RAW)

  it('projects into world space: z is minus north', () => {
    expect(data.nodes[1]).toEqual([0, -100])
    expect(Array.from(data.edges[0].pts)).toEqual([0, -0, 0, -50, 0, -100])
    expect(data.bounds.minZ).toBe(-100)
    expect(data.bounds.maxX).toBe(100)
  })

  it('classifies roads for drawing', () => {
    expect(data.edges[0].cls).toBe('avenue')
    expect(data.edges[1].cls).toBe('street')
    expect(data.edges[2].cls).toBe('path')
    expect(roadClass('highway', 20, true)).toBe('highway')
    expect(roadClass('bridge', 20, false)).toBe('path')
    expect(roadClass('alley', 5, true)).toBe('minor')
  })

  it('falls back to the node positions for an edge without geometry', () => {
    expect(Array.from(data.edges[1].pts)).toEqual([0, -100, 100, -100])
  })

  it('indexes every edge into the cells it crosses', () => {
    const cell = data.cells.get(cellKey(0, Math.floor(-50 / INDEX_CELL)))
    expect(cell).toContain(0)
  })

  it('builds a routable graph that keeps drivers off footpaths and one-ways', () => {
    // Walking: straight along the path.
    expect(findRoute(data.graph, 0, 2)!.length).toBe(150)
    // Driving 0 → 2: the path is out, and 5 AVE runs 1 → 0 only.
    expect(findRoute(data.graph, 0, 2, { respectOneWay: true })).toBeNull()
    expect(findRoute(data.graph, 2, 0, { respectOneWay: true })).toBeNull()
  })

  it('names the street you are standing beside', () => {
    expect(nearestStreet(data, 6, -40)?.name).toBe('5 AVE')
    expect(nearestStreet(data, 60, -104)?.name).toBe('W 49 ST')
    expect(nearestStreet(data, 400, 400)).toBeNull()
  })
})

describe('routePolyline', () => {
  it('follows each edge’s own geometry in the direction of travel', () => {
    const data = parseStreetGraph(RAW)
    const route = findRoute(data.graph, 1, 0)!
    const line = Array.from(routePolyline(data, route.nodes, route.edges, { x: 1, z: -101 }, { x: 1, z: 1 }))
    // Starts at the player, walks 5 AVE from node 1 back to node 0, ends at the goal.
    expect(line.slice(0, 2)).toEqual([1, -101])
    expect(line.slice(2, 8)).toEqual([0, -100, 0, -50, 0, -0])
    expect(line.slice(-2)).toEqual([1, 1])
  })
})
