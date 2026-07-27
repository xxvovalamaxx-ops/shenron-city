/**
 * Automatic door behaviour.
 *
 * Pure, so the safety property that matters — a door never closes on the
 * player — is unit-testable without a renderer.
 *
 * Hysteresis is deliberate: the trigger volume for opening is smaller than the
 * one for staying open. Without that, standing exactly on the boundary makes
 * the doors chatter open/shut every frame, which looks broken and is the most
 * common way naive auto-doors fail.
 */

export interface DoorState {
  /** 0 = shut, 1 = fully open. */
  openness: number
  /** Seconds remaining before a clear door is allowed to start closing. */
  dwell: number
}

export interface DoorConfig {
  /** Half-extent on X of the trigger box, centred on the doorway. */
  triggerHalfWidth: number
  /** Half-extent on Z. */
  triggerHalfDepth: number
  /** Extra margin added to the trigger once the door is already open. */
  hysteresis: number
  /** Seconds the door stays open after the player leaves. */
  dwellTime: number
  /** Seconds for a full open or close. */
  travelTime: number
}

/**
 * Sized against walking speed, not by eye.
 *
 * The player walks at 4.3 m/s. The sensor must see them far enough out that
 * the door is fully open before they reach the threshold, or they walk into a
 * half-open door and the building feels broken. 7 m of approach buys ~1.6 s
 * against a 0.9 s open — comfortable margin, and it still leaves the door shut
 * when nobody is near it.
 */
export const DEFAULT_DOOR: DoorConfig = {
  triggerHalfWidth: 5.5,
  triggerHalfDepth: 7.0,
  hysteresis: 2.0,
  dwellTime: 1.8,
  travelTime: 0.9,
}

export const initialDoor = (): DoorState => ({ openness: 0, dwell: 0 })

export interface DoorInput {
  /** Player position relative to the doorway centre. */
  dx: number
  dz: number
  dt: number
  config?: DoorConfig
}

export function stepDoor(state: DoorState, input: DoorInput): DoorState {
  const cfg = input.config ?? DEFAULT_DOOR
  const isOpen = state.openness > 0.01
  const margin = isOpen ? cfg.hysteresis : 0

  const inside =
    Math.abs(input.dx) <= cfg.triggerHalfWidth + margin &&
    Math.abs(input.dz) <= cfg.triggerHalfDepth + margin

  // Being in the doorway refreshes the dwell timer every frame. A door can
  // therefore never begin closing while the player is inside it.
  const dwell = inside ? cfg.dwellTime : Math.max(0, state.dwell - input.dt)

  const rate = input.dt / cfg.travelTime
  const openness = inside || dwell > 0
    ? Math.min(1, state.openness + rate)
    : Math.max(0, state.openness - rate)

  return { openness, dwell }
}

/** True when the gap is wide enough to walk through without clipping. */
export function isPassable(state: DoorState): boolean {
  return state.openness > 0.75
}

/**
 * How far each leaf of a centre-parting pair sits from the doorway centre.
 *
 * Returned as a positive magnitude: the left leaf goes to `-offset`, the right
 * to `+offset`. Each leaf mesh is `halfWidth` wide and centred on its own
 * origin, so its inner edge lands at `offset - halfWidth / 2` from centre.
 *
 * Shipped inverted once — the leaves parted when shut and closed over the
 * opening as they opened, while the collider did the opposite, so you could
 * walk through a door that looked closed. Hence the pure function and the
 * tests below it.
 */
export function leafOffset(halfWidth: number, openness: number): number {
  const o = openness < 0 ? 0 : openness > 1 ? 1 : openness
  return halfWidth * (0.5 + o)
}

/**
 * Signed position of a leaf's inner edge relative to the doorway centre.
 *
 * 0 when shut (the leaves meet), ±halfWidth when fully open (each leaf is
 * clear of the opening). This is the quantity that has to agree with the
 * collision geometry.
 */
export function leafInnerEdge(halfWidth: number, openness: number): number {
  return leafOffset(halfWidth, openness) - halfWidth / 2
}
