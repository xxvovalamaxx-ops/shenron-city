import { describe, expect, it } from 'vitest'
import {
  initialVehicleMotion,
  isStationary,
  localToWorld,
  parkVehicleMotion,
  speedKmh,
  steeringFactor,
  stepVehicle,
  vehicleForward,
  vehicleRight,
  type VehicleInput,
  type VehicleMotion,
  type VehiclePose,
} from './vehicle-model'
import { vehicleSpec } from './vehicle-specs'

const SEDAN = vehicleSpec('sedan')
const GROUND = 0.5
const dt = 1 / 120

function pose(x = 0, z = 0, heading = 0): VehiclePose {
  return { pos: { x, y: GROUND, z }, heading }
}

function run(steps: number, input: VehicleInput, start: VehiclePose = pose(), motion: VehicleMotion = initialVehicleMotion()) {
  let p = start
  let m = motion
  for (let i = 0; i < steps; i++) {
    const stepped = stepVehicle(SEDAN, p, m, input, dt, GROUND)
    p = stepped.pose
    m = stepped.motion
  }
  return { p, m }
}

describe('longitudinal', () => {
  it('accelerates from rest under full throttle', () => {
    const { p, m } = run(120, { throttle: 1, brake: 0, steer: 0, handbrake: false })
    // Drag subtracts from the raw acceleration; at one second the net is
    // within a band of the no-drag figure.
    expect(m.speed).toBeGreaterThan(SEDAN.acceleration * 0.8)
    expect(m.speed).toBeLessThanOrEqual(SEDAN.acceleration + 1e-9)
    expect(Math.hypot(p.pos.x, p.pos.z)).toBeGreaterThan(2)
  })

  it('never exceeds the forward speed ceiling, settling at drag equilibrium', () => {
    const { m } = run(12000, { throttle: 1, brake: 0, steer: 0, handbrake: false })
    expect(m.speed).toBeLessThanOrEqual(SEDAN.maxForwardSpeed + 1e-9)
    // The fixed point of the discrete update: air drag is evaluated at the
    // post-roll speed, so v* = sqrt((accel - rolling) / airDrag) - (accel - rolling) * dt.
    const raw = Math.sqrt((SEDAN.acceleration - SEDAN.rollingDrag) / SEDAN.airDrag)
    const equilibrium = raw - (SEDAN.acceleration - SEDAN.rollingDrag) * dt
    expect(m.speed).toBeCloseTo(equilibrium, 1)
  })

  it('brakes a moving car', () => {
    const accelerated = run(600, { throttle: 1, brake: 0, steer: 0, handbrake: false })
    const { m } = run(120, { throttle: 0, brake: 1, steer: 0, handbrake: false }, accelerated.p, accelerated.m)
    expect(m.speed).toBeLessThan(accelerated.m.speed)
  })

  it('reverses when the brake is held from a standstill', () => {
    const { m } = run(600, { throttle: 0, brake: 1, steer: 0, handbrake: false })
    expect(m.speed).toBeLessThan(0)
    expect(m.reversing).toBe(true)
  })

  it('throttle brakes the car out of reverse before driving forward', () => {
    const reversed = run(600, { throttle: 0, brake: 1, steer: 0, handbrake: false })
    const { m } = run(300, { throttle: 1, brake: 0, steer: 0, handbrake: false }, reversed.p, reversed.m)
    expect(m.speed).toBeGreaterThan(-0.05)
  })

  it('reversing is capped at the reverse ceiling', () => {
    const { m } = run(6000, { throttle: 0, brake: 1, steer: 0, handbrake: false })
    expect(m.speed).toBeGreaterThanOrEqual(-SEDAN.maxReverseSpeed - 1e-9)
  })

  it('rolling drag brings a coasting car to rest', () => {
    const accelerated = run(1200, { throttle: 1, brake: 0, steer: 0, handbrake: false })
    const { m } = run(6000, { throttle: 0, brake: 0, steer: 0, handbrake: false }, accelerated.p, accelerated.m)
    expect(m.speed).toBeCloseTo(0, 6)
    expect(isStationary(m)).toBe(true)
  })

  it('handbrake decelerates harder than rolling drag alone', () => {
    const accelerated = run(1200, { throttle: 1, brake: 0, steer: 0, handbrake: false })
    const { m } = run(300, { throttle: 0, brake: 0, steer: 0, handbrake: true }, accelerated.p, accelerated.m)
    expect(m.speed).toBeLessThan(SEDAN.maxForwardSpeed * 0.5)
  })
})

