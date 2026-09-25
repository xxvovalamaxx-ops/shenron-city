/**
 * The one yaw/pitch the player's mouse owns.
 *
 * PointerLockControls wrote mouse movement straight into `camera.rotation`,
 * which is fine for a first-person camera and wrong for an orbit rig: the
 * third-person camera is positioned from the angles every frame, so a second
 * writer rotating the camera underneath it fights the boom and the view
 * judders. Both input paths — pointer lock (`PointerLook`) and the drag
 * fallback (`DragLook`) — now feed these angles instead, and the walk camera
 * turns them into a camera pose once per frame.
 *
 * Module state rather than React state: it changes on every mouse event.
 */
import {
  applyOrbitDelta,
  FIRST_PERSON_PITCH_LIMIT,
  ORBIT_PITCH_MAX,
  ORBIT_PITCH_MIN,
  clampPitch,
  wrapAngle,
} from './orbit-camera'

export interface LookState {
  yaw: number
  pitch: number
  /** performance.now() of the last mouse look input; drives the auto-follow. */
  lastInputAt: number
  /** Right mouse button held: over-the-shoulder aim. */
  aiming: boolean
  /** Third person clamps pitch tighter than first person. */
  firstPerson: boolean
}

export const look: LookState = {
  yaw: 0,
  pitch: -0.12,
  lastInputAt: 0,
  aiming: false,
  firstPerson: false,
}

function limits(): [number, number] {
  return look.firstPerson
    ? [-FIRST_PERSON_PITCH_LIMIT, FIRST_PERSON_PITCH_LIMIT]
    : [ORBIT_PITCH_MIN, ORBIT_PITCH_MAX]
}

/** Fold a raw mouse delta (pixels) into the look angles. */
export function feedLook(dx: number, dy: number, sensitivity = 1): void {
  if (dx === 0 && dy === 0) return
  const [min, max] = limits()
  const next = applyOrbitDelta(look, dx, dy, sensitivity, min, max)
  look.yaw = next.yaw
  look.pitch = next.pitch
  look.lastInputAt = typeof performance === 'undefined' ? 0 : performance.now()
}

/** Point the view somewhere explicitly (intro handover, vehicle exit, load). */
export function setLook(yaw: number, pitch: number): void {
  const [min, max] = limits()
  look.yaw = wrapAngle(yaw)
  look.pitch = clampPitch(pitch, min, max)
}

/** Switch between the orbit and first-person pitch ranges without a jump. */
export function setLookFirstPerson(firstPerson: boolean): void {
  if (look.firstPerson === firstPerson) return
  look.firstPerson = firstPerson
  const [min, max] = limits()
  look.pitch = clampPitch(look.pitch, min, max)
}

// Dev-only handle for automated verification: pointer lock cannot be granted
// to a synthetic click, so the capture harness steers the view through this.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __look: LookState }).__look = look
}
