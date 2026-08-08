import { describe, expect, it } from 'vitest'
import { buildLaneGraph } from '../../city/street-nav.js'
import {
  STOP_LINE,
  SIGNAL_CYCLE,
  SIGNAL_GREEN,
  SIGNAL_AMBER,
  buildIntersections,
  conflictsFor,
} from '../../city/intersections.js'
import { createGraphLaneProvider } from './graph-lane-provider'
import { aabb } from '../collision'
import { AabbVehicleWorld } from './vehicle-collision'
import {
  createVehicleSim,
  stepVehicleSim,
  type PlayerVehicleInput,
} from './vehicle-control'
import { spawnVehicle, parkedMotion } from './vehicle-entities'
import { laneLength, setLaneTable, type Lane } from './vehicle-lanes'
import { installLaneProvider } from './vehicle-session'

const DT = 1 / 120
const NO_INPUT: PlayerVehicleInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  horn: false,
  interact: false,
}
const FLOOR = aabb(400, 0, 400, 2000, 1, 2000)
const world = new AabbVehicleWorld([FLOOR])

/** Same synthetic cross as intersections.test.ts: node 1, four 100 m edges. */
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

function buildProvider() {
  const graph = buildLaneGraph(crossGraph())
  const provider = createGraphLaneProvider(graph.lanes, graph.grid)
  setLaneTable(provider.lanes)
  return { graph, provider }
}

function nodeIntersection(graph: ReturnType<typeof buildLaneGraph>, node: number) {
  const nodeLanes = new Map<number, number[]>()
  for (const l of graph.lanes) {
    const list = nodeLanes.get(l.from) ?? []
    list.push(l.id)
    nodeLanes.set(l.from, list)
  }
  return buildIntersections(null, graph.lanes, nodeLanes).byNode.get(node)!
}

/** Point on a straight lane at `distance` metres along travel. */
function pointAt(lane: Lane, distance: number): { pos: { x: number; y: number; z: number }; heading: number } {
  const a = lane.points[0]
  const b = lane.points[lane.points.length - 1]
  const t = Math.min(1, Math.max(0, distance / laneLength(lane)))
  return {
    pos: { x: a.x + t * (b.x - a.x), y: 0.5, z: a.z + t * (b.z - a.z) },
    heading: Math.atan2(b.x - a.x, b.z - a.z),
  }
}

describe('graph lane provider — M3 integration', () => {
  it('bakes signals and junction data for every approach of the cross', () => {
    const { graph, provider } = buildProvider()
    const record = nodeIntersection(graph, 1)
    const approaches = graph.lanes.filter((l) => l.signalled && l.to === 1)
    expect(approaches.length).toBe(8)
    for (const a of approaches) {
      const lane = provider.lanes[String(a.id)]
      expect(lane).toBeDefined()
      expect(lane.signalled).toBe(true)
      expect(lane.axis).toBe(a.axis)
      expect(lane.signal).toEqual({
        cycle: SIGNAL_CYCLE,
        green: SIGNAL_GREEN,
        amber: SIGNAL_AMBER,
        offset: record.program.offset,
      })
      const index = record.approaches.indexOf(a.id)
      const crossing = conflictsFor(record, index, false)
      expect(lane.junction).toBeDefined()
      expect(lane.junction!.id).toBe(1)
      expect([...lane.junction!.crossingLaneIds].sort()).toEqual(
        crossing.map((j) => String(record.approaches[j])).sort(),
      )
      expect(lane.junction!.opposingLaneIds).toHaveLength(2)
      for (const id of lane.junction!.opposingLaneIds) {
        const other = record.approaches.map((x) => String(x)).indexOf(id)
        expect(other).toBeGreaterThanOrEqual(0)
        expect(Math.abs(record.headings[other] - record.headings[index])).toBeGreaterThan(2.4)
      }
    }
  })

  it('leaves non-approach lanes unsignalled and unarbitrated', () => {
    const { graph, provider } = buildProvider()
    for (const l of graph.lanes) {
      if (l.signalled && l.to === 1) continue
      const lane = provider.lanes[String(l.id)]
      expect(lane.signalled).toBeUndefined()
      expect(lane.signal).toBeUndefined()
      expect(lane.junction).toBeUndefined()
    }
  })

  it('arbitrates end to end: a green car yields to a car committed across the box', () => {
    const { graph, provider } = buildProvider()
    const sim = createVehicleSim(0)
    installLaneProvider(sim, provider)

    const approaches = graph.lanes.filter((l) => l.signalled && l.to === 1)
    const laneA = provider.lanes[String(approaches.find((a) => a.axis === 0)!.id)]
    const laneB = provider.lanes[String(approaches.find((a) => a.axis === 1)!.id)]

    const spawn = (lane: Lane, distance: number, speed: number) => {
      const { pos, heading } = pointAt(lane, distance)
      const car = spawnVehicle(sim.registry, 'taxi', { pos, heading }, 'AI_CONTROLLED', parkedMotion())
      car.ai = { laneId: lane.id, distance, targetSpeed: lane.speedLimit * 0.8, reactionClock: 0 }
      car.motion.speed = speed
      return car
    }

    const a = spawn(laneA, 84, 10)
    const b = spawn(laneB, 95, 10)

    const tracked = new Map<number, { initial: string; max: number }>([
      [a.id, { initial: laneA.id, max: 84 }],
      [b.id, { initial: laneB.id, max: 95 }],
    ])
    const at = (id: number) => {
      const e = sim.registry.vehicles.get(id)!
      return { laneId: e.ai!.laneId, distance: e.ai!.distance, max: tracked.get(id)!.max }
    }
    const collisions = () =>
      sim.events.filter((e) => e.type === 'collision-vehicle').length

    const runFor = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        stepVehicleSim(sim, world, NO_INPUT, DT, 8)
        for (const id of tracked.keys()) {
          const e = sim.registry.vehicles.get(id)!
          const t = tracked.get(id)!
          if (e.ai!.laneId === t.initial) t.max = Math.max(t.max, e.ai!.distance)
        }
      }
    }

    runFor(1)
    const a1 = at(a.id)
    const b1 = at(b.id)
    expect(b1.max).toBeGreaterThan(laneLength(laneB) - STOP_LINE)
    expect(a1.distance).toBeLessThan(laneLength(laneA) - STOP_LINE)
    expect(collisions()).toBe(0)

    runFor(4)
    const a2 = at(a.id)
    expect(a2.max).toBeGreaterThan(laneLength(laneA) - STOP_LINE)
    expect(collisions()).toBe(0)
  })
})
