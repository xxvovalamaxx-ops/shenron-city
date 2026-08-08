import { describe, expect, it } from 'vitest'
import { buildLaneGraph } from './street-nav.js'
import {
  buildIntersections,
  classifyTurn,
  signalColorAt,
  STOP_LINE,
  SIGNAL_CYCLE,
  SIGNAL_GREEN,
  SIGNAL_AMBER,
} from './intersections.js'
import type { IntersectionRecord } from './intersections.js'

/** A synthetic two-way cross: vertical street x=100, horizontal street
 * y=100, meeting at node 1. Every edge is a 4-lane, 13.4 m wide street. */
function crossGraph(): Record<string, unknown> {
  const nodes = [
    [100, 0],
    [100, 100],
    [100, 200],
    [0, 100],
    [200, 100],
  ]
  const edges = [
    { id: 'e0', a: 0, b: 1, pts: [[100, 0], [100, 100]] },
    { id: 'e1', a: 1, b: 2, pts: [[100, 100], [100, 200]] },
    { id: 'e2', a: 3, b: 1, pts: [[0, 100], [100, 100]] },
    { id: 'e3', a: 1, b: 4, pts: [[100, 100], [200, 100]] },
  ]
  return {
    nodes,
    node_degree: [1, 4, 1, 1, 1],
    edges: edges.map((e) => ({
      ...e,
      drivable: 1,
      kind: 'street',
      oneway: 0,
      lanes: 4,
      width: 13.4,
      park_lanes: 1,
      speed_mph: 25,
      length: 100,
      name: 'test street',
    })),
  }
}

function buildCross() {
  const graph = buildLaneGraph(crossGraph())
  return {
    graph,
    ix: buildIntersections(graph.nodes, graph.lanes, graph.nodeLanes),
  }
}

describe('buildIntersections', () => {
  it('finds the one signalled intersection with all approach lanes', () => {
    const { ix } = buildCross()
    expect(ix.list.length).toBe(1)
    const record = ix.list[0]
    expect(record.node).toBe(1)
    expect(record.x).toBe(100)
    expect(record.y).toBe(100)
    expect(ix.byNode.get(1)).toBe(record)
    // The approaches are the lanes that end at the node. A 4-lane two-way
    // cross feeds two parallel lanes per direction, so eight lanes in four
    // distinct travel headings: south, east, north and west.
    expect(record.approaches.length).toBe(8)
    const lanes = buildCross().graph.lanes
    const unique = [...new Set(record.approaches.map((id) => lanes[id].heading))]
    expect(unique.length).toBe(4)
    for (const expected of [-Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
      expect(unique.some((h) => Math.abs(h - expected) < 1e-9)).toBe(true)
    }
  })

  it('sets the stop line and a two-phase program', () => {
    const { ix } = buildCross()
    const record = ix.list[0]
    expect(record.stopLine).toBe(STOP_LINE)
    expect(record.program.cycle).toBe(SIGNAL_CYCLE)
    expect(record.program.green).toBe(SIGNAL_GREEN)
    expect(record.program.amber).toBe(SIGNAL_AMBER)
    expect(record.program.offset).toBeGreaterThanOrEqual(0)
  })

  it('conflicts only crossing lanes, not opposites', () => {
    const { ix } = buildCross()
    // Two parallel lanes per direction: every north-bound lane crosses every
    // east- and west-bound lane (2×2×2 = 8), and the south-bound lanes the
    // same, for sixteen crossing lane pairs in total. Opposing lanes on the
    // same street never conflict.
    expect(ix.list[0].conflicts.length).toBe(16)
  })

  it('returns an empty model for an empty lane set', () => {
    const { list, byNode } = buildIntersections([], [], new Map())
    expect(list.length).toBe(0)
    expect(byNode.size).toBe(0)
  })
})

describe('signalColorAt', () => {
  function handMade(offset: number): IntersectionRecord {
    return {
      node: 0,
      x: 0,
      y: 0,
      approaches: [],
      stopLine: STOP_LINE,
      boxRadius: STOP_LINE + 4.5,
      conflicts: [],
      program: { cycle: SIGNAL_CYCLE, green: SIGNAL_GREEN, amber: SIGNAL_AMBER, offset },
    }
  }

  it('alternates the two axes across the cycle', () => {
    const ix = handMade(0)
    expect(signalColorAt(ix, 0, 0)).toBe('green')
    expect(signalColorAt(ix, 1, 0)).toBe('red')
    expect(signalColorAt(ix, 0, SIGNAL_CYCLE / 2)).toBe('red')
    expect(signalColorAt(ix, 1, SIGNAL_CYCLE / 2)).toBe('green')
    // Wraps past the end of the cycle.
    expect(signalColorAt(ix, 0, SIGNAL_CYCLE + 1)).toBe('green')
  })

  it('shows amber in the tail of the green half-cycle', () => {
    const ix = handMade(0)
    expect(signalColorAt(ix, 0, SIGNAL_GREEN - 0.1)).toBe('green')
    expect(signalColorAt(ix, 0, SIGNAL_GREEN + 1)).toBe('amber')
    expect(signalColorAt(ix, 1, SIGNAL_CYCLE / 2 + SIGNAL_GREEN + 1)).toBe('amber')
  })

  it('is a pure function of the clock', () => {
    const ix = handMade(13)
    for (const t of [0, 3, 11.5, 14, 25, 26.3]) {
      expect(signalColorAt(ix, 0, t)).toBe(signalColorAt(ix, 0, t))
    }
  })

  it('never blocks an unsignalled or unknown intersection', () => {
    expect(signalColorAt(null, 0, 0)).toBe('green')
    const ix = handMade(0)
    ix.program.cycle = SIGNAL_CYCLE
    expect(signalColorAt(ix, 0, 0)).toBe('green')
  })
})

describe('classifyTurn', () => {
  it('classifies straight, left, right and uturn', () => {
    expect(classifyTurn(0, 0.1)).toBe('straight')
    expect(classifyTurn(0, Math.PI / 2)).toBe('left')
    expect(classifyTurn(0, -Math.PI / 2)).toBe('right')
    expect(classifyTurn(0, Math.PI)).toBe('uturn')
    expect(classifyTurn(0, -Math.PI + 0.1)).toBe('uturn')
  })
})
