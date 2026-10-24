import { describe, expect, it } from 'vitest'
import { initialVehicleMotion, stepVehicle, type VehicleMotion, type VehiclePose } from '../vehicles/vehicle-model'
import { vehicleSpec } from '../vehicles/vehicle-specs'
import {
  createPursuitMemory,
  interceptPoint,
  pursuitInput,
  REVERSE_TIME,
  STUCK_TIME,
  type PursuitMemory,
} from './pursuit'

const DT = 1 / 60

function simulate(
  seconds: number,
  start: VehiclePose,
  target: (t: number) => { pos: { x: number; z: number }; vel: { x: number; z: number } },
) {
  const spec = vehicleSpec('police')
  let pose = start
  let motion: VehicleMotion = initialVehicleMotion()
  let memory: PursuitMemory = createPursuitMemory()
  let closest = Infinity
  for (let t = 0; t < seconds; t += DT) {
    const tgt = target(t)
    const car = { pos: { x: pose.pos.x, z: pose.pos.z }, heading: pose.heading, speed: motion.speed }
    const step = pursuitInput(car, tgt.pos, tgt, memory, DT)
    memory = step.memory
    ;({ pose, motion } = stepVehicle(spec, pose, motion, step.input, DT, 0))
    closest = Math.min(closest, Math.hypot(tgt.pos.x - pose.pos.x, tgt.pos.z - pose.pos.z))
  }
  return { pose, motion, closest }
}

describe('police pursuit driving', () => {
  it('leads a moving target', () => {
    const aim = interceptPoint(
      { pos: { x: 0, z: 0 }, heading: 0, speed: 20 },
      { pos: { x: 0, z: 100 }, vel: { x: 10, z: 0 } },
    )
    expect(aim.x).toBeGreaterThan(0)
    expect(aim.z).toBe(100)
  })

  it('catches a slower car that starts behind it on open ground', () => {
    const run = simulate(
      30,
      { pos: { x: 0, y: 0, z: 0 }, heading: Math.PI }, // pointing the wrong way
      (t) => ({ pos: { x: 12 * t, z: 150 }, vel: { x: 12, z: 0 } }),
    )
    expect(run.closest).toBeLessThan(6)
  })

  it('turns around toward a target behind it instead of driving away', () => {
    const run = simulate(6, { pos: { x: 0, y: 0, z: 0 }, heading: 0 }, () => ({
      pos: { x: 0, z: -120 },
      vel: { x: 0, z: 0 },
    }))
    expect(run.pose.pos.z).toBeLessThan(0)
  })

  it('backs out after pushing against something without moving', () => {
    let memory = createPursuitMemory()
    const wedged = { pos: { x: 0, z: 0 }, heading: 0, speed: 0 }
    const goal = { x: 0, z: 100 }
    let reversed = false
    for (let t = 0; t < STUCK_TIME + 0.2; t += DT) {
      const step = pursuitInput(wedged, goal, { pos: goal, vel: { x: 0, z: 0 } }, memory, DT)
      memory = step.memory
      if (step.input.brake === 1 && step.input.throttle === 0) reversed = true
    }
    expect(reversed).toBe(true)
    expect(memory.reverseFor).toBeGreaterThan(0)
    expect(memory.reverseFor).toBeLessThanOrEqual(REVERSE_TIME)
  })

  it('is deterministic', () => {
    const go = () =>
      simulate(10, { pos: { x: 5, y: 0, z: -20 }, heading: 1 }, (t) => ({
        pos: { x: 30 * Math.sin(t * 0.3), z: 80 + 10 * t },
        vel: { x: 9 * Math.cos(t * 0.3), z: 10 },
      }))
    expect(go()).toEqual(go())
  })
})
