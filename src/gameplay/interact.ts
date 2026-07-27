/**
 * Interaction targeting.
 *
 * A target is offered when the player is close enough AND roughly looking at
 * it. Proximity alone makes prompts flicker between adjacent objects; the
 * facing test is what makes "press E" land on the thing you meant.
 */

export type InteractKind =
  | 'secretary'
  | 'city-character'
  | 'elevator-panel'
  | 'agent-office'

export interface Interactable {
  id: string
  kind: InteractKind
  /** World position of the interaction point. */
  x: number
  y: number
  z: number
  /** Prompt verb, e.g. "Talk to Iris". */
  label: string
  /** Metres. */
  range: number
  /** Extra payload the UI needs — an agent id, a floor, etc. */
  payload?: string
  /** Local Y offset when the target rides the elevator car. */
  movingY?: number
}

export interface AimInput {
  px: number
  py: number
  pz: number
  /** Normalised forward vector of the camera. */
  fx: number
  fz: number
}

/** Minimum cos(angle) between look direction and target. ~60° cone. */
const FACING_THRESHOLD = 0.5

/** Keep car-mounted interaction points aligned with the moving mesh. */
export function placeMovingTargets(
  candidates: readonly Interactable[],
  elevatorY: number,
): void {
  for (const candidate of candidates) {
    if (candidate.movingY !== undefined) candidate.y = elevatorY + candidate.movingY
  }
}

export function pickTarget(
  candidates: readonly Interactable[],
  aim: AimInput,
): Interactable | null {
  let best: Interactable | null = null
  let bestScore = -Infinity

  for (const c of candidates) {
    const dx = c.x - aim.px
    const dy = c.y - aim.py
    const dz = c.z - aim.pz
    const dist = Math.hypot(dx, dy, dz)
    if (dist > c.range) continue

    // Facing test in the horizontal plane — vertical aim should not decide
    // whether you can talk to someone standing next to you.
    const flat = Math.hypot(dx, dz) || 1e-6
    const facing = (dx / flat) * aim.fx + (dz / flat) * aim.fz
    if (facing < FACING_THRESHOLD) continue

    // Prefer things that are both close and well-centred.
    const score = facing * 2 - dist / c.range
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }

  return best
}
