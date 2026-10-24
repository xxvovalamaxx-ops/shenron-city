/**
 * What the on-foot simulation publishes for the body and the camera.
 *
 * GameLoop writes it once per frame; PlayerAvatar, the character's clip
 * blender and the walk camera read it. Module state, not React state, for
 * the usual reason: it changes every frame.
 */
import { createFootState, type FootState } from './on-foot'

export interface PlayerMotion {
  foot: FootState
  /** Measured horizontal ground speed after collision, m/s, smoothed. */
  groundSpeed: number
  grounded: boolean
  /** Simulation seconds of the last take-off, or -Infinity. */
  jumpedAt: number
  /** Simulation seconds of the last touch-down, or -Infinity. */
  landedAt: number
  /** How long the last airborne spell lasted, seconds. */
  lastAirTime: number
  /** Simulation seconds when the current (or last) airborne spell began. */
  airborneSince: number
  /** Stride phase for the camera's head-bob, radians. */
  bobPhase: number
}

export const playerMotion: PlayerMotion = {
  foot: createFootState(Math.PI),
  groundSpeed: 0,
  grounded: true,
  jumpedAt: Number.NEGATIVE_INFINITY,
  landedAt: Number.NEGATIVE_INFINITY,
  lastAirTime: 0,
  airborneSince: Number.NEGATIVE_INFINITY,
  bobPhase: 0,
}

/** Face the body along a world heading (x, z) and stop it dead. */
export function resetPlayerMotion(forwardX: number, forwardZ: number): void {
  const len = Math.hypot(forwardX, forwardZ)
  const yaw = len > 1e-6 ? Math.atan2(forwardX / len, forwardZ / len) : playerMotion.foot.bodyYaw
  playerMotion.foot = createFootState(yaw)
  playerMotion.groundSpeed = 0
}
