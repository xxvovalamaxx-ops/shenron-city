/**
 * Laser weapon pure logic — no renderer, fully testable.
 *
 * The weapon is a continuous beam that accumulates heat while firing.
 * Overheating forces a cooldown. Damage is applied per frame to whatever
 * the raycast hits.
 */

export const LASER_CONFIG = {
  /** Heat accumulated per second while firing. */
  heatRate: 35,
  /** Heat dissipated per second while not firing. */
  coolRate: 18,
  /** Heat threshold that triggers overheat. */
  overheatThreshold: 100,
  /** Forced cooldown duration in seconds. */
  cooldownDuration: 2.0,
  /** Damage per second dealt to breakable objects. */
  dps: 60,
  /** Maximum raycast distance in metres. */
  maxRange: 120,
  /** Beam visual width. */
  beamRadius: 0.025,
  /** Core glow radius (wider than beam for bloom). */
  glowRadius: 0.08,
  /** Impact flash duration in seconds. */
  flashDuration: 0.12,
  /** Damage per frame = dps * dt. Used by DestructionSystem. */
  damagePerFrame(dps: number, dt: number): number {
    return dps * dt
  },
} as const

export interface LaserState {
  heat: number
  overheated: boolean
  cooldownTimer: number
}

export function createLaserState(): LaserState {
  return { heat: 0, overheated: false, cooldownTimer: 0 }
}

/**
 * Advance the laser state by one frame.
 * Returns the updated state (mutates in place for zero-alloc hot path).
 */
export function stepLaser(
  state: LaserState,
  firing: boolean,
  dt: number,
): LaserState {
  if (state.overheated) {
    state.cooldownTimer -= dt
    if (state.cooldownTimer <= 0) {
      state.overheated = false
      state.heat = 0
      state.cooldownTimer = 0
    } else {
      state.heat = Math.max(0, state.heat - LASER_CONFIG.coolRate * dt * 1.5)
    }
    return state
  }

  if (firing) {
    state.heat = Math.min(LASER_CONFIG.overheatThreshold, state.heat + LASER_CONFIG.heatRate * dt)
    if (state.heat >= LASER_CONFIG.overheatThreshold) {
      state.overheated = true
      state.cooldownTimer = LASER_CONFIG.cooldownDuration
    }
  } else {
    state.heat = Math.max(0, state.heat - LASER_CONFIG.coolRate * dt)
  }

  return state
}

/** Effective beam color shifts from teal to orange to red as heat rises. */
export function beamColor(heat: number): string {
  const t = heat / LASER_CONFIG.overheatThreshold
  if (t < 0.4) return '#2dd4bf'
  if (t < 0.7) return '#f59e0b'
  return '#ef4444'
}
