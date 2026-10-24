/**
 * The GPS router: A* over the LION graph, one-way rules for drivers.
 */
import { describe, expect, it } from 'vitest'
import { buildRoadGraph, findRoute, nearestNode, type RouteEdgeInput } from './route'

/**
 * A 4×4 grid, 100 m spacing. Node id = row * 4 + col, x = col * 100,
 * z = row * 100.
 */
function grid(): { nodes: Array<[number, number]>; edges: RouteEdgeInput[] } {
  const nodes: Array<[number, number]> = []
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) nodes.push([c * 100, r * 100])
  const edges: RouteEdgeInput[] = []
  const id = (r: number, c: number) => r * 4 + c
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (c < 3) edges.push({ a: id(r, c), b: id(r, c + 1), length: 100, oneway: 0, drivable: true })
      if (r < 3) edges.push({ a: id(r, c), b: id(r + 1, c), length: 100, oneway: 0, drivable: true })
    }
  }
  return { nodes, edges }
}

describe('findRoute', () => {
  it('finds a shortest Manhattan-distance route across a grid', () => {
    const { nodes, edges } = grid()
    const g = buildRoadGraph(nodes, edges)
    const route = findRoute(g, 0, 15)!
    expect(route.length).toBe(600)
    expect(route.nodes[0]).toBe(0)
    expect(route.nodes[route.nodes.length - 1]).toBe(15)
    expect(route.edges.length).toBe(route.nodes.length - 1)
    // Every hop is a real edge between consecutive nodes.
    route.edges.forEach((e, i) => {
      const edge = edges[e]
      const pair = [route.nodes[i], route.nodes[i + 1]].sort()
      expect([edge.a, edge.b].sort()).toEqual(pair)
    })
  })

  it('is trivial from a node to itself', () => {
    const { nodes, edges } = grid()
    expect(findRoute(buildRoadGraph(nodes, edges), 5, 5)).toEqual({ nodes: [5], edges: [], length: 0 })
  })

  it('prefers the cheaper road, not the fewer hops', () => {
    const nodes: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [50, 60],
    ]
    const edges: RouteEdgeInput[] = [
      { a: 0, b: 1, length: 500, oneway: 0, drivable: true }, // a long detour of a road
      { a: 0, b: 2, length: 80, oneway: 0, drivable: true },
      { a: 2, b: 1, length: 80, oneway: 0, drivable: true },
    ]
    const route = findRoute(buildRoadGraph(nodes, edges), 0, 1)!
    expect(route.nodes).toEqual([0, 2, 1])
    expect(route.length).toBe(160)
  })

  it('lets pedestrians walk a one-way street the wrong way, but not drivers', () => {
    const nodes: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [100, 100],
    ]
    const edges: RouteEdgeInput[] = [
      { a: 0, b: 1, length: 100, oneway: -1, drivable: true }, // b → a only
      { a: 0, b: 2, length: 150, oneway: 0, drivable: true },
      { a: 2, b: 1, length: 150, oneway: 0, drivable: true },
    ]
    const g = buildRoadGraph(nodes, edges)
    expect(findRoute(g, 0, 1)!.length).toBe(100)
    const driving = findRoute(g, 0, 1, { respectOneWay: true })!
    expect(driving.nodes).toEqual([0, 2, 1])
    expect(driving.length).toBe(300)
    // The other way round the one-way is legal.
    expect(findRoute(g, 1, 0, { respectOneWay: true })!.length).toBe(100)
  })

  it('keeps drivers off footpaths', () => {
    const nodes: Array<[number, number]> = [
      [0, 0],
      [100, 0],
    ]
    const edges: RouteEdgeInput[] = [{ a: 0, b: 1, length: 100, oneway: 0, drivable: false }]
    const g = buildRoadGraph(nodes, edges)
    expect(findRoute(g, 0, 1)).not.toBeNull()
    expect(findRoute(g, 0, 1, { respectOneWay: true })).toBeNull()
  })

  it('returns null for an unreachable goal or bad ids', () => {
    const nodes: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [500, 500],
    ]
    const g = buildRoadGraph(nodes, [{ a: 0, b: 1, length: 100, oneway: 0, drivable: true }])
    expect(findRoute(g, 0, 2)).toBeNull()
    expect(findRoute(g, -1, 2)).toBeNull()
    expect(findRoute(g, 0, 99)).toBeNull()
  })

  it('skips malformed edges instead of corrupting the adjacency', () => {
    const nodes: Array<[number, number]> = [
      [0, 0],
      [100, 0],
    ]
    const g = buildRoadGraph(nodes, [
      { a: 0, b: 7, length: 10, oneway: 0, drivable: true },
      { a: 1, b: 1, length: 10, oneway: 0, drivable: true },
      { a: 0, b: 1, length: 100, oneway: 0, drivable: true },
    ])
    expect(g.offsets[g.nodeCount]).toBe(2)
    expect(findRoute(g, 0, 1)!.length).toBe(100)
  })
})

describe('nearestNode', () => {
  it('finds the closest node, optionally only among drivable ones', () => {
    const nodes: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [100, 0],
    ]
    const edges: RouteEdgeInput[] = [
      { a: 0, b: 1, length: 10, oneway: 0, drivable: false },
      { a: 0, b: 2, length: 100, oneway: 0, drivable: true },
    ]
    const g = buildRoadGraph(nodes, edges)
    expect(nearestNode(g, 12, 3)).toBe(1)
    // Node 1 only touches a footpath.
    expect(nearestNode(g, 12, 3, true)).toBe(0)
  })
})
