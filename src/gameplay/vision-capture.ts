/**
 * Capture-instrumentation for the visual QA bridge.
 *
 * Opt-in via `?visionCapture=1` plus explicit numeric parameters. Without the
 * flag this module returns null and the game is byte-for-byte identical to a
 * normal session. It performs no network I/O, exposes no global, and only
 * writes DOM dataset attributes (the same mechanism the perf/audio overlays
 * already use) so the external capture runner can read the pose back.
 *
 * Every number is validated: a malformed query cannot place the camera
 * off-world or produce NaN. FOV, hour and rain are clamped; anything outside
 * the clamps refuses the capture request rather than half-applying it.
 */
import type { Vec3 } from './collision'

export interface VisionCaptureSpec {
  enabled: true
  position: Vec3
  target: Vec3
  fov: number
  /** Hours, 0..24. Overrides the runtime clock for a reproducible sky. */
  time: number
  /** 0 dry, 1 downpour. Pre-saturated so the road is already wet. */
  rain: number
  /** Stable provenance string recorded verbatim in capture metadata. */
  seed: string
}

const MIN_FOV = 40
const MAX_FOV = 100

function parseFloatSafe(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseVec3(x: string | null, y: string | null, z: string | null): Vec3 | null {
  const px = parseFloatSafe(x)
  const py = parseFloatSafe(y)
  const pz = parseFloatSafe(z)
  if (px === null || py === null || pz === null) return null
  return { x: px, y: py, z: pz }
}

/** Validate a URL search string into a capture spec, or null. */
export function visionCaptureSpec(search: string): VisionCaptureSpec | null {
  const params = new URLSearchParams(search)
  if (params.get('visionCapture') !== '1') return null

  const position = parseVec3(
    params.get('visionX'),
    params.get('visionY'),
    params.get('visionZ'),
  )
  const target = parseVec3(
    params.get('visionTX'),
    params.get('visionTY'),
    params.get('visionTZ'),
  )
  if (!position || !target) return null

  const fov = parseFloatSafe(params.get('visionFov'))
  if (fov === null || fov < MIN_FOV || fov > MAX_FOV) return null

  const time = parseFloatSafe(params.get('visionTime'))
  if (time === null || time < 0 || time > 24) return null

  const rain = parseFloatSafe(params.get('visionRain'))
  if (rain === null || rain < 0 || rain > 1) return null

  // Keep the pose inside the playable volume so zone visibility resolves like
  // a real walk-through and the world does not half-stream.
  const insideWorld =
    Math.abs(position.x) < 4000 &&
    position.y > -50 &&
    position.y < 1200 &&
    Math.abs(position.z) < 4000

  return insideWorld
    ? {
        enabled: true,
        position,
        target,
        fov,
        time,
        rain,
        seed: params.get('visionSeed') ?? 'default',
      }
    : null
}

/** DOM dataset key holding the pose the runner reads back. */
export const VISION_CAMERA_DATASET_KEY = 'visionCamera'

/** DOM dataset key the runner polls before capturing. */
export const VISION_READY_DATASET_KEY = 'visionReady'

/** Camera eye height above the feet position, shared with collision. */
export const VISION_EYE_HEIGHT = 1.66

/** Anchored feet position for the capture camera. */
export function visionFeet(spec: VisionCaptureSpec): Vec3 {
  return {
    x: spec.position.x,
    y: spec.position.y - VISION_EYE_HEIGHT,
    z: spec.position.z,
  }
}
