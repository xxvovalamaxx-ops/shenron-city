/**
 * Intersection arbitration for the Phase 3A vehicle sim (M3).
 *
 * The arbiter is deterministic and shared with the LION traffic sim
 * (intersections.js): on green, a car still yields at its stop line while
 * a conflicting approach holds the box or is closer to its own line — the
 * closer car claims the box, ties broken by id — and a left-turning car
 * additionally yields to opposing through traffic. A car whose nose is
 * past its line is committed and runs. This arena pins those behaviours
 * on a synthetic 4-way where every approach is green at clock 0, so any
 * stop at a stop line is the arbiter's doing, not the signal's.
 */
import { describe, expect, it } from 'vitest'
import { aabb, type AABB } from '../collision'
import { AabbVehicleWorld } from './vehicle-collision'
import {
  createVehicleSim,
  stepVehicleSim,
  type PlayerVehicleInput,
  type SimEvent,
} from './vehicle-control'
import { spawnVehicle, parkedMotion } from './vehicle-entities'
import { LANES, type Lane } from './vehicle-lanes'

const DT = 1 / 120
const NO_INPUT: PlayerVehicleInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  horn: false,
  interact: false,
}

const GREEN = { cycle: 26, green: 11, amber: 2, offset: 0 }
const JUNCTION = { id: 1, boxRadius: 10.5 }

/** East-bound approach: travel +x, heading π/2, ends at the node (100, 0). */
const E_LANE: Lane = {
  id: 'e',
  loop: false,
  speedLimit: 13,
  laneWidth: 1.6,
  points: [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
  ],
  next: ['e-cont'],
  signalled: true,
  axis: 0,
  signal: GREEN,
  junction: { ...JUNCTION, crossingLaneIds: ['n'], opposingLaneIds: ['w'] },
}
/** East-bound approach that will turn left at the node onto `n-turn`. */
const E_LEFT: Lane = {
  ...E_LANE,
  id: 'e-left',
  next: ['n-turn'],
}
/** North-bound approach: travel +z, heading 0, ends at the node. */
const N_LANE: Lane = {
  id: 'n',
  loop: false,
  speedLimit: 13,
  laneWidth: 1.6,
  points: [
    { x: 100, z: -100 },
    { x: 100, z: 0 },
  ],
  next: ['n-cont'],
  signalled: true,
  axis: 0,
  signal: GREEN,
  junction: { ...JUNCTION, crossingLaneIds: ['e', 'e-left'], opposingLaneIds: [] },
}
/** Opposing through for the east approach: travel -x, heading -π/2. */
const W_LANE: Lane = {
  id: 'w',
  loop: false,
  speedLimit: 13,
  laneWidth: 1.6,
  points: [
    { x: 150, z: 0 },
    { x: 100, z: 0 },
  ],
  next: ['w-cont'],
  signalled: true,
  axis: 0,
  signal: GREEN,
  junction: { ...JUNCTION, crossingLaneIds: ['n'], opposingLaneIds: ['e', 'e-left'] },
}
const CONT_LANES: Lane[] = [
  { id: 'e-cont', loop: false, speedLimit: 13, laneWidth: 1.6, points: [{ x: 100, z: 0 }, { x: 200, z: 0 }] },
  { id: 'n-cont', loop: false, speedLimit: 13, laneWidth: 1.6, points: [{ x: 100, z: 0 }, { x: 100, z: 100 }] },
  { id: 'w-cont', loop: false, speedLimit: 13, laneWidth: 1.6, points: [{ x: 100, z: 0 }, { x: 50, z: 0 }] },
  { id: 'n-turn', loop: false, speedLimit: 13, laneWidth: 1.6, points: [{ x: 100, z: 0 }, { x: 100, z: -50 }] },
]
for (const lane of [E_LANE, E_LEFT, N_LANE, W_LANE, ...CONT_LANES]) {
  ;(LANES as Record<string, Lane>)[lane.id] = lane
}

const FLOOR: AABB = aabb(-200, 0, -200, 400, 1, 400)
const world = new AabbVehicleWorld([FLOOR])

