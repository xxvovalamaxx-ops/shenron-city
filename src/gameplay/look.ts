/**
 * Look angles, and the one rule that turns mouse movement into them.
 *
 * The game's camera orientation is written as an Euler in YXZ order — yaw
 * around world up, pitch around the camera's own right — and everything
 * downstream (movement direction, the third-person boom) reads it back through
 * `camera.getWorldDirection()`. PointerLockControls does this internally; when
 * pointer lock is unavailable the drag fallback has to produce *identical*
 * angles or the two input paths would feel different.
 *
 * Kept separate from any component so the clamping is testable without a
 * browser: a pitch that passes straight up flips the camera, and that is a bug
 * you want caught by arithmetic rather than by noticing the world upside down.
 */

/** Radians per pixel of mouse movement, before sensitivity. Matches three's
 *  PointerLockControls, so both paths respond the same. */
export const LOOK_RADIANS_PER_PIXEL = 0.002

/** How far the camera may pitch before it would pass through vertical. */
export const PITCH_LIMIT = Math.PI / 2 - 0.02

export interface LookAngles {
  /** Radians around world up. Unbounded: turning right forever is fine. */
  yaw: number
  /** Radians around the camera's right axis, clamped to +/-PITCH_LIMIT. */
  pitch: number
}

/**
 * Fold one mouse movement into the current angles.
 *
 * `dx`/`dy` are raw pixel deltas. Both subtract, matching the pointer-lock
 * convention: moving the mouse right turns the view right, which is a *negative*
 * yaw in a right-handed Y-up frame.
 */
export function applyLookDelta(
  angles: LookAngles,
  dx: number,
  dy: number,
  sensitivity = 1,
): LookAngles {
  const scale = LOOK_RADIANS_PER_PIXEL * sensitivity
  // A non-finite delta (a synthetic event, a detached pointer) would poison the
  // angles permanently, and there is no recovering a NaN camera.
  const safeDx = Number.isFinite(dx) ? dx : 0
  const safeDy = Number.isFinite(dy) ? dy : 0
  const yaw = angles.yaw - safeDx * scale
  const pitch = angles.pitch - safeDy * scale
  return {
    yaw: Number.isFinite(yaw) ? yaw : angles.yaw,
    pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)),
  }
}

/**
 * Read the angles back off a camera's Euler.
 *
 * Only correct when the Euler is already in YXZ order, which is why
 * `lookAnglesFromDirection` exists and is what callers should use. Kept
 * because reading `rotation.x`/`rotation.y` off a YXZ camera is exact and
 * cheap, and the drag controller re-reads its own camera mid-drag.
 *
 * Do not point this at a camera that was last oriented by `lookAt`. See
 * `lookAnglesFromDirection`.
 */
export function lookAnglesFrom(rotation: { x: number; y: number }): LookAngles {
  return {
    yaw: Number.isFinite(rotation.y) ? rotation.y : 0,
    pitch: Math.max(
      -PITCH_LIMIT,
      Math.min(PITCH_LIMIT, Number.isFinite(rotation.x) ? rotation.x : 0),
    ),
  }
}

/**
 * Recover yaw and pitch from the direction a camera is actually facing.
 *
 * This is the safe one, and the reason is a bug it caused. `lookAnglesFrom`
 * takes `rotation.x` as pitch and `rotation.y` as yaw and drops `rotation.z`.
 * That is only true of a YXZ Euler. `Object3D.lookAt` writes a quaternion, and
 * `camera.rotation` then decomposes it in whatever order the camera happens to
 * carry — `XYZ` by default — where a steep downward look puts a large value in
 * `z`. Reading x and y from that and re-applying them as YXZ pitch and yaw
 * silently discards the z term, and the view arrives rotated.
 *
 * Measured on the intro dive, which ends looking down at the player: the Euler
 * read was 12.9 degrees out for most of the flight and left the camera's up
 * vector at y = 0.53 — visibly rolled. Deriving from the forward vector is
 * exact (0.0 degrees) at every point of the same flight, because a direction
 * has no rotation order to disagree about.
 *
 * The inverse of `camera.rotation.set(pitch, yaw, 0)` in YXZ order, whose
 * forward is `(-sin y * cos p, sin p, -cos y * cos p)`.
 */
export function lookAnglesFromDirection(direction: {
  x: number
  y: number
  z: number
}): LookAngles {
  const { x, y, z } = direction
  const length = Math.hypot(x, y, z)
  // A zero or non-finite direction has no heading to recover; facing along -z
  // is the identity orientation and beats returning NaN.
  if (!Number.isFinite(length) || length < 1e-9) return { yaw: 0, pitch: 0 }
  const ny = y / length
  return {
    yaw: Math.atan2(-x / length, -z / length),
    pitch: Math.max(
      -PITCH_LIMIT,
      Math.min(PITCH_LIMIT, Math.asin(Math.max(-1, Math.min(1, ny)))),
    ),
  }
}
