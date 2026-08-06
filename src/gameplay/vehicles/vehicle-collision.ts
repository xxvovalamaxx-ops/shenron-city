/**
 * Collision for the vehicle simulation, renderer-free.
 *
 * The vehicle core never touches THREE: the world it moves through is the
 * {@link VehicleWorld} interface, implemented by an AABB arena in tests and
 * by the Manhattan BVH in the live build (world/manhattan-vehicle-world.ts).
 * The interface is deliberately the same three operations the player's
 * controller uses — ground height, swept slide move, and a distance cast for
 * the camera boom — so the two systems share one notion of "world".
 *
 * Vehicle-vs-vehicle and vehicle-vs-pedestrian response lives here as pure
 * functions: oriented-rectangle overlap for cars, and a deterministic
 * push-away for pedestrians.
 */
import type { AABB, Vec3 } from '../collision'
import { rayBoxDistance } from '../camera-boom'
import { vehicleForward, vehicleRight, type VehiclePose, type VehicleSpec } from './vehicle-model'

/** A world a vehicle can move through. */
export interface VehicleWorld {
  /** Surface height under (x, z), or null over water / outside the world. */
  groundHeightAt(x: number, z: number): number | null
  /**
   * Sweep a horizontal move by (dx, dz) with a circular footprint of
   * `radius`, sliding along obstacles. Returns the furthest legal position.
   */
  moveCircle(from: Vec3, dx: number, dz: number, radius: number): Vec3
  /** Distance along `direction` to the first obstacle, capped at maxDistance. */
  castDistance(origin: Vec3, direction: Vec3, maxDistance: number): number
  /**
   * Is the horizontal circle at (x, z) on solid ground and free of obstacles?
   * Used for enter prompts and exit-placement validation.
   */
  isCircleClear(x: number, z: number, radius: number): boolean
}

// ── AABB arena (tests, determinism replay) ───────────────────────────────────

function circleOverlapsAabb(
  x: number,
  z: number,
  y: number,
  radius: number,
  box: AABB,
): boolean {
  if (y + radius <= box.min[1] || y - radius >= box.max[1]) return false
  const cx = Math.max(box.min[0], Math.min(x, box.max[0]))
  const cz = Math.max(box.min[2], Math.min(z, box.max[2]))
  const dx = x - cx
  const dz = z - cz
  return dx * dx + dz * dz < radius * radius
}

const MOVE_SUBSTEP = 0.5

/**
 * An arena built from plain AABBs. Used by the unit tests and the required
 * deterministic replay test, where a THREE-free world keeps the comparison
 * hermetic. The swept move mirrors manhattan-collision.ts: axes resolve
 * independently so the circle slides along walls.
 */
export class AabbVehicleWorld implements VehicleWorld {
  constructor(
    readonly colliders: readonly AABB[],
    readonly groundRadius = 0.6,
  ) {}

  groundHeightAt(x: number, z: number): number | null {
    let best: number | null = null
    for (const box of this.colliders) {
      const cx = Math.max(box.min[0], Math.min(x, box.max[0]))
      const cz = Math.max(box.min[2], Math.min(z, box.max[2]))
      const dx = x - cx
      const dz = z - cz
      if (dx * dx + dz * dz >= this.groundRadius * this.groundRadius) continue
      const top = box.max[1]
      if (best === null || top > best) best = top
    }
    return best
  }

  private blocked(x: number, y: number, z: number, radius: number): boolean {
    for (const box of this.colliders) {
      // A box the vehicle is standing on is ground, not a wall. Boxes
      // taller than the standing height block the footprint.
      if (box.max[1] <= y + 0.15) continue
      if (circleOverlapsAabb(x, z, y, radius, box)) return true
    }
    return false
  }

  moveCircle(from: Vec3, dx: number, dz: number, radius: number): Vec3 {
    const out = { ...from }
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / MOVE_SUBSTEP))
    const sx = dx / steps
    const sz = dz / steps
    for (let i = 0; i < steps; i++) {
      let moved = false
      if (sx !== 0 && !this.blocked(out.x + sx, out.y, out.z, radius)) {
        out.x += sx
        moved = true
      }
      if (sz !== 0 && !this.blocked(out.x, out.y, out.z + sz, radius)) {
        out.z += sz
        moved = true
      }
      if (!moved) break
    }
    return out
  }

  castDistance(origin: Vec3, direction: Vec3, maxDistance: number): number {
    let closest = maxDistance
    for (const box of this.colliders) {
      const hit = rayBoxDistance(origin, direction, box)
      if (hit !== null && hit < closest) closest = hit
    }
    return closest
  }

  isCircleClear(x: number, z: number, radius: number): boolean {
    if (this.groundHeightAt(x, z) === null) return false
    return !this.blocked(x, 2, z, radius)
  }
}

