/**
 * Bring the Kenney citizen's arms down to a human hang.
 *
 * The asset models its arms straight out to the sides — measured at 84.9° from
 * vertical in the bind pose and 85.9° / 87.9° averaged across the Idle and Run
 * clips. That is the character's authored style, not a bug in our animation
 * code, and it is why a crowd of them reads as a street full of scarecrows. No
 * choice of clip fixes it, because every clip starts from the same arms-out
 * skeleton.
 *
 * So the pose is corrected additively after the mixer writes each frame: the
 * clip's swing is preserved, the whole arm just hangs lower. Applying it after
 * `mixer.update()` is safe and does not accumulate, because the mixer
 * overwrites bone rotation wholesale every frame rather than integrating it.
 *
 * The two sides use different axes and signs. That looks like a mistake and is
 * not: this rig's left and right arm bones are not mirrored in local space.
 * Measured on the shipped GLB, rotating the run pose by 55°:
 *
 *   LeftArm  .rotation.z -= 55°   ->  84.9° becomes 29.9°
 *   RightArm .rotation.x += 55°   ->  84.9° becomes 37.5°
 *
 * Rotating the right arm on z instead moves it barely 10°, which is how the
 * asymmetry was found.
 */

/** How far to drop the arms, in radians. 55° lands both near a natural hang. */
export const ARM_DROP = (55 * Math.PI) / 180

/** Bone names this correction applies to, in the Kenney citizen rig. */
export const LEFT_ARM_BONE = 'LeftArm'
export const RIGHT_ARM_BONE = 'RightArm'

/** Minimal shape we need — avoids importing three into a pure module. */
export interface Rotatable {
  rotation: { x: number; y: number; z: number }
}

/**
 * Apply the drop to one already-posed frame.
 *
 * Null-tolerant: a rig without these bones is a different character, not an
 * error, and should render its own pose untouched.
 */
export function dropArms(
  left: Rotatable | null | undefined,
  right: Rotatable | null | undefined,
  drop: number = ARM_DROP,
): void {
  if (!Number.isFinite(drop) || drop === 0) return
  if (left) left.rotation.z -= drop
  if (right) right.rotation.x += drop
}
