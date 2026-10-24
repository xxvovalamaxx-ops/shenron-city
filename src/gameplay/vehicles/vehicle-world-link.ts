/**
 * The seam between the deterministic vehicle session and the ambient LION
 * traffic (src/city/traffic.js), plus the rules for the cars the player
 * leaves behind.
 *
 * Traffic is an ambient layer: hundreds of cars on the real road graph,
 * simulated as 1-D lane followers around the camera. The session is the hero
 * layer: the player's car and the cars the player has touched. One world is
 * made of the two by three explicit hand-offs, all pure data:
 *
 * 1. Every frame the game loop hands the session a snapshot of the traffic
 *    cars near the player as {@link TrafficCarView}s. The session treats them
 *    as bodies: the player's car collides with them, exits avoid them, and
 *    the enter prompt offers any slow one for a carjack.
 * 2. A carjack *promotes* a view: the session spawns an entity of the same
 *    kind and paint at the exact pose and speed, and emits `promote` so the
 *    loop removes the car from traffic. The car coasts to rest while the
 *    player climbs in.
 * 3. A collision *knocks* a view: the impulse is applied to the view's
 *    velocity inside the session (so the rest of the frame's substeps see a
 *    moving car), and the loop hands the final pose and velocity back to
 *    traffic, which lets that car slide free of its lane and come to rest.
 *
 * Traffic in turn sees the session's cars as obstacles in its lanes (see
 * traffic-bridge.ts), so it brakes for the player instead of driving
 * through them.
 */
import type { Vec3 } from '../collision'
import type { VehicleEntity, VehicleRegistry } from './vehicle-entities'
import type { Body2D } from './vehicle-impulse'
import { motionVelocity } from './vehicle-model'
import { vehicleSpec } from './vehicle-specs'

/** A traffic car as the session sees it, in world coordinates. */
export interface TrafficCarView {
  /** Stable id inside traffic.js. */
  id: number
  kind: string
  x: number
  y: number
  z: number
  /** Session heading convention: forward = (sin h, cos h). */
  heading: number
  /** Signed speed along the heading, m/s. */
  speed: number
  /** Planar velocity, m/s (equals forward·speed for a lane follower). */
  vx: number
  vz: number
  /** Heading rate, rad/s (a spinning, knocked car). */
  yawRate: number
  paint: number
  /** True once the session has hit this car during the current frame. */
  hit?: boolean
}

/** A traffic car slower than this may be jacked, m/s (about 18 km/h). */
export const JACK_MAX_SPEED = 5

/** Momentum of a view, for {@link contactImpulse}. */
export function viewBody(view: TrafficCarView): Body2D {
  const spec = vehicleSpec(view.kind)
  return {
    x: view.x,
    z: view.z,
    heading: view.heading,
    vx: view.vx,
    vz: view.vz,
    mass: spec.mass,
    halfLength: spec.halfLength,
    halfWidth: spec.halfWidth,
  }
}

/** Momentum of a session entity. */
export function entityBody(entity: VehicleEntity): Body2D {
  const spec = vehicleSpec(entity.kind)
  const v = motionVelocity(entity.pose.heading, entity.motion)
  return {
    x: entity.pose.pos.x,
    z: entity.pose.pos.z,
    heading: entity.pose.heading,
    vx: v.x,
    vz: v.z,
    mass: spec.mass,
    halfLength: spec.halfLength,
    halfWidth: spec.halfWidth,
  }
}

/**
 * Advance a knocked view within the frame: it slides with tyre scrub and
 * spins down, exactly as traffic.js continues it afterwards.
 */
export function integrateKnockedView(view: TrafficCarView, dt: number, scrub = 6.5): void {
  const sp = Math.hypot(view.vx, view.vz)
  if (sp > 1e-6) {
    const next = Math.max(0, sp - scrub * dt)
    view.vx *= next / sp
    view.vz *= next / sp
  }
  view.x += view.vx * dt
  view.z += view.vz * dt
  view.heading += view.yawRate * dt
  view.yawRate *= Math.exp(-2.5 * dt)
  const f = { x: Math.sin(view.heading), z: Math.cos(view.heading) }
  view.speed = view.vx * f.x + view.vz * f.z
}

// ── Parked cars ──────────────────────────────────────────────────────────────

/** A parked car further than this from the player starts its despawn clock. */
export const PARKED_DESPAWN_DISTANCE = 220
/** Seconds a far parked car survives before it is removed. */
export const PARKED_DESPAWN_DELAY = 6
/** At most this many abandoned (not owned) parked cars are kept. */
export const MAX_ABANDONED_CARS = 6
/** The cap never removes a car closer than this to the player. */
export const ABANDONED_CAP_MIN_DISTANCE = 40

/**
 * Parking rules for the session's cars, as a pure step:
 *
 * - The owned car (the last one the player took) stays where it was left,
 *   forever: it is the car in the save file.
 * - Any other parked car stays put and re-enterable while the player is
 *   nearby. Once the player has been more than PARKED_DESPAWN_DISTANCE away
 *   for PARKED_DESPAWN_DELAY seconds it is removed (the city has "towed" it,
 *   and the ambient traffic fills the street again).
 * - Beyond MAX_ABANDONED_CARS, the farthest abandoned car that is at least
 *   ABANDONED_CAP_MIN_DISTANCE away goes immediately, so a joyride through
 *   a dozen cars does not leave a dozen hero cars simulating.
 *
 * Returns the ids removed, in a deterministic (ascending id) order.
 */
export function updateParkedCars(
  registry: VehicleRegistry,
  playerPos: Vec3,
  dt: number,
  clocks: Map<number, number>,
): number[] {
  let removed: number[] | null = null
  let abandoned: Array<{ id: number; dist: number }> | null = null
  for (const [id, entity] of registry.vehicles) {
    if (entity.state !== 'PARKED' || entity.owned || registry.playerVehicleId === id) {
      if (clocks.size > 0) clocks.delete(id)
      continue
    }
    const dist = Math.hypot(entity.pose.pos.x - playerPos.x, entity.pose.pos.z - playerPos.z)
    const clock = dist > PARKED_DESPAWN_DISTANCE ? (clocks.get(id) ?? 0) + dt : 0
    clocks.set(id, clock)
    if (clock >= PARKED_DESPAWN_DELAY) {
      ;(removed ??= []).push(id)
      continue
    }
    ;(abandoned ??= []).push({ id, dist })
  }
  if (abandoned && abandoned.length > MAX_ABANDONED_CARS) {
    abandoned.sort((a, b) => b.dist - a.dist || a.id - b.id)
    let excess = abandoned.length - MAX_ABANDONED_CARS
    for (const car of abandoned) {
      if (excess <= 0) break
      if (car.dist < ABANDONED_CAP_MIN_DISTANCE) continue
      ;(removed ??= []).push(car.id)
      excess--
    }
  }
  if (!removed) return NONE
  removed.sort((a, b) => a - b)
  for (const id of removed) {
    registry.vehicles.delete(id)
    clocks.delete(id)
  }
  return removed
}

const NONE: number[] = []
