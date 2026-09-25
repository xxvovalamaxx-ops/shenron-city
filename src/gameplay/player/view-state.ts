/**
 * What the screen furniture needs from the frame: where the player is, which
 * way the camera looks, how fast things are moving.
 *
 * The radar redraws on its own animation frame (it is DOM, not scene), so
 * rather than routing 60 Hz values through React state it reads this object,
 * which GameLoop refreshes after the camera is placed each frame.
 */
import type { Camera } from 'three'
import { Vector3 } from 'three'

export interface ViewState {
  x: number
  z: number
  /**
   * Camera heading as a compass bearing, radians clockwise from north
   * (north is world -Z). The radar rotates the map by minus this.
   */
  heading: number
  /** Player (or vehicle) ground speed, m/s. */
  speed: number
  driving: boolean
  /** True once a frame has been published. */
  live: boolean
}

export const viewState: ViewState = { x: 0, z: 0, heading: 0, speed: 0, driving: false, live: false }

const dir = new Vector3()

/** Compass bearing of a world-space horizontal direction. */
export function bearingOf(x: number, z: number): number {
  return Math.atan2(x, -z)
}

export function publishView(camera: Camera, x: number, z: number, speed: number, driving: boolean): void {
  camera.getWorldDirection(dir)
  if (Math.hypot(dir.x, dir.z) > 1e-4) viewState.heading = bearingOf(dir.x, dir.z)
  viewState.x = x
  viewState.z = z
  viewState.speed = Number.isFinite(speed) ? speed : 0
  viewState.driving = driving
  viewState.live = true
}