// ── Vehicle vs vehicle (oriented rectangles) ─────────────────────────────────

/** Axis-aligned half-extents of a vehicle's footprint at a pose. */
export function vehicleHalfExtents(spec: VehicleSpec): { x: number; z: number } {
  return { x: spec.halfLength, z: spec.halfWidth }
}

/**
 * SAT overlap test for two oriented rectangles in the ground plane. The four
 * candidate axes are the two boxes' local axes, which is exact for
 * rectangles. Deterministic and cheap enough to run for every pair each
 * frame at traffic scale.
 */
export function vehicleRectOverlap(
  aPose: VehiclePose,
  aSpec: VehicleSpec,
  bPose: VehiclePose,
  bSpec: VehicleSpec,
): boolean {
  return rectContact(aPose, aSpec, bPose, bSpec) !== null
}

export interface RectContact {
  /** Unit axis from a to b, in world x/z. */
  axis: { x: number; z: number }
  /** Overlap depth along the axis, metres. */
  depth: number
}

/**
 * SAT contact test returning the minimum-translation axis and depth. The
 * axis order is fixed (a's forward, a's right, b's forward, b's right), so a
 * tie on depth picks deterministically.
 */
export function rectContact(
  aPose: VehiclePose,
  aSpec: VehicleSpec,
  bPose: VehiclePose,
  bSpec: VehicleSpec,
): RectContact | null {
  const axes = [
    vehicleForward(aPose.heading),
    vehicleRight(aPose.heading),
    vehicleForward(bPose.heading),
    vehicleRight(bPose.heading),
  ]
  let best: RectContact | null = null
  for (const axis of axes) {
    const len = Math.hypot(axis.x, axis.z)
    if (len < 1e-9) continue
    const ux = axis.x / len
    const uz = axis.z / len
    const dotA = aPose.pos.x * ux + aPose.pos.z * uz
    const dotB = bPose.pos.x * ux + bPose.pos.z * uz
    const centerGap = Math.abs(dotA - dotB)
    const fa = vehicleHalfExtents(aSpec)
    const fb = vehicleHalfExtents(bSpec)
    const af = vehicleForward(aPose.heading)
    const ar = vehicleRight(aPose.heading)
    const bf = vehicleForward(bPose.heading)
    const br = vehicleRight(bPose.heading)
    const radiusA =
      Math.abs(af.x * ux + af.z * uz) * fa.x + Math.abs(ar.x * ux + ar.z * uz) * fa.z
    const radiusB =
      Math.abs(bf.x * ux + bf.z * uz) * fb.x + Math.abs(br.x * ux + br.z * uz) * fb.z
    if (centerGap > radiusA + radiusB) return null
    const depth = radiusA + radiusB - centerGap
    if (best === null || depth < best.depth) {
      // The axis points from a to b: b is further along it.
      const direction = dotB - dotA >= 0 ? 1 : -1
      best = { axis: { x: ux * direction, z: uz * direction }, depth }
    }
  }
  return best
}

export interface VehiclePairResult {
  aPose: VehiclePose
  bPose: VehiclePose
  /** Speed keep fraction applied to each vehicle's signed speed. */
  aSpeedKeep: number
  bSpeedKeep: number
  hit: boolean
}

/**
 * Resolve overlap between two vehicles by pushing each along the separation
 * normal, half and half. When the rectangles are perfectly centred the
 * minimum-translation axis is degenerate, so the fallback is the shared
 * forward axis — deterministic in both cases. The player's vehicle is
 * resolved second so its pose wins ties.
 */
