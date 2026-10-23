/**
 * Scripted people who are not part of the pavement crowd: a driver pulled
 * out of a jacked car, and police officers on foot.
 *
 * Pure and renderer-free. Gameplay code adds and steers figures here; the
 * crowd (src/city/pedestrians.js) draws them with the same rigged bodies and
 * baked clips as everyone else, so they cost one instance each.
 */
import type { CrowdClip } from './crowd-renderer'

export type FigureRole = 'ejected-driver' | 'officer'

export interface StreetFigure {
  id: number
  role: FigureRole
  x: number
  y: number
  z: number
  /** Facing, radians about +Y; 0 faces +Z (the crowd bodies' rest pose). */
  yaw: number
  clip: CrowdClip
  /** Ground speed m/s, drives the locomotion clip rate. */
  speed: number
  seed: number
  /** Seconds since the figure appeared. */
  age: number
  /** Set by the owner once the figure should be removed. */
  done: boolean
  /** Ejected driver: the direction they run, unit (x, z). */
  away?: { x: number; z: number }
  /** Officer: the cruiser they came from. */
  unitId?: number
}

let nextId = 1

export const streetFigures: { list: StreetFigure[] } = { list: [] }

export function addFigure(fig: Omit<StreetFigure, 'id' | 'age' | 'done'>): StreetFigure {
  const f: StreetFigure = { ...fig, id: nextId++, age: 0, done: false }
  streetFigures.list.push(f)
  return f
}

export function removeDone(): void {
  if (streetFigures.list.some((f) => f.done)) streetFigures.list = streetFigures.list.filter((f) => !f.done)
}

export function clearFigures(role?: FigureRole): void {
  streetFigures.list = role ? streetFigures.list.filter((f) => f.role !== role) : []
}

// ── Carjack: the driver pulled out of the car ───────────────────────────────

/** Seconds the driver is held in the doorway while being dragged out. */
export const EJECT_PULL = 0.65
/** Seconds of stumble after landing on the pavement. */
export const EJECT_STUMBLE = 0.6
/** Seconds of running away before the driver is let go. */
export const EJECT_FLEE = 7
export const EJECT_RUN_SPEED = 5.4
/** Metres from the car's centreline to the driver's door. */
export const DOOR_OFFSET = 1.05

export interface CarPose {
  x: number
  y: number
  z: number
  heading: number
}

/**
 * The jacked car's driver appears in the driver's door (left of the car in
 * a right-hand-traffic city) facing out, is dragged clear, stumbles and runs.
 */
export function ejectDriver(car: CarPose, seed: number): StreetFigure {
  const fx = Math.sin(car.heading)
  const fz = Math.cos(car.heading)
  // left of forward on the ground plane
  const lx = fz
  const lz = -fx
  return addFigure({
    role: 'ejected-driver',
    x: car.x + lx * DOOR_OFFSET + fx * 0.25,
    y: car.y,
    z: car.z + lz * DOOR_OFFSET + fz * 0.25,
    yaw: Math.atan2(lx, lz),
    clip: 'Interact',
    speed: 0,
    seed,
    // run out to the side and back, away from the car and the player
    away: normalise(lx * 0.8 - fx * 0.6, lz * 0.8 - fz * 0.6),
  })
}

function normalise(x: number, z: number): { x: number; z: number } {
  const l = Math.hypot(x, z) || 1
  return { x: x / l, z: z / l }
}

/** Advance one pulled-out driver. `ground` gives the walking height, or null. */
export function stepEjected(f: StreetFigure, dt: number, ground: (x: number, z: number) => number | null): void {
  f.age += dt
  const away = f.away ?? { x: 1, z: 0 }
  if (f.age < EJECT_PULL) {
    // dragged out of the seat, sideways through the door
    const v = 2.2
    f.x += away.x * v * dt * 0.6
    f.z += away.z * v * dt * 0.6
    f.clip = 'Interact'
    f.speed = 0
  } else if (f.age < EJECT_PULL + EJECT_STUMBLE) {
    // shoved clear, staggering a step or two
    const v = 1.6
    f.x += away.x * v * dt
    f.z += away.z * v * dt
    f.yaw = Math.atan2(away.x, away.z)
    f.clip = 'Walk'
    f.speed = v
  } else if (f.age < EJECT_PULL + EJECT_STUMBLE + EJECT_FLEE) {
    f.x += away.x * EJECT_RUN_SPEED * dt
    f.z += away.z * EJECT_RUN_SPEED * dt
    f.yaw = Math.atan2(away.x, away.z)
    f.clip = 'Run'
    f.speed = EJECT_RUN_SPEED
  } else {
    f.done = true
  }
  const g = ground(f.x, f.z)
  if (g !== null) f.y = g
}
