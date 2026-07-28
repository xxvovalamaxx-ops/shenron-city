/**
 * Capsule-vs-AABB collision for a box-shaped world.
 *
 * No physics engine. The vertical slice has no dynamic bodies — every collider
 * is a static box, and the one moving platform (the elevator car) carries the
 * player by parenting rather than by friction. A deterministic sweep is easier
 * to reason about here than a solver, and it makes the elevator trivial
 * instead of fiddly. See docs/STACK_DECISIONS.md.
 *
 * Pure and framework-free so it can be unit tested without a renderer.
 */

export interface AABB {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const PLAYER_RADIUS = 0.34
export const PLAYER_HEIGHT = 1.78
export const EYE_HEIGHT = 1.66
/** Ledges up to this high are walked over, not blocked. Kerbs, low steps. */
export const STEP_HEIGHT = 0.42

export function aabb(
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
): AABB {
  return {
    min: [cx - sx / 2, cy - sy / 2, cz - sz / 2],
    max: [cx + sx / 2, cy + sy / 2, cz + sz / 2],
  }
}

/** Does the player's vertical cylinder at `p` (feet position) overlap `b`? */
function overlaps(p: Vec3, b: AABB, radius: number, height: number): boolean {
  if (p.y + height <= b.min[1] || p.y >= b.max[1]) return false
  // Closest point on the box footprint to the cylinder axis.
  const cx = Math.max(b.min[0], Math.min(p.x, b.max[0]))
  const cz = Math.max(b.min[2], Math.min(p.z, b.max[2]))
  const dx = p.x - cx
  const dz = p.z - cz
  return dx * dx + dz * dz < radius * radius
}

export function collidesAt(p: Vec3, colliders: readonly AABB[]): boolean {
  for (const b of colliders) {
    if (overlaps(p, b, PLAYER_RADIUS, PLAYER_HEIGHT)) return true
  }
  return false
}

/** Highest surface directly under the player within `probe` metres. */
export function groundHeight(p: Vec3, colliders: readonly AABB[], probe = 2.0): number | null {
  let best: number | null = null
  for (const b of colliders) {
    const cx = Math.max(b.min[0], Math.min(p.x, b.max[0]))
    const cz = Math.max(b.min[2], Math.min(p.z, b.max[2]))
    const dx = p.x - cx
    const dz = p.z - cz
    if (dx * dx + dz * dz >= PLAYER_RADIUS * PLAYER_RADIUS) continue
    const top = b.max[1]
    if (top <= p.y + STEP_HEIGHT && top >= p.y - probe) {
      if (best === null || top > best) best = top
    }
  }
  return best
}

export interface MoveResult {
  position: Vec3
  grounded: boolean
  /** Vertical velocity after the move, so the caller can keep integrating. */
  velocityY: number
}

/**
 * Longest distance resolved in a single collision test.
 *
 * Must stay below half the thinnest collider in the world (the sliding door
 * leaves, at 0.16 m) or a large step can pass clean through it. Testing only
 * the destination — the obvious implementation — tunnels the moment a frame
 * hitch produces a big delta, and that bug reproduces roughly never while
 * being catastrophic when it does.
 */
const MAX_SUBSTEP = 0.07

/** Refuse to move further than this in one frame, however long the frame was. */
const MAX_FRAME_TRAVEL = 6

/**
 * Advance the player one frame.
 *
 * Horizontal motion is swept in substeps so thin geometry cannot be skipped.
 * Within each substep the axes are resolved independently so that sliding
 * along a wall works: blocking X does not also cancel Z. A blocked axis retries
 * once at +STEP_HEIGHT, which is what lets the player walk up kerbs without a
 * ramp.
 */
export function moveWithCollisions(
  position: Vec3,
  desired: { x: number; z: number },
  velocityY: number,
  dt: number,
  colliders: readonly AABB[],
  gravity = -22,
): MoveResult {
  let { x, y, z } = position

  // ── Horizontal, swept ─────────────────────────────────────────────────────
  let dx = desired.x
  let dz = desired.z
  const distance = Math.hypot(dx, dz)

  if (distance > MAX_FRAME_TRAVEL) {
    const scale = MAX_FRAME_TRAVEL / distance
    dx *= scale
    dz *= scale
  }

  const steps = Math.max(1, Math.ceil(Math.min(distance, MAX_FRAME_TRAVEL) / MAX_SUBSTEP))
  const sx = dx / steps
  const sz = dz / steps

  for (let i = 0; i < steps; i++) {
    let movedAny = false

    for (const axis of ['x', 'z'] as const) {
      const delta = axis === 'x' ? sx : sz
      if (delta === 0) continue

      const tryPos: Vec3 = { x, y, z }
      tryPos[axis] += delta

      if (!collidesAt(tryPos, colliders)) {
        x = tryPos.x
        z = tryPos.z
        movedAny = true
        continue
      }

      // Blocked — try stepping up over a low ledge.
      const stepped: Vec3 = { ...tryPos, y: y + STEP_HEIGHT }
      if (!collidesAt(stepped, colliders)) {
        const ground = groundHeight(stepped, colliders)
        if (ground !== null && ground - y <= STEP_HEIGHT + 1e-3) {
          x = stepped.x
          z = stepped.z
          y = ground
          movedAny = true
        }
      }
      // Otherwise this axis stays put; the other axis still gets its chance.
    }

    // Fully wedged: no point burning the remaining substeps.
    if (!movedAny) break
  }

  // ── Vertical ──────────────────────────────────────────────────────────────
  let vy = velocityY + gravity * dt
  const fall = vy * dt
  let ny = y + fall
  let grounded = false

  // Probe at least as far as this frame's fall, so a fast descent cannot drop
  // through the floor between two samples.
  const probe = Math.max(2, Math.abs(fall) + 1)
  const support = groundHeight({ x, y: y + STEP_HEIGHT, z }, colliders, probe)
  if (support !== null && ny <= support) {
    ny = support
    vy = 0
    grounded = true
  }

  // Head clearance: cancel upward motion into a ceiling instead of tunnelling.
  if (vy > 0 && collidesAt({ x, y: ny, z }, colliders)) {
    ny = y
    vy = 0
  }

  return { position: { x, y: ny, z }, grounded, velocityY: vy }
}
