/**
 * On-foot locomotion: camera-relative input, finite acceleration, bodies that
 * turn rather than snap. Stepped at 60 Hz like the game.
 */
import { describe, expect, it } from 'vitest'
import {
  ACCELERATION,
  AIM_WALK_SPEED,
  RUN_SPEED,
  SPRINT_SPEED,
  bodyYawFor,
  cameraRelativeDirection,
  createFootState,
  reconcileBlocked,
  stepFoot,
  type FootInput,
  type FootState,
} from './on-foot'
import { angleDelta } from './orbit-camera'

const DT = 1 / 60

function run(state: FootState, input: Partial<FootInput>, seconds: number): FootState {
  const full: FootInput = {
    forward: 0,
    strafe: 0,
    sprint: false,
    aim: false,
    grounded: true,
    cameraYaw: 0,
    ...input,
  }
  let s = state
  for (let t = 0; t < seconds; t += DT) s = stepFoot(s, full, DT)
  return s
}

const speed = (s: FootState) => Math.hypot(s.vx, s.vz)

describe('cameraRelativeDirection', () => {
  it('runs W away from a camera looking down -Z', () => {
    const d = cameraRelativeDirection(1, 0, 0)!
    expect(d.x).toBeCloseTo(0, 9)
    expect(d.z).toBeCloseTo(-1, 9)
  })

  it('turns with the camera: yaw a quarter left, W heads -X', () => {
    const d = cameraRelativeDirection(1, 0, Math.PI / 2)!
    expect(d.x).toBeCloseTo(-1, 9)
    expect(d.z).toBeCloseTo(0, 9)
  })

  it('strafes D to the camera’s right and keeps diagonals unit length', () => {
    const d = cameraRelativeDirection(0, 1, 0)!
    expect(d.x).toBeCloseTo(1, 9)
    const diag = cameraRelativeDirection(1, 1, 0)!
    expect(Math.hypot(diag.x, diag.z)).toBeCloseTo(1, 9)
  })

  it('is null with no key held', () => {
    expect(cameraRelativeDirection(0, 0, 1)).toBeNull()
  })
})

describe('stepFoot', () => {
  it('ramps up to jog speed instead of starting at it', () => {
    const first = stepFoot(createFootState(Math.PI), { forward: 1, strafe: 0, sprint: false, aim: false, grounded: true, cameraYaw: 0 }, DT)
    expect(speed(first)).toBeLessThanOrEqual(ACCELERATION * DT + 1e-9)
    const later = run(createFootState(Math.PI), { forward: 1 }, 1)
    expect(speed(later)).toBeCloseTo(RUN_SPEED, 3)
  })

  it('sprints faster, and reports the sprint for the camera', () => {
    const s = run(createFootState(Math.PI), { forward: 1, sprint: true }, 2)
    expect(speed(s)).toBeCloseTo(SPRINT_SPEED, 3)
    expect(s.sprintBlend).toBeGreaterThan(0.8)
  })

  it('stops over a few frames, not one', () => {
    const moving = run(createFootState(Math.PI), { forward: 1, sprint: true }, 2)
    const oneFrame = stepFoot(moving, { forward: 0, strafe: 0, sprint: false, aim: false, grounded: true, cameraYaw: 0 }, DT)
    expect(speed(oneFrame)).toBeGreaterThan(SPRINT_SPEED * 0.8)
    const stopped = run(moving, {}, 0.6)
    expect(speed(stopped)).toBe(0)
  })

  it('turns the body toward travel over time instead of snapping', () => {
    // Body faces +Z (yaw 0); camera looks -Z; W wants -Z: a half turn.
    const oneFrame = stepFoot(createFootState(0), { forward: 1, strafe: 0, sprint: false, aim: false, grounded: true, cameraYaw: 0 }, DT)
    expect(Math.abs(angleDelta(oneFrame.bodyYaw, bodyYawFor(0, -1)))).toBeGreaterThan(2)
    const turned = run(createFootState(0), { forward: 1 }, 1)
    expect(Math.abs(angleDelta(turned.bodyYaw, bodyYawFor(0, -1)))).toBeLessThan(0.01)
  })

  it('runs where the body faces, so a reversal is a turn, not a moonwalk', () => {
    const north = run(createFootState(Math.PI), { forward: 1 }, 1)
    const reversing = stepFoot(north, { forward: -1, strafe: 0, sprint: false, aim: false, grounded: true, cameraYaw: 0 }, DT)
    // Velocity stays aligned with the body.
    const facing = { x: Math.sin(reversing.bodyYaw), z: Math.cos(reversing.bodyYaw) }
    const v = speed(reversing)
    expect((reversing.vx * facing.x + reversing.vz * facing.z) / v).toBeCloseTo(1, 6)
    // And a hard turn scrubs speed.
    expect(v).toBeLessThan(speed(north))
  })

  it('aims: faces the camera, strafes at a walk', () => {
    const s = run(createFootState(0), { strafe: 1, aim: true }, 1)
    expect(speed(s)).toBeCloseTo(AIM_WALK_SPEED, 3)
    expect(s.vx).toBeGreaterThan(0)
    // Facing the camera's forward (-Z), i.e. model yaw π.
    expect(Math.abs(angleDelta(s.bodyYaw, Math.PI))).toBeLessThan(0.01)
    expect(s.aimBlend).toBeGreaterThan(0.9)
  })

  it('first person strafes at full pace with the body squared to the view', () => {
    const s = run(createFootState(0), { strafe: 1, firstPerson: true }, 1)
    expect(speed(s)).toBeCloseTo(RUN_SPEED, 3)
    expect(Math.abs(angleDelta(s.bodyYaw, Math.PI))).toBeLessThan(0.01)
  })

  it('keeps momentum in the air with only a little steering', () => {
    const running = run(createFootState(Math.PI), { forward: 1 }, 1)
    const air = run(running, { strafe: 1, grounded: false }, 0.3)
    expect(speed(air)).toBeGreaterThan(RUN_SPEED * 0.7)
    expect(Math.abs(air.vx)).toBeLessThan(RUN_SPEED * 0.5)
  })

  it('honours the dev speed multiplier', () => {
    const s = run(createFootState(Math.PI), { forward: 1, speedScale: 2 }, 1)
    expect(speed(s)).toBeCloseTo(RUN_SPEED * 2, 3)
  })
})

describe('reconcileBlocked', () => {
  it('bleeds velocity into a wall', () => {
    const s = { ...createFootState(), vx: 0, vz: -RUN_SPEED }
    const blocked = reconcileBlocked(s, 0, 0, DT)
    expect(Math.hypot(blocked.vx, blocked.vz)).toBeLessThan(RUN_SPEED)
  })

  it('leaves free movement alone', () => {
    const s = { ...createFootState(), vx: 0, vz: -RUN_SPEED }
    expect(reconcileBlocked(s, 0, -RUN_SPEED * DT, DT)).toBe(s)
  })
})