describe('steering', () => {
  it('does not turn in place at zero speed', () => {
    const { p } = run(600, { throttle: 0, brake: 0, steer: 1, handbrake: false })
    expect(p.heading).toBeCloseTo(0, 12)
  })

  it('turns in the direction of the steer input while moving', () => {
    const { p } = run(600, { throttle: 1, brake: 0, steer: 1, handbrake: false })
    expect(p.heading).toBeGreaterThan(0)
  })

  it('reverses the yaw direction when reversing', () => {
    const reversed = run(600, { throttle: 0, brake: 1, steer: 0, handbrake: false })
    const forward = run(600, { throttle: 1, brake: 0, steer: 1, handbrake: false })
    const backward = run(600, { throttle: 0, brake: 1, steer: 1, handbrake: false }, reversed.p, reversed.m)
    expect(backward.p.heading).toBeLessThan(forward.p.heading)
  })

  it('steering is speed-sensitive: less authority per metre at speed', () => {
    // Steady-state yaw per metre of travel, measured at a crawl vs highway
    // pace with the same full steer input. Per metre must shrink as the
    // speed-sensitive steering factor tapers.
    const yawPerMetre = (v: number): number => {
      let m = { ...initialVehicleMotion(), speed: v }
      let p = pose()
      let travelled = 0
      for (let i = 0; i < 120; i++) {
        const stepped = stepVehicle(SEDAN, p, m, { throttle: 0, brake: 0, steer: 1, handbrake: false }, dt, GROUND)
        travelled += Math.hypot(stepped.pose.pos.x - p.pos.x, stepped.pose.pos.z - p.pos.z)
        p = stepped.pose
        m = stepped.motion
      }
      return travelled > 1e-6 ? p.heading / travelled : 0
    }
    expect(yawPerMetre(5)).toBeGreaterThan(yawPerMetre(30))
    // And the factor function itself is monotone non-increasing.
    const factors = [1, 5, 10, 20, 33].map((v) => steeringFactor(v, SEDAN.maxForwardSpeed))
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeLessThanOrEqual(factors[i - 1] + 1e-12)
    }
    expect(steeringFactor(0, SEDAN.maxForwardSpeed)).toBe(1)
  })

  it('front-wheel steering angle chases the input at the rate limit', () => {
    const { m } = run(600, { throttle: 0, brake: 0, steer: 1, handbrake: false })
    expect(m.steerAngle).toBeGreaterThan(0)
    expect(m.steerAngle).toBeLessThanOrEqual(SEDAN.maxSteer)
    // One step only moves the wheel by steerRate * dt.
    const oneStep = stepVehicle(SEDAN, pose(), initialVehicleMotion(), {
      throttle: 0,
      brake: 0,
      steer: 1,
      handbrake: false,
    }, dt, GROUND)
    expect(oneStep.motion.steerAngle).toBeCloseTo(SEDAN.steerRate * dt, 9)
  })

  it('handbrake boosts yaw authority while coasting', () => {
    // Over a short window the handbrake's yaw boost outweighs its deceleration:
    // more heading per second while speed is still substantial.
    const yawWith = (handbrake: boolean): number => {
      let m = { ...initialVehicleMotion(), speed: 20 }
      let p = pose()
      for (let i = 0; i < 30; i++) {
        const stepped = stepVehicle(SEDAN, p, m, { throttle: 0, brake: 0, steer: 1, handbrake }, dt, GROUND)
        p = stepped.pose
        m = stepped.motion
      }
      return p.heading
    }
    expect(yawWith(true)).toBeGreaterThan(yawWith(false))
  })
})

describe('wheels and lights', () => {
  it('wheel rotation tracks distance travelled through the wheel radius', () => {
    const { m, p } = run(1200, { throttle: 1, brake: 0, steer: 0, handbrake: false })
    const travelled = Math.hypot(p.pos.x, p.pos.z)
    expect(m.wheelSpin).toBeCloseTo(travelled / SEDAN.wheelRadius, 2)
  })

  it('marks braking and reversing for the lights', () => {
    const braking = run(120, { throttle: 0, brake: 1, steer: 0, handbrake: false }, pose(), {
      ...initialVehicleMotion(),
      speed: 10,
    })
    expect(braking.m.braking).toBe(true)

    const reversing = run(120, { throttle: 0, brake: 1, steer: 0, handbrake: false })
    expect(reversing.m.reversing).toBe(true)
    expect(reversing.m.braking).toBe(true)
  })

  it('parked motion shows the parking lights and no speed', () => {
    const parked = parkVehicleMotion()
    expect(isStationary(parked)).toBe(true)
    expect(parked.braking).toBe(true)
  })
})

describe('determinism and basis', () => {
  it('two identical steps produce identical results', () => {
    const input = { throttle: 0.7, brake: 0.1, steer: -0.4, handbrake: true } as const
    const a = stepVehicle(SEDAN, pose(), initialVehicleMotion(), input, dt, GROUND)
    const b = stepVehicle(SEDAN, pose(), initialVehicleMotion(), input, dt, GROUND)
    expect(a).toEqual(b)
  })

  it('heading basis matches the walk controller: forward=(sin h, cos h)', () => {
    expect(vehicleForward(0)).toEqual({ x: 0, z: 1 })
    expect(vehicleForward(Math.PI / 2).x).toBeCloseTo(1, 12)
    expect(vehicleForward(Math.PI / 2).z).toBeCloseTo(0, 12)
    // Right-hand vector as the walk code uses it.
    const f = vehicleForward(Math.PI)
    expect(vehicleRight(Math.PI).x).toBeCloseTo(-f.z, 12)
    expect(vehicleRight(Math.PI).z).toBeCloseTo(f.x, 12)
  })

  it('localToWorld rotates the same basis the sim moves along', () => {
    // Offset.x is the right axis, offset.z the forward axis. At heading π/2
    // (facing +X), right is +Z: a right offset of 2 lands at z+2, a forward
    // offset of 3 lands at x+3.
    const out = localToWorld(Math.PI / 2, { x: 2, y: 0.5, z: 3 }, { x: 10, y: 0, z: 20 })
    expect(out.x).toBeCloseTo(13, 12)
    expect(out.z).toBeCloseTo(22, 12)
  })

  it('speedKmh is wall-clock readable and signed-agnostic', () => {
    expect(speedKmh(10)).toBe(36)
    expect(speedKmh(-10)).toBe(36)
  })
})