interface SimRun {
  sim: ReturnType<typeof createVehicleSim>
  cars: Record<string, { id: number; laneId: string; distance: number; max: number; initialLane: string }>
  events: SimEvent[]
}

function build(): SimRun {
  const sim = createVehicleSim(0)
  const cars: SimRun['cars'] = {}
  return { sim, cars, events: [] }
}

function runFor(run: SimRun, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let step = 0; step < steps; step++) {
    stepVehicleSim(run.sim, world, NO_INPUT, DT, 8)
    run.events.push(...run.sim.events)
    for (const key of Object.keys(run.cars)) {
      const car = run.cars[key]
      const entity = run.sim.registry.vehicles.get(car.id)!
      car.laneId = entity.ai!.laneId
      car.distance = entity.ai!.distance
      if (car.laneId === car.initialLane) car.max = Math.max(car.max, car.distance)
    }
  }
}

function collisions(run: SimRun): number {
  return run.events.filter((e) => e.type === 'collision-vehicle').length
}

describe('intersection arbitration (M3)', () => {
  it('yields at the stop line while a crossing car holds the box', () => {
    const run = build()
    const n = spawnVehicle(
      run.sim.registry,
      'taxi',
      { pos: { x: 100, y: 0.5, z: -4 }, heading: 0 },
      'AI_CONTROLLED',
      parkedMotion(),
    )
    n.ai = { laneId: 'n', distance: 96, targetSpeed: 5, reactionClock: 0 }
    n.motion.speed = 5
    run.cars['n'] = { id: n.id, laneId: 'n', distance: 96, max: 96, initialLane: 'n' }
    const e = spawnVehicle(
      run.sim.registry,
      'taxi',
      { pos: { x: 88, y: 0.5, z: 0 }, heading: Math.PI / 2 },
      'AI_CONTROLLED',
      parkedMotion(),
    )
    e.ai = { laneId: 'e', distance: 88, targetSpeed: 13, reactionClock: 0 }
    e.motion.speed = 10
    run.cars['e'] = { id: e.id, laneId: 'e', distance: 88, max: 88, initialLane: 'e' }

    // One second in the crosser is still in the box and the east car has
    // not entered.
    runFor(run, 1)
    expect(run.cars['n'].max).toBeGreaterThan(94)
    expect(run.cars['e'].distance).toBeLessThan(94)

    // Once the crosser routes away the east car is released and crosses.
    runFor(run, 3)
    expect(run.cars['e'].max).toBeGreaterThan(94)
    expect(run.cars['n'].laneId).toBe('n-cont')
    expect(collisions(run)).toBe(0)
  })

  it('resolves two simultaneous greens by distance to the line, id tie-break', () => {
    const run = build()
    const e = spawnVehicle(
      run.sim.registry,
      'taxi',
      { pos: { x: 90, y: 0.5, z: 0 }, heading: Math.PI / 2 },
      'AI_CONTROLLED',
      parkedMotion(),
    )
    e.ai = { laneId: 'e', distance: 90, targetSpeed: 13, reactionClock: 0 }
    e.motion.speed = 10
    run.cars['e'] = { id: e.id, laneId: 'e', distance: 90, max: 90, initialLane: 'e' }
    const n = spawnVehicle(
      run.sim.registry,
      'taxi',
      { pos: { x: 100, y: 0.5, z: -10 }, heading: 0 },
      'AI_CONTROLLED',
      parkedMotion(),
    )
    n.ai = { laneId: 'n', distance: 90, targetSpeed: 13, reactionClock: 0 }
    n.motion.speed = 10
    run.cars['n'] = { id: n.id, laneId: 'n', distance: 90, max: 90, initialLane: 'n' }

    // The east car spawned first, so its id wins the tie and enters; the
    // north car brakes short of the line until the box clears.
    runFor(run, 0.9)
    expect(run.cars['e'].max).toBeGreaterThan(94)
    expect(run.cars['n'].distance).toBeLessThan(94)

    runFor(run, 3)
    expect(run.cars['n'].max).toBeGreaterThan(94)
    expect(collisions(run)).toBe(0)
  })

  it('lets a left turn yield to opposing through traffic', () => {
    const run = build()
    const w = spawnVehicle(
      run.sim.registry,
      'taxi',
      { pos: { x: 104, y: 0.5, z: 0 }, heading: -Math.PI / 2 },
      'AI_CONTROLLED',
      parkedMotion(),
    )
    w.ai = { laneId: 'w', distance: 46, targetSpeed: 5, reactionClock: 0 }
    w.motion.speed = 5
    run.cars['w'] = { id: w.id, laneId: 'w', distance: 46, max: 46, initialLane: 'w' }
    const left = spawnVehicle(
      run.sim.registry,
      'taxi',
      { pos: { x: 88, y: 0.5, z: 0 }, heading: Math.PI / 2 },
      'AI_CONTROLLED',
      parkedMotion(),
    )
    left.ai = { laneId: 'e-left', distance: 88, targetSpeed: 13, reactionClock: 0 }
    left.motion.speed = 10
    run.cars['left'] = { id: left.id, laneId: 'e-left', distance: 88, max: 88, initialLane: 'e-left' }

    runFor(run, 0.5)
    expect(run.cars['left'].distance).toBeLessThan(94)
    // The opposing car crosses; only then does the left-turner proceed.
    runFor(run, 3.5)
    expect(run.cars['left'].max).toBeGreaterThan(94)
  })

  it('does not yield to opposing through traffic when going straight', () => {
    const run = build()
    const w = spawnVehicle(
      run.sim.registry,
      'taxi',
      { pos: { x: 104, y: 0.5, z: 0 }, heading: -Math.PI / 2 },
      'AI_CONTROLLED',
      parkedMotion(),
    )
    w.ai = { laneId: 'w', distance: 46, targetSpeed: 5, reactionClock: 0 }
    w.motion.speed = 5
    run.cars['w'] = { id: w.id, laneId: 'w', distance: 46, max: 46, initialLane: 'w' }
    const straight = spawnVehicle(
      run.sim.registry,
      'taxi',
      { pos: { x: 88, y: 0.5, z: 0 }, heading: Math.PI / 2 },
      'AI_CONTROLLED',
      parkedMotion(),
    )
    straight.ai = { laneId: 'e', distance: 88, targetSpeed: 13, reactionClock: 0 }
    straight.motion.speed = 10
    run.cars['straight'] = { id: straight.id, laneId: 'e', distance: 88, max: 88, initialLane: 'e' }

    // Straight through the green: the opposing car is not in the conflict
    // set, so no stop at the line.
    runFor(run, 1)
    expect(run.cars['straight'].max).toBeGreaterThan(94)
  })

  it('stepping with a junction is deterministic', () => {
    const a = build()
    const b = build()
    const runBoth = (run: SimRun) => {
      const n = spawnVehicle(
        run.sim.registry,
        'taxi',
        { pos: { x: 100, y: 0.5, z: -4 }, heading: 0 },
        'AI_CONTROLLED',
        parkedMotion(),
      )
      n.ai = { laneId: 'n', distance: 96, targetSpeed: 5, reactionClock: 0 }
      n.motion.speed = 5
      const e = spawnVehicle(
        run.sim.registry,
        'taxi',
        { pos: { x: 88, y: 0.5, z: 0 }, heading: Math.PI / 2 },
        'AI_CONTROLLED',
        parkedMotion(),
      )
      e.ai = { laneId: 'e', distance: 88, targetSpeed: 13, reactionClock: 0 }
      e.motion.speed = 10
      runFor(run, 4)
      const trail = [...run.sim.registry.vehicles.values()]
        .filter((v) => v.state === 'AI_CONTROLLED')
        .map((v) => ({ id: v.id, laneId: v.ai!.laneId, distance: v.ai!.distance, pos: v.pose.pos }))
      return { trail, events: run.events }
    }
    const first = runBoth(a)
    const second = runBoth(b)
    expect(second.trail).toEqual(first.trail)
    expect(second.events).toEqual(first.events)
  })
})
