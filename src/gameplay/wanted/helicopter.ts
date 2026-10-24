/**
 * The police helicopter: from three stars a unit flies in, circles the
 * suspect and holds its searchlight on them; when the heat drops below three
 * stars it climbs away.
 *
 * Pure and deterministic (no clock, no random source). The renderer
 * (world/PoliceHelicopter.tsx) draws whatever this state says.
 */
import type { Vec2 } from './wanted'

export const HELI_STARS = 3
/** Where it appears, metres from the suspect. */
export const HELI_SPAWN_DISTANCE = 380
export const HELI_ORBIT_RADIUS = 55
/** Height above the street it circles at. */
export const HELI_ORBIT_HEIGHT = 62
export const HELI_ORBIT_RATE = 0.22 // rad/s
export const HELI_MAX_SPEED = 32
export const HELI_ACCEL = 9
/** Gone once this far away while leaving. */
export const HELI_DESPAWN_DISTANCE = 650
/** From overhead the crew sees the suspect inside this horizontal range. */
export const HELI_SIGHT_RANGE = 110
/** Seconds the searchlight lags behind the suspect. */
export const HELI_LIGHT_LAG = 0.9

export interface HeliState {
  active: boolean
  leaving: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Nose direction, radians about +Y (0 faces +Z). */
  heading: number
  /** Bank into turns, radians. */
  bank: number
  orbit: number
  /** Where the searchlight is pointed on the ground. */
  light: { x: number; z: number }
  /** Spawn counter, rotates the approach direction. */
  sorties: number
}

export function createHeli(): HeliState {
  return { active: false, leaving: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, bank: 0, orbit: 0, light: { x: 0, z: 0 }, sorties: 0 }
}

export interface HeliStep {
  stars: number
  player: Vec2
  /** Street height under the suspect. */
  groundY: number
  dt: number
}

function wrap(a: number): number {
  let x = a
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

export function stepHeli(s: HeliState, step: HeliStep): void {
  const { player, dt } = step
  const wanted = step.stars >= HELI_STARS

  if (!s.active) {
    if (!wanted) return
    // Come in from a different side each sortie.
    const a = s.sorties * 2.399963 // golden angle
    s.sorties += 1
    s.active = true
    s.leaving = false
    s.x = player.x + Math.sin(a) * HELI_SPAWN_DISTANCE
    s.z = player.z + Math.cos(a) * HELI_SPAWN_DISTANCE
    s.y = step.groundY + HELI_ORBIT_HEIGHT + 40
    s.vx = s.vy = s.vz = 0
    s.heading = Math.atan2(player.x - s.x, player.z - s.z)
    s.orbit = a
    s.light = { x: player.x, z: player.z }
  }

  s.leaving = !wanted
  let gx: number
  let gy: number
  let gz: number
  if (s.leaving) {
    // climb out, away from the suspect
    const ax = s.x - player.x
    const az = s.z - player.z
    const l = Math.hypot(ax, az) || 1
    gx = s.x + (ax / l) * 200
    gz = s.z + (az / l) * 200
    gy = step.groundY + HELI_ORBIT_HEIGHT + 120
  } else {
    s.orbit += HELI_ORBIT_RATE * dt
    gx = player.x + Math.sin(s.orbit) * HELI_ORBIT_RADIUS
    gz = player.z + Math.cos(s.orbit) * HELI_ORBIT_RADIUS
    gy = step.groundY + HELI_ORBIT_HEIGHT
  }

  // Steer: a velocity toward the goal, limited, approached at HELI_ACCEL.
  const dx = gx - s.x
  const dy = gy - s.y
  const dz = gz - s.z
  const dist = Math.hypot(dx, dz)
  const want = Math.min(HELI_MAX_SPEED, dist * 0.6 + (s.leaving ? HELI_MAX_SPEED : 0))
  const wx = dist > 1e-3 ? (dx / dist) * want : 0
  const wz = dist > 1e-3 ? (dz / dist) * want : 0
  const wy = Math.max(-6, Math.min(6, dy * 0.8))
  const maxDv = HELI_ACCEL * dt
  const dvx = wx - s.vx
  const dvz = wz - s.vz
  const dv = Math.hypot(dvx, dvz)
  const k = dv > maxDv ? maxDv / dv : 1
  s.vx += dvx * k
  s.vz += dvz * k
  s.vy += Math.max(-maxDv, Math.min(maxDv, wy - s.vy))
  s.x += s.vx * dt
  s.y += s.vy * dt
  s.z += s.vz * dt

  // Nose: into the motion when moving, toward the suspect when hovering.
  const speed = Math.hypot(s.vx, s.vz)
  const face = speed > 4 ? Math.atan2(s.vx, s.vz) : Math.atan2(player.x - s.x, player.z - s.z)
  const turn = wrap(face - s.heading)
  const turnRate = Math.max(-1.2, Math.min(1.2, turn * 1.5))
  s.heading = wrap(s.heading + turnRate * dt)
  s.bank += (-turnRate * 0.35 - s.bank) * Math.min(1, dt * 3)

  // Searchlight: chases the suspect with a lag, drifts off when leaving.
  const lk = Math.min(1, dt / HELI_LIGHT_LAG)
  const tx = s.leaving ? s.x : player.x
  const tz = s.leaving ? s.z : player.z
  s.light.x += (tx - s.light.x) * lk
  s.light.z += (tz - s.light.z) * lk

  if (s.leaving && Math.hypot(s.x - player.x, s.z - player.z) > HELI_DESPAWN_DISTANCE) {
    s.active = false
    s.leaving = false
  }
}

/** The crew looks straight down: no building blocks the view of a street. */
export function heliSees(s: HeliState, player: Vec2): boolean {
  return s.active && !s.leaving && Math.hypot(s.x - player.x, s.z - player.z) <= HELI_SIGHT_RANGE
}

export function clearHeli(s: HeliState): void {
  s.active = false
  s.leaving = false
}

/** Shared live state, stepped by the director and drawn by the renderer. */
export const policeHeli: HeliState = createHeli()
