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

/** Read the angles back off a camera's Euler, so a fallback can pick up
 *  wherever pointer lock (or the intro camera) left the view. */
export function lookAnglesFrom(rotation: { x: number; y: number }): LookAngles {
  return {
    yaw: Number.isFinite(rotation.y) ? rotation.y : 0,
    pitch: Math.max(
      -PITCH_LIMIT,
      Math.min(PITCH_LIMIT, Number.isFinite(rotation.x) ? rotation.x : 0),
    ),
  }
}
