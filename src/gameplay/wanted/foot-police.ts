/**
 * Police on foot: officers get out of a cruiser that has pulled up near a
 * suspect on foot and chase them down.
 *
 * A cruiser that has stopped within FOOT_DEPLOY_RANGE of a wanted player who
 * is on foot lets its crew out — the driver at one star, the driver and a
 * partner from two stars. Officers run at the suspect a little slower than a
 * sprint (so sprinting away works) and make the arrest if they stay within
 * arm's reach for ARREST_TIME. If the player gets into a car or the heat is
 * off, they run back to their cruiser and get in.
 *
 * Pure apart from the figure list it drives (world/life/street-figures);
 * collision and ground come in as callbacks so the logic is testable.
 */
import { addFigure, streetFigures, type StreetFigure } from '../../world/life/street-figures'
import type { Vec2 } from './wanted'

export const FOOT_DEPLOY_RANGE = 30
/** A cruiser slower than this counts as stopped. */
export const FOOT_DEPLOY_SPEED = 1.5
export const OFFICER_RUN_SPEED = 6.4
export const OFFICER_WALK_SPEED = 1.6
/** Inside this an officer is laying hands on the suspect. */
export const ARREST_RANGE = 1.5
export const ARREST_TIME = 1.1
/** An officer this close to their cruiser's door is back in. */
export const BOARD_RANGE = 1.3
/** An officer this far behind gives up and walks back. */
export const GIVE_UP_DISTANCE = 70

export interface CruiserView {
  id: number
  x: number
  y: number
  z: number
  heading: number
  speed: number
}

export interface FootPoliceStep {
  stars: number
  onFoot: boolean
  player: Vec2
  cruisers: readonly CruiserView[]
  dt: number
  /** Collision-resolved move from (x, z) by (dx, dz). */
  move: (x: number, y: number, z: number, dx: number, dz: number) => { x: number; z: number }
  ground: (x: number, z: number) => number | null
}

export interface FootPoliceState {
  /** Cruisers whose crew is out (or has been out this stop). */
  deployed: Set<number>
  arrestClock: number
}

export function createFootPolice(): FootPoliceState {
  return { deployed: new Set(), arrestClock: 0 }
}

function officers(): StreetFigure[] {
  return streetFigures.list.filter((f) => f.role === 'officer' && !f.done)
}

function doorPoint(c: CruiserView, side: 1 | -1): { x: number; z: number } {
  const fx = Math.sin(c.heading)
  const fz = Math.cos(c.heading)
  // side 1 = driver (left of forward), -1 = passenger
  return { x: c.x + fz * 1.1 * side, z: c.z - fx * 1.1 * side }
}

export function stepFootPolice(state: FootPoliceState, step: FootPoliceStep): { busted: boolean } {
  const { player, dt } = step
  const byId = new Map(step.cruisers.map((c) => [c.id, c]))

  // ── Deploy ────────────────────────────────────────────────────────────────
  if (step.stars > 0 && step.onFoot) {
    for (const c of step.cruisers) {
      if (state.deployed.has(c.id)) continue
      if (Math.abs(c.speed) > FOOT_DEPLOY_SPEED) continue
      if (Math.hypot(c.x - player.x, c.z - player.z) > FOOT_DEPLOY_RANGE) continue
      state.deployed.add(c.id)
      const crew = step.stars >= 2 ? 2 : 1
      for (let i = 0; i < crew; i++) {
        const door = doorPoint(c, i === 0 ? 1 : -1)
        addFigure({
          role: 'officer',
          x: door.x,
          y: c.y,
          z: door.z,
          yaw: Math.atan2(player.x - door.x, player.z - door.z),
          clip: 'Run',
          speed: 0,
          seed: c.id * 31 + i * 7 + 1,
          unitId: c.id,
        })
      }
    }
  }

  // ── Chase or return ───────────────────────────────────────────────────────
  const chasing = step.stars > 0 && step.onFoot
  let reaching = false
  for (const f of officers()) {
    f.age += dt
    const car = f.unitId !== undefined ? byId.get(f.unitId) : undefined
    const toPlayer = Math.hypot(player.x - f.x, player.z - f.z)
    let goal: { x: number; z: number } | null
    let speed: number
    if (chasing && toPlayer < GIVE_UP_DISTANCE) {
      goal = player
      speed = OFFICER_RUN_SPEED
    } else if (car) {
      goal = doorPoint(car, 1)
      speed = chasing ? OFFICER_WALK_SPEED : OFFICER_RUN_SPEED * 0.8
    } else {
      // the cruiser is gone (despawned, stolen): just leave
      f.done = true
      continue
    }
    const dx = goal.x - f.x
    const dz = goal.z - f.z
    const dist = Math.hypot(dx, dz)
    if (goal === player && dist <= ARREST_RANGE) {
      reaching = true
      f.clip = 'Interact'
      f.speed = 0
      f.yaw = Math.atan2(dx, dz)
      continue
    }
    if (goal !== player && dist <= BOARD_RANGE) {
      f.done = true
      continue
    }
    const stepLen = Math.min(dist - (goal === player ? ARREST_RANGE * 0.8 : 0), speed * dt)
    if (stepLen > 0) {
      const moved = step.move(f.x, f.y, f.z, (dx / dist) * stepLen, (dz / dist) * stepLen)
      const actual = Math.hypot(moved.x - f.x, moved.z - f.z)
      f.x = moved.x
      f.z = moved.z
      f.speed = dt > 0 ? actual / dt : 0
    } else {
      f.speed = 0
    }
    f.yaw = Math.atan2(dx, dz)
    f.clip = f.speed > 3 ? 'Run' : f.speed > 0.3 ? 'Walk' : 'Idle'
    const g = step.ground(f.x, f.z)
    if (g !== null) f.y = g
  }

  // A cruiser whose crew is all back in can deploy again at its next stop.
  for (const id of [...state.deployed]) {
    const out = streetFigures.list.some((f) => f.role === 'officer' && !f.done && f.unitId === id)
    const car = byId.get(id)
    if (!out && (!car || Math.abs(car.speed) > FOOT_DEPLOY_SPEED * 2 || !chasing)) state.deployed.delete(id)
  }

  // ── Arrest ────────────────────────────────────────────────────────────────
  if (chasing && reaching) state.arrestClock += dt
  else state.arrestClock = Math.max(0, state.arrestClock - dt * 2)
  const busted = state.arrestClock >= ARREST_TIME
  if (busted) state.arrestClock = 0
  return { busted }
}

/** Every officer back in the car at once (busted, dev reset). */
export function clearFootPolice(state: FootPoliceState): void {
  for (const f of streetFigures.list) if (f.role === 'officer') f.done = true
  state.deployed.clear()
  state.arrestClock = 0
}

/** Officers on foot as observers for the sight test. */
export function officerObservers(): { pos: Vec2; forward: Vec2 }[] {
  return officers().map((f) => ({ pos: { x: f.x, z: f.z }, forward: { x: Math.sin(f.yaw), z: Math.cos(f.yaw) } }))
}