export function resolveVehiclePair(
  aPose: VehiclePose,
  bPose: VehiclePose,
  aKeep: number,
  bKeep: number,
): VehiclePairResult {
  const dx = bPose.pos.x - aPose.pos.x
  const dz = bPose.pos.z - aPose.pos.z
  const gap = Math.hypot(dx, dz)
  let nx: number
  let nz: number
  if (gap > 1e-6) {
    nx = dx / gap
    nz = dz / gap
  } else {
    const f = vehicleForward(aPose.heading)
    nx = f.x
    nz = f.z
  }
  const push = 0.05
  const half = push / 2
  return {
    aPose: { ...aPose, pos: { ...aPose.pos, x: aPose.pos.x - nx * half, z: aPose.pos.z - nz * half } },
    bPose: { ...bPose, pos: { ...bPose.pos, x: bPose.pos.x + nx * half, z: bPose.pos.z + nz * half } },
    aSpeedKeep: aKeep,
    bSpeedKeep: bKeep,
    hit: true,
  }
}

// ── Vehicle vs pedestrian ────────────────────────────────────────────────────

export interface Pedestrian {
  id: number
  pos: Vec3
  radius: number
  /**
   * True after the pedestrian has been knocked aside. The knock happens at
   * most once per encounter because the pedestrian stays down for
   * {@link PED_DOWN_TIME} seconds — a moving vehicle passing a downed
   * pedestrian does not re-pay the speed penalty every frame.
   */
  displaced: boolean
  /** Seconds the pedestrian stays down after a knock. */
  downTimer: number
  /** Walking direction on the ground plane. */
  dir: { x: number; z: number }
  /** Walking speed, m/s. */
  speed: number
  /** Centre of the walking segment; the pedestrian bounces at ±bound. */
  anchor: Vec3
  /** Signed distance from the anchor along `dir`. */
  offset: number
  /** Bounce distance, metres. */
  bound: number
}

/** How long a knocked-down pedestrian stays down, seconds. */
export const PED_DOWN_TIME = 2.5

/**
 * Deterministic pedestrian response: a pedestrian inside the vehicle's
 * footprint is knocked out of it in one step and the vehicle loses a fixed
 * fraction of its speed — once, because the knocked-down pedestrian stays
 * `displaced` until they are clear again. Head-on contact pushes the
 * pedestrian sideways, side contact pushes them along the travel direction,
 * so the car always rolls on rather than grinding to a stop over a body.
 * The pedestrian is moved, never deleted.
 */
export function vehiclePedestrianResponse(
  pose: VehiclePose,
  spec: VehicleSpec,
  pedestrians: Pedestrian[],
  _dt: number,
  speed: number,
): { pedestrians: Pedestrian[]; speed: number; hits: number } {
  const f = vehicleForward(pose.heading)
  const r = vehicleRight(pose.heading)
  const margin = 0.15
  const moved = pedestrians.map((ped) => ({ ...ped }))
  let outSpeed = speed
  let hits = 0

  for (let i = 0; i < moved.length; i++) {
    const ped = moved[i]
    const dx = ped.pos.x - pose.pos.x
    const dz = ped.pos.z - pose.pos.z
    const along = dx * f.x + dz * f.z
    const across = dx * r.x + dz * r.z
    const inContact =
      Math.abs(along) < spec.halfLength + ped.radius + margin &&
      Math.abs(across) < spec.halfWidth + ped.radius + margin

    if (inContact && !ped.displaced) {
      const hitLongitudinal = Math.abs(along) > Math.abs(across)
      let pushX
      let pushZ
      if (hitLongitudinal) {
        // A dead-centre hit has |across| ~ 1e-16, not 0: choose the side with
        // a tolerance so floating-point noise cannot pick the direction.
        const side = Math.abs(across) < 1e-9 ? 1 : across > 0 ? 1 : -1
        const push = spec.halfWidth + ped.radius + margin - Math.abs(across) + 0.5
        pushX = r.x * side * push
        pushZ = r.z * side * push
      } else {
        const forward = along >= 0 ? 1 : -1
        const push = spec.halfLength + ped.radius + margin - Math.abs(along) + 0.5
        pushX = f.x * forward * push
        pushZ = f.z * forward * push
      }
      moved[i] = {
        ...ped,
        pos: { x: ped.pos.x + pushX, y: ped.pos.y, z: ped.pos.z + pushZ },
        displaced: true,
        downTimer: PED_DOWN_TIME,
      }
      outSpeed *= 0.6
      hits += 1
    }
  }

  return { pedestrians: moved, speed: outSpeed, hits }
}
