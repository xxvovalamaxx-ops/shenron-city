/**
 * The Phase 3A determinism gate: replay an identical recorded input stream
 * twice and compare.
 *
 * Documented tolerances (docs/phase3/PHASE3A.md): the simulation is pure
 * fixed-step arithmetic, so a replay is expected to be bit-identical. The
 * assertions allow a 1e-9 m position error, 1e-9 rad heading error and
 * 1e-9 m/s speed error — two orders of magnitude above any float noise the
 * platform could introduce — and require the collision event streams to be
 * exactly equal. If the sim ever reads wall-clock time, Math.random or a
 * renderer, this test fails.
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
import type { VehiclePose } from './vehicle-model'

const DT = 1 / 120
const DURATION = 20
const STEPS = Math.round(DURATION / DT)

/**
 * The arena's taxi needs a lane that runs along the arena road (the z=0
 * line, east-to-west heading) so it drives head-on into the owned car. The
 * production lane lives at the real spawn point and is allowed to move, so
 * the arena registers its own lane instead of depending on that geometry.
 */
const ARENA_HEAD_ON: Lane = {
  id: 'arena-head-on',
  loop: true,
  speedLimit: 8,
  laneWidth: 1.6,
  points: [
    { x: 40, z: 0 },
    { x: -10, z: 0 },
    { x: -10, z: 60 },
    { x: 40, z: 60 },
  ],
}
;(LANES as Record<string, Lane>)[ARENA_HEAD_ON.id] = ARENA_HEAD_ON

/** Documented replay tolerances — see docs/phase3/PHASE3A.md. */
export const REPLAY_TOLERANCE_POSITION_M = 1e-9
export const REPLAY_TOLERANCE_HEADING_RAD = 1e-9
export const REPLAY_TOLERANCE_SPEED_MS = 1e-9

const FLOOR: AABB = aabb(0, 0, 0, 400, 1, 400)
/**
 * A thick building slab across the path at x = 20 (x 16..24), so a head-on
 * world collision — and a boxed-in exit — are both part of the recorded run.
 */
const WALL: AABB = aabb(20, 2, 0, 8, 6, 200)

interface Arena {
  world: AabbVehicleWorld
  sim: ReturnType<typeof createVehicleSim>
}

/** Build the deterministic arena: one owned car, one AI taxi driving
 * head-on into it (a traffic collision that separates the cars forever,
 * with no grinding), one pedestrian crossing the car's path, a wall at the
 * end of the road, and two parked cars flanking the wall-side of the road
 * so the player's exit is genuinely boxed in when they stop against it. */
function buildArena(): Arena {
  const world = new AabbVehicleWorld([FLOOR, WALL])
  const sim = createVehicleSim(0)
  const owned = [...sim.registry.vehicles.values()].find((v) => v.owned)!
  owned.pose = { pos: { x: 0, y: 0.5, z: 0 }, heading: Math.PI / 2 }
  owned.motion = parkedMotion()

  const taxi = spawnVehicle(
    sim.registry,
    'taxi',
    { pos: { x: 12, y: 0.5, z: 0 }, heading: -Math.PI / 2 },
    'AI_CONTROLLED',
    parkedMotion(),
  )
  taxi.ai = { laneId: ARENA_HEAD_ON.id, distance: 0, targetSpeed: 5, reactionClock: 0 }
  taxi.motion.speed = 5

  // Parked cars on both sides of the road near the wall.
  spawnVehicle(
    sim.registry,
    'police',
    { pos: { x: 13.5, y: 0.5, z: 3.5 }, heading: Math.PI / 2 },
    'PARKED',
    parkedMotion(),
  )
  spawnVehicle(
    sim.registry,
    'ambulance',
    { pos: { x: 13.5, y: 0.5, z: -3.5 }, heading: Math.PI / 2 },
    'PARKED',
    parkedMotion(),
  )

  sim.pedestrians = [
    {
      id: 1,
      pos: { x: 6, y: 0.5, z: 0 },
      radius: 0.3,
      displaced: false,
      downTimer: 0,
      dir: { x: 0, z: 1 },
      speed: 0,
      anchor: { x: 6, y: 0.5, z: 0 },
      offset: 0,
      bound: 1,
    },
  ]

  // Stand the player at the owned car's door.
  sim.player.pos = { x: 0.9, y: 0.5, z: 0 }
  sim.player.forward = { x: 1, z: 0 }
  return { world, sim }
}

/**
 * The recorded input stream: a pure function of elapsed time describing a
 * full session — enter, drive, horn, pedestrian hit, head-on traffic hit,
 * world hit (boxed in against the wall), a blocked exit attempt, reverse
 * clear of the wall, and a successful exit at the very end. The car drives
 * perfectly straight, so the wall contact and the exit geometry are exact.
 */
