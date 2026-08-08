/**
 * Signal compliance for the Phase 3A vehicle sim (M2).
 *
 * The AI reads the same fixed two-phase signal program as the LION traffic
 * sim (intersections.js), so this arena pins the stop-line behaviour the
 * whole city shares: hold at the stop line on red, release on green, and
 * run the amber when the car is too close to stop. The lane carries a
 * baked signal copy with an offset that is red at clock 0, so the phase
 * sequence of a run is a fixed function of sim time — no randomness, no
 * wall clock, keeping the run deterministic like the replay gate.
 */
import { describe, expect, it } from 'vitest'
import { aabb, type AABB } from '../collision'
import { AabbVehicleWorld } from './vehicle-collision'
import {
  createVehicleSim,
  stepVehicleSim,
  type PlayerVehicleInput,
} from './vehicle-control'
import { spawnVehicle, parkedMotion } from './vehicle-entities'
import { LANES, laneLength, type Lane } from './vehicle-lanes'
import { STOP_LINE } from '../../city/intersections.js'

const DT = 1 / 120
const NO_INPUT: PlayerVehicleInput = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  horn: false,
  interact: false,
}

/**
 * A 400 m straight one-way street ending at a signalled node. Axis 0 with
 * offset 13.5 s is red at clock 0 (the green window for axis 0 opens at
 * t = 12.5 s), so the whole stop-and-hold scenario happens under red.
 */
const SIGNAL_LANE: Lane = {
  id: 'signal-lane',
  loop: false,
  speedLimit: 13,
  laneWidth: 1.6,
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 400 },
  ],
  next: ['signal-cont'],
  signalled: true,
  axis: 0,
  signal: { cycle: 26, green: 11, amber: 2, offset: 13.5 },
}
const SIGNAL_CONT: Lane = {
  id: 'signal-cont',
  loop: false,
  speedLimit: 13,
  laneWidth: 1.6,
  points: [
    { x: 0, z: 400 },
    { x: 0, z: 450 },
  ],
}
;(LANES as Record<string, Lane>)[SIGNAL_LANE.id] = SIGNAL_LANE
;(LANES as Record<string, Lane>)[SIGNAL_CONT.id] = SIGNAL_CONT

/** Lane carrying the same geometry but offset 0: green at clock 0. */
const GREEN_LANE: Lane = {
  ...SIGNAL_LANE,
  id: 'green-lane',
  signal: { cycle: 26, green: 11, amber: 2, offset: 0 },
}
;(LANES as Record<string, Lane>)[GREEN_LANE.id] = GREEN_LANE

/** Lane whose signal is amber at clock 0: axis 0 is amber while the phase
 * wraps through [11, 13) s, so an offset of 12 puts the amber at t = 0. */
const AMBER_LANE: Lane = {
  ...SIGNAL_LANE,
  id: 'amber-lane',
  signal: { cycle: 26, green: 11, amber: 2, offset: 12 },
}
;(LANES as Record<string, Lane>)[AMBER_LANE.id] = AMBER_LANE

const FLOOR: AABB = aabb(-200, 0, -200, 400, 1, 400)
const world = new AabbVehicleWorld([FLOOR])

const STOP_LINE_AT = laneLength(SIGNAL_LANE) - STOP_LINE

interface RunResult {
  maxDistance: number
  finalDistance: number
  finalSpeed: number
  laneId: string
}

/** Spawn one AI car at `distance` and step the sim for `seconds`. */
function run(lane: Lane, distance: number, seconds: number, initialSpeed = 0): RunResult {
  const sim = createVehicleSim(0)
  const car = spawnVehicle(
    sim.registry,
    'taxi',
    { pos: { x: 0, y: 0.5, z: distance }, heading: 0 },
    'AI_CONTROLLED',
    parkedMotion(),
  )
  car.ai = { laneId: lane.id, distance, targetSpeed: lane.speedLimit * 0.8, reactionClock: 0 }
  car.motion.speed = initialSpeed

  let maxDistance = 0
  let finalDistance = distance
  let finalSpeed = 0
  let laneId = lane.id
  const steps = Math.round(seconds / DT)
  for (let step = 0; step < steps; step++) {
    stepVehicleSim(sim, world, NO_INPUT, DT, 8)
    const entity = sim.registry.vehicles.get(car.id)!
    finalDistance = entity.ai!.distance
    finalSpeed = entity.motion.speed
    laneId = entity.ai!.laneId
    maxDistance = Math.max(maxDistance, entity.ai!.distance)
  }
  return { maxDistance, finalDistance, finalSpeed, laneId }
}

describe('signal stop line (M2)', () => {
  it('holds a red approach at the stop line', () => {
    // Red until t = 12.5 s; run 12 s so the phase never changes. The car
    // must approach, brake, and settle short of the line, never crossing.
    const result = run(SIGNAL_LANE, 380, 12)
    expect(result.maxDistance).toBeLessThan(STOP_LINE_AT + 0.5)
    expect(result.finalDistance).toBeGreaterThan(STOP_LINE_AT - 10)
    expect(result.finalSpeed).toBeLessThan(0.5)
  })

  it('does not creep across the line even when close to it', () => {
    // Spawned inside the braking envelope, still under red.
    const result = run(SIGNAL_LANE, 391, 12, 4)
    expect(result.maxDistance).toBeLessThan(STOP_LINE_AT + 0.5)
    expect(result.finalSpeed).toBeLessThan(0.5)
  })

  it('releases on green and routes onto the next lane', () => {
    // Green from t = 0 on this lane's program: the car crosses the line
    // and routes onto the follow-on lane instead of holding.
    const result = run(GREEN_LANE, 380, 25)
    expect(result.maxDistance).toBeGreaterThan(STOP_LINE_AT)
    expect(result.laneId).toBe('signal-cont')
    expect(result.finalDistance).toBeGreaterThan(0)
  })

  it('runs the amber when too close to stop', () => {
    // Amber at clock 0. At 13 m/s the car needs v²/2a ≈ 11.3 m; only 9 m
    // out, braking would leave it blocking the crossing phase, so it must
    // continue through the line instead.
    const result = run(AMBER_LANE, 385, 1.2, 13)
    expect(result.maxDistance).toBeGreaterThan(STOP_LINE_AT)
  })

  it('brakes for the amber when it can still stop comfortably', () => {
    // 19 m out at 13 m/s: the stopping distance fits, so the car brakes
    // and holds at the line when the phase goes red a second later.
    const result = run(AMBER_LANE, 375, 3, 13)
    expect(result.maxDistance).toBeLessThan(STOP_LINE_AT + 0.5)
    expect(result.finalSpeed).toBeLessThan(0.5)
  })
})
