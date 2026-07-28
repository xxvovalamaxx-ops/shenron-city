/**
 * Third-person camera boom.
 *
 * The camera sits behind the player's head along the view direction. The whole
 * problem is walls: a fixed-length boom pushes the camera through the lobby
 * glass, into the lift shaft, and out the back of the tower, and the player
 * spends the walk looking at the inside of geometry.
 *
 * So the boom is swept against the same colliders the player is, and pulled in
 * to the nearest hit. It reuses `AABB` from collision.ts deliberately: a boom
 * tested against a different set of boxes than the one that stops the player
 * is a boom that will eventually disagree with the world.
 *
 * Pure and renderer-free, so the geometry is unit tested rather than eyeballed.
 */
import type { AABB, Vec3 } from './collision'

/** How far back the camera sits when nothing is in the way, in metres. */
export const BOOM_DISTANCE = 3.6

/**
 * Kept off surfaces by this much. Without it the near plane clips into the
 * wall the boom just found and you see through it.
 */
export const BOOM_PADDING = 0.28

/** Never closer than this, or the camera ends up inside the player's head. */
export const MIN_BOOM = 0.45

/**
 * Distance along `direction` at which a ray from `origin` first enters `box`,
 * or null if it never does.
 *
 * Slab method. Handles a direction component of zero without dividing by it,
 * which is the case that matters here — looking straight down a corridor gives
 * exactly that.
 */
export function rayBoxDistance(
  origin: Vec3,
  direction: Vec3,
  box: AABB,
): number | null {
  let near = 0
  let far = Infinity

  const o = [origin.x, origin.y, origin.z]
  const d = [direction.x, direction.y, direction.z]

  for (let axis = 0; axis < 3; axis++) {
    const min = box.min[axis]
    const max = box.max[axis]

    if (Math.abs(d[axis]) < 1e-8) {
      // Parallel to this slab: miss unless already between its planes.
      if (o[axis] < min || o[axis] > max) return null
      continue
    }

    const inv = 1 / d[axis]
    let t0 = (min - o[axis]) * inv
    let t1 = (max - o[axis]) * inv
    if (t0 > t1) {
      const swap = t0
      t0 = t1
      t1 = swap
    }
    if (t0 > near) near = t0
    if (t1 < far) far = t1
    if (near > far) return null
  }

  return far < 0 ? null : near
}

/**
 * How far back the camera can safely sit.
 *
 * `direction` must point the way the camera looks; the boom runs the other way,
 * so callers place the camera at `eye - direction * result`.
 */
export function boomDistance(
  eye: Vec3,
  direction: Vec3,
  colliders: readonly AABB[],
  desired = BOOM_DISTANCE,
  padding = BOOM_PADDING,
): number {
  if (!Number.isFinite(desired) || desired <= 0) return 0

  // Backwards along the view.
  const back = { x: -direction.x, y: -direction.y, z: -direction.z }
  const length = Math.hypot(back.x, back.y, back.z)
  if (length < 1e-8) return desired
  const unit = { x: back.x / length, y: back.y / length, z: back.z / length }

  let limit = desired
  for (const box of colliders) {
    const hit = rayBoxDistance(eye, unit, box)
    if (hit === null || hit > limit) continue
    if (hit < limit) limit = hit
  }

  const safe = limit === desired ? desired : limit - padding
  return Math.min(desired, Math.max(MIN_BOOM, safe))
}

/**
 * Ease the boom outward but snap it inward.
 *
 * Growing slowly hides the pop as you step out of a doorway; shrinking
 * instantly is what stops the camera spending a frame inside the wall you just
 * backed into. Asymmetry here is deliberate, not an oversight.
 */
export function smoothBoom(current: number, target: number, dt: number, rate = 6): number {
  if (!Number.isFinite(current)) return target
  if (target <= current) return target
  const t = 1 - Math.exp(-rate * Math.max(0, dt))
  return current + (target - current) * t
}