function recordedInputAt(t: number, step: number): PlayerVehicleInput {
  const throttle = t >= 0.2 && t < 9 ? 1 : 0
  const brake = t >= 10 && t < 11.5 ? 1 : t >= 12 && t < 13.5 ? 1 : 0
  return {
    throttle,
    brake,
    steer: 0,
    handbrake: t >= 9.5 && t < 10.2,
    horn: t >= 2 && t < 2.01,
    interact: step === 0 || (t >= 8.6 && t < 8.61) || (t >= 18.5 && t < 18.51),
  }
}

interface Snapshot {
  pose: VehiclePose
  speed: number
  events: SimEvent[]
}

function runReplay(): Snapshot[] {
  const { world, sim } = buildArena()
  const trail: Snapshot[] = []
  for (let step = 0; step < STEPS; step++) {
    const t = step * DT
    stepVehicleSim(sim, world, recordedInputAt(t, step), DT, 21)
    const owned = [...sim.registry.vehicles.values()].find((v) => v.owned) ?? null
    trail.push({
      pose: owned ? { ...owned.pose, pos: { ...owned.pose.pos } } : { ...sim.player, pos: { ...sim.player.pos }, heading: Math.atan2(sim.player.forward.x, sim.player.forward.z) },
      speed: owned?.motion.speed ?? 0,
      events: [...sim.events],
    })
  }
  return trail
}

describe('deterministic replay (Phase 3A gate)', () => {
  it('replays an identical recorded input stream to the same result', () => {
    const first = runReplay()
    const second = runReplay()

    expect(first.length).toBe(STEPS)
    expect(second.length).toBe(STEPS)

    for (let i = 0; i < STEPS; i++) {
      const a = first[i]
      const b = second[i]
      const dx = a.pose.pos.x - b.pose.pos.x
      const dy = a.pose.pos.y - b.pose.pos.y
      const dz = a.pose.pos.z - b.pose.pos.z
      expect(Math.hypot(dx, dy, dz)).toBeLessThanOrEqual(REPLAY_TOLERANCE_POSITION_M)
      expect(Math.abs(a.pose.heading - b.pose.heading)).toBeLessThanOrEqual(REPLAY_TOLERANCE_HEADING_RAD)
      expect(Math.abs(a.speed - b.speed)).toBeLessThanOrEqual(REPLAY_TOLERANCE_SPEED_MS)
      expect(a.events).toEqual(b.events)
    }
  })

  it('actually drove, collided and transitioned during the recorded run', () => {
    const trail = runReplay()
    const allEvents = trail.flatMap((s) => s.events)
    const types = new Set(allEvents.map((e) => e.type))

    expect(types.has('enter')).toBe(true)
    expect(types.has('exit')).toBe(true)
    expect(types.has('horn')).toBe(true)
    expect(types.has('collision-vehicle')).toBe(true)
    expect(types.has('collision-world')).toBe(true)
    expect(types.has('collision-pedestrian')).toBe(true)
    expect(types.has('exit-blocked')).toBe(true)

    // The car must have moved substantially and come to rest parked.
    const driven = trail.filter((s) => s.speed !== 0)
    expect(driven.length).toBeGreaterThan(STEPS * 0.2)
    expect(trail[STEPS - 1].speed).toBe(0)
  })

  it('the owned car ends parked and the player back on foot', () => {
    const { world, sim } = buildArena()
    for (let step = 0; step < STEPS; step++) {
      stepVehicleSim(sim, world, recordedInputAt(step * DT, step), DT, 21)
    }
    const owned = [...sim.registry.vehicles.values()].find((v) => v.owned)!
    expect(owned.state).toBe('PARKED')
    expect(sim.registry.playerVehicleId).toBeNull()
    expect(sim.playerVisible).toBe(true)
    // The player should stand clear of the car, on the floor.
    expect(world.groundHeightAt(sim.player.pos.x, sim.player.pos.z)).not.toBeNull()
  })

  it('benchmarks the pure step (documented in docs/phase3/PHASE3A.md)', () => {
    const { world, sim } = buildArena()
    const WARMUP = 600
    const SAMPLES = 6000
    for (let i = 0; i < WARMUP; i++) {
      stepVehicleSim(sim, world, recordedInputAt(0, 0), DT, 21)
    }
    const start = performance.now()
    for (let i = 0; i < SAMPLES; i++) {
      stepVehicleSim(sim, world, recordedInputAt(0, 0), DT, 21)
    }
    const elapsedMs = performance.now() - start
    const stepsPerSecond = (SAMPLES / elapsedMs) * 1000
    // A hard floor far below any real result: this is a regression tripwire,
    // not a measurement. The measured value is committed in PHASE3A.md.
    expect(stepsPerSecond).toBeGreaterThan(50_000)
    console.log(`[vehicle] benchmark: ${Math.round(stepsPerSecond).toLocaleString()} steps/s at 120 Hz fixed step`)
  })
})
