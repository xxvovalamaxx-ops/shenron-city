/**
 * Light traffic on Dragon Boulevard.
 *
 * Pure simulation — no renderer, no React — so the interesting behaviour is
 * unit tested. Vehicles circulate a single closed loop at constant cruise
 * speed and slow for two things: the player standing in the road, and the
 * vehicle in front.
 *
 * Yielding is what makes traffic safe to have in a walking game. The
 * alternative was either cars that drive through the player, which is a visual
 * defect, or cars that shove the player through a swept collision solver,
 * which can squeeze them into geometry. A car that brakes for a pedestrian
 * needs no dynamic bodies and reads as deliberate rather than as a bug.
 */
import { loopLength, sampleLoop } from '../agents/ambient-routes'
import { TRAFFIC_LOOP, VEHICLE } from '../world/city-data'
import { aabb, PLAYER_RADIUS, type AABB, type Vec3 } from './collision'

/** How far ahead a vehicle looks for the player, metres. */
export const LOOKAHEAD = 9.5
/** How far ahead it looks for the vehicle in front, metres. */
export const HEADWAY = 7.5
/** Lateral clearance that counts as "in my way". */
export const CLEARANCE = PLAYER_RADIUS + VEHICLE.width / 2 + 0.42

const ACCEL = 3.4
const BRAKE = 9.0
const CRUISE_MIN = 6.2
const CRUISE_MAX = 9.4

export interface Vehicle {
  id: string
  /** Distance travelled around the loop, metres. Always wrapped. */
  distance: number
  /** Speed this vehicle drives at when nothing is in the way, m/s. */
  cruise: number
  /** Current speed, m/s, eased toward cruise or toward zero. */
  speed: number
  /** Stable per-vehicle paint index, so a car does not change colour. */
  tint: number
}

export interface VehiclePose {
  x: number
  z: number
  /** Radians, matching sampleLoop's convention. */
  heading: number
}

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Evenly spaced vehicles with a deterministic jitter, so the boulevard is not
 * a metronome and two runs of the game look identical.
 */
export function createTraffic(count: number, seed = 0x5ce7): Vehicle[] {
  if (count <= 0) return []
  const total = loopLength(TRAFFIC_LOOP)
  const spacing = total / count
  const rand = mulberry32(seed)

  return Array.from({ length: count }, (_, i) => {
    const cruise = CRUISE_MIN + rand() * (CRUISE_MAX - CRUISE_MIN)
    return {
      id: `car-${i}`,
      // Jitter stays under a third of the gap so cars never start overlapping.
      distance: (i * spacing + (rand() - 0.5) * spacing * 0.6 + total) % total,
      cruise,
      speed: cruise,
      tint: Math.floor(rand() * 1024),
    }
  })
}

export function vehiclePose(vehicle: Vehicle): VehiclePose {
  return sampleLoop(TRAFFIC_LOOP, vehicle.distance)
}

/** Shortest distance from a point to a segment, in the XZ plane. */
export function distanceToSegment(
  p: { x: number; z: number },
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const lengthSq = dx * dx + dz * dz
  if (lengthSq < 1e-9) return Math.hypot(p.x - a.x, p.z - a.z)

  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
}

/**
 * Is the player inside the corridor this vehicle is about to drive through?
 *
 * Sampled as the segment from the vehicle's nose to its lookahead point, which
 * follows the loop around the turns instead of assuming a straight line.
 */
export function yieldsToPlayer(vehicle: Vehicle, player: Vec3, lookahead = LOOKAHEAD): boolean {
  // A player on floor 45 is not standing in the road.
  if (player.y > 3) return false

  const nose = sampleLoop(TRAFFIC_LOOP, vehicle.distance + VEHICLE.length / 2)
  const ahead = sampleLoop(TRAFFIC_LOOP, vehicle.distance + lookahead)
  return distanceToSegment(player, nose, ahead) < CLEARANCE
}

/** Gap along the loop from `vehicle` to the nearest vehicle in front. */
export function gapAhead(vehicle: Vehicle, all: readonly Vehicle[]): number {
  const total = loopLength(TRAFFIC_LOOP)
  let best = total

  for (const other of all) {
    if (other === vehicle) continue
    const gap = ((other.distance - vehicle.distance) % total + total) % total
    if (gap > 0 && gap < best) best = gap
  }
  return best
}

/**
 * Advance every vehicle. Mutates in place, matching the rest of the
 * simulation — this runs 60 times a second and should not allocate.
 */
export function advanceTraffic(
  vehicles: Vehicle[],
  dt: number,
  player: Vec3,
): void {
  if (vehicles.length === 0) return
  const total = loopLength(TRAFFIC_LOOP)

  for (const vehicle of vehicles) {
    const blocked =
      yieldsToPlayer(vehicle, player) ||
      gapAhead(vehicle, vehicles) < HEADWAY + VEHICLE.length

    const wanted = blocked ? 0 : vehicle.cruise
    const rate = wanted < vehicle.speed ? BRAKE : ACCEL
    const delta = wanted - vehicle.speed
    const step = rate * dt

    vehicle.speed = Math.abs(delta) <= step ? wanted : vehicle.speed + Math.sign(delta) * step
    if (vehicle.speed < 0) vehicle.speed = 0

    vehicle.distance = (vehicle.distance + vehicle.speed * dt) % total
  }
}

/**
 * Solid boxes so the player cannot walk through a stopped car.
 *
 * Axis-aligned, which is exact on the straights — where the loop runs along z
 * and vehicles are almost always found — and approximate through the two
 * turns, which sit beyond the walkable stretch of the boulevard anyway.
 */
export function vehicleColliders(vehicles: readonly Vehicle[]): AABB[] {
  return vehicles.map((vehicle) => {
    const pose = vehiclePose(vehicle)
    const alongZ = Math.abs(Math.cos(pose.heading)) > 0.7071
    const sx = alongZ ? VEHICLE.width : VEHICLE.length
    const sz = alongZ ? VEHICLE.length : VEHICLE.width
    return aabb(pose.x, VEHICLE.height / 2, pose.z, sx, VEHICLE.height, sz)
  })
}
