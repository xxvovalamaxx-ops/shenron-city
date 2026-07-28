/**
 * Which locomotion clip the player avatar should be playing.
 *
 * The Quaternius rig ships a full set — Idle_Loop, Walk_Loop, Jog_Fwd_Loop,
 * Sprint_Loop, Jump_Loop — so the avatar can match what the player is actually
 * doing rather than looping one clip forever. Thresholds are taken from the
 * movement code rather than invented: GameLoop walks at 4.3 m/s and sprints at
 * 7.1, so the bands have to straddle those two numbers or sprinting would look
 * identical to walking.
 *
 * Pure, so the state machine is testable without a renderer or a GPU.
 */

export type PlayerMotion =
  | 'Idle_Loop'
  | 'Walk_Loop'
  | 'Jog_Fwd_Loop'
  | 'Sprint_Loop'
  | 'Jump_Loop'

/** Below this the player is standing still, not creeping. */
export const IDLE_SPEED = 0.35

/** WALK_SPEED in gameplay/GameLoop.tsx. */
export const WALK_SPEED = 4.3
/** SPRINT_SPEED in gameplay/GameLoop.tsx. */
export const SPRINT_SPEED = 7.1

/** A stroll tops out here; above it the run cycle reads better. */
export const STROLL_SPEED = 2.2

export interface PlayerLocomotionInput {
  /** Horizontal ground speed, metres per second. */
  speed: number
  /** False while airborne. */
  grounded: boolean
}

/**
 * Airborne wins over everything: a player mid-jump running a walk cycle is the
 * kind of thing that reads as broken even when the feet happen to line up.
 */
export function playerMotionFor({ speed, grounded }: PlayerLocomotionInput): PlayerMotion {
  if (!grounded) return 'Jump_Loop'
  if (!Number.isFinite(speed) || speed < IDLE_SPEED) return 'Idle_Loop'
  if (speed < STROLL_SPEED) return 'Walk_Loop'
  if (speed < (WALK_SPEED + SPRINT_SPEED) / 2) return 'Jog_Fwd_Loop'
  return 'Sprint_Loop'
}

/**
 * Ground speed each clip is authored for, so playback can be rate-matched the
 * same way the crowd's is. Measured against the rig's own stride, in the same
 * body-height units agents/locomotion.ts uses.
 */
export const CLIP_REFERENCE_SPEED: Record<PlayerMotion, number> = {
  Idle_Loop: 0,
  Walk_Loop: 1.45,
  Jog_Fwd_Loop: 3.4,
  Sprint_Loop: 6.2,
  Jump_Loop: 0,
}

/**
 * Playback rate for a clip at a given speed.
 *
 * Clips with no forward motion — idle, jump — play at their authored rate:
 * scaling them by ground speed would make a standing character breathe faster
 * the quicker they had been running.
 */
export function playerAnimationRate(motion: PlayerMotion, speed: number): number {
  const reference = CLIP_REFERENCE_SPEED[motion]
  if (reference <= 0) return 1
  if (!Number.isFinite(speed) || speed <= 0) return 1
  return Math.min(1.8, Math.max(0.4, speed / reference))
}
