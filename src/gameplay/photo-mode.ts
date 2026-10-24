/**
 * Photo mode: the world freezes, the HUD goes away and a free camera can be
 * flown around the frozen scene, GTA-style. It stays on a leash around where
 * it started, so it is a camera for framing the moment, not a way to scout.
 *
 * Pure: state in, state out. The game loop feeds it keys and mouse deltas
 * and copies the result onto the THREE camera.
 */
import type { Vec3 } from './collision'
import { applyLookDelta, PITCH_LIMIT } from './look'

/** How far the camera may wander from where photo mode began, metres. */
export const PHOTO_LEASH = 40
export const PHOTO_SPEED = 4
export const PHOTO_FAST = 3.5
export const PHOTO_FOV_MIN = 15
export const PHOTO_FOV_MAX = 100
/** Never below this height over the ground at the anchor. */
export const PHOTO_MIN_CLEARANCE = 0.25

export interface PhotoCamera {
  anchor: Vec3
  pos: Vec3
  yaw: number
  pitch: number
  /** Degrees. */
  fov: number
  /** Degrees, positive leans the horizon clockwise. */
  roll: number
}

export interface PhotoInput {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  fast: boolean
  lookDx: number
  lookDy: number
  /** Wheel notches, positive zooms in. */
  zoom: number
  /** -1 / 0 / 1 per frame. */
  rollDir: number
}

export const NO_PHOTO_INPUT: PhotoInput = {
  forward: false, back: false, left: false, right: false, up: false, down: false, fast: false,
  lookDx: 0, lookDy: 0, zoom: 0, rollDir: 0,
}

export function startPhotoCamera(pos: Vec3, yaw: number, pitch: number, fov: number): PhotoCamera {
  return {
    anchor: { ...pos },
    pos: { ...pos },
    yaw,
    pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch)),
    fov: Math.max(PHOTO_FOV_MIN, Math.min(PHOTO_FOV_MAX, fov)),
    roll: 0,
  }
}

/** Camera forward for a yaw/pitch, in three's convention (yaw 0 looks down -Z). */
export function photoForward(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch)
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c }
}

export function stepPhotoCamera(s: PhotoCamera, input: PhotoInput, dt: number, groundY: number | null): PhotoCamera {
  const look = applyLookDelta({ yaw: s.yaw, pitch: s.pitch }, input.lookDx, input.lookDy, 0.7)
  // Zoom in narrows the lens; in steps that feel even across the range.
  const fov = Math.max(PHOTO_FOV_MIN, Math.min(PHOTO_FOV_MAX, s.fov * Math.pow(0.92, input.zoom)))
  const roll = Math.max(-45, Math.min(45, s.roll + input.rollDir * 40 * dt))

  const f = photoForward(look.yaw, look.pitch)
  const r = { x: Math.cos(look.yaw), z: -Math.sin(look.yaw) }
  const mv = (input.forward ? 1 : 0) - (input.back ? 1 : 0)
  const st = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const up = (input.up ? 1 : 0) - (input.down ? 1 : 0)
  const speed = PHOTO_SPEED * (input.fast ? PHOTO_FAST : 1) * Math.max(0, dt)
  let x = s.pos.x + (f.x * mv + r.x * st) * speed
  let y = s.pos.y + (f.y * mv + up) * speed
  let z = s.pos.z + (f.z * mv + r.z * st) * speed

  // The leash: a sphere around the anchor.
  const dx = x - s.anchor.x
  const dy = y - s.anchor.y
  const dz = z - s.anchor.z
  const d = Math.hypot(dx, dy, dz)
  if (d > PHOTO_LEASH) {
    const k = PHOTO_LEASH / d
    x = s.anchor.x + dx * k
    y = s.anchor.y + dy * k
    z = s.anchor.z + dz * k
  }
  if (groundY !== null && y < groundY + PHOTO_MIN_CLEARANCE) y = groundY + PHOTO_MIN_CLEARANCE

  return { anchor: s.anchor, pos: { x, y, z }, yaw: look.yaw, pitch: look.pitch, fov, roll }
}
