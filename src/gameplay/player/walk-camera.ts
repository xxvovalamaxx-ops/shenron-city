/**
 * The on-foot camera: GTA orbit in third person, the head in first person.
 *
 * Reads the mouse-owned angles from `look`, the body from `playerMotion`,
 * and writes the THREE camera once per frame. The geometry lives in
 * `orbit-camera.ts` (pure, tested); this module is the glue that samples the
 * world for it — the building sweep through `manhattanCollision`, the ground
 * height under the camera — and owns the smoothing state.
 */
import type { PerspectiveCamera } from 'three'
import { rt } from '../runtime'
import { EYE_HEIGHT } from '../collision'
import { smoothBoom } from '../camera-boom'
import { manhattanCollision } from '../../world/manhattan-collision'
import { look, setLookFirstPerson } from './look-state'
import { playerMotion } from './player-motion'
import {
  ORBIT_AIM_DISTANCE,
  ORBIT_AIM_SHOULDER,
  ORBIT_DISTANCE,
  ORBIT_PIVOT_HEIGHT,
  ORBIT_SHOULDER,
  boomReach,
  damp,
  dampAngle,
  followPivot,
  groundLimitedReach,
  headBob,
  orbitCameraPose,
  orbitFov,
  angleDelta,
  type V3,
} from './orbit-camera'
import { SPRINT_SPEED } from './on-foot'

/** Mouse idle this long while running, and the camera starts to swing behind. */
const AUTO_FOLLOW_DELAY_MS = 1600

export const cameraPrefs = {
  /** Base vertical FOV from the settings menu, degrees. */
  fov: 72,
}

export class WalkCamera {
  private pivot: V3 | null = null
  private boom = ORBIT_DISTANCE
  private distance = ORBIT_DISTANCE
  private shoulder = ORBIT_SHOULDER
  private fov: number | null = null

  /** Forget the smoothing so the next frame snaps (teleport, vehicle exit). */
  reset(): void {
    this.pivot = null
    this.boom = ORBIT_DISTANCE
    this.distance = ORBIT_DISTANCE
  }

  update(camera: PerspectiveCamera, dt: number, now: number): void {
    const p = rt.player
    const motion = playerMotion
    const foot = motion.foot
    setLookFirstPerson(!rt.thirdPerson)

    const speed = motion.groundSpeed
    const sprint = foot.sprintBlend
    const aim = rt.thirdPerson ? foot.aimBlend : 0

    // ── Auto-follow: a running player with the mouse at rest gets the camera
    //    swung gently in behind them, the way GTA's does. Never while aiming,
    //    and never when running at the camera (that would spin it round).
    if (rt.thirdPerson && !look.aiming && speed > 1.2 && now - look.lastInputAt > AUTO_FOLLOW_DELAY_MS) {
      const behind = foot.bodyYaw + Math.PI // camera yaw that looks along the body
      const delta = Math.abs(angleDelta(look.yaw, behind))
      if (delta < (110 * Math.PI) / 180) {
        const rate = 0.5 + 0.9 * Math.min(1, speed / SPRINT_SPEED)
        look.yaw = dampAngle(look.yaw, behind, rate, dt)
      }
      look.pitch = damp(look.pitch, -0.14, 0.8, dt)
    }

    // ── Field of view ─────────────────────────────────────────────────────
    const wantFov = rt.thirdPerson ? orbitFov(cameraPrefs.fov, sprint, aim) : cameraPrefs.fov + 4 * sprint
    this.fov = this.fov === null ? wantFov : damp(this.fov, wantFov, 6, dt)
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov
      camera.updateProjectionMatrix()
    }

    camera.rotation.order = 'YXZ'

    if (!rt.thirdPerson) {
      const bob = headBob(motion.bobPhase, sprint * 0.6)
      camera.position.set(p.pos.x, p.pos.y + EYE_HEIGHT + bob.y, p.pos.z)
      camera.rotation.set(look.pitch, look.yaw, 0)
      this.pivot = null
      return
    }

    // ── Pivot: the head, with a little follow lag ─────────────────────────
    const head = { x: p.pos.x, y: p.pos.y + ORBIT_PIVOT_HEIGHT, z: p.pos.z }
    this.pivot = this.pivot === null ? head : followPivot(this.pivot, head, dt)
    const pivot = this.pivot

    // ── Boom length and shoulder: pulled in when aiming ───────────────────
    this.distance = damp(this.distance, ORBIT_DISTANCE + (ORBIT_AIM_DISTANCE - ORBIT_DISTANCE) * aim, 8, dt)
    this.shoulder = damp(this.shoulder, ORBIT_SHOULDER + (ORBIT_AIM_SHOULDER - ORBIT_SHOULDER) * aim, 8, dt)

    const wanted = orbitCameraPose(pivot, look, this.distance, this.shoulder).position
    const dx = wanted.x - pivot.x
    const dy = wanted.y - pivot.y
    const dz = wanted.z - pivot.z
    const length = Math.hypot(dx, dy, dz)
    const unit = length > 1e-6 ? { x: dx / length, y: dy / length, z: dz / length } : { x: 0, y: 0, z: 1 }

    // Walls: sweep the boom against the same building BVHs that stop the
    // player, and pull the camera in front of the first hit.
    const hit = manhattanCollision.castDistance(pivot, unit, length, 0)
    let reach = boomReach(length, hit < length ? hit : null)
    // Ground: looking up swings the camera low; slide it along the pavement.
    const groundY = manhattanCollision.groundHeightAt(wanted.x, wanted.z) ?? p.pos.y
    reach = Math.min(reach, groundLimitedReach(pivot, wanted, groundY))
    this.boom = smoothBoom(this.boom, reach, dt)

    // A subtle sprint bob on top, in camera space.
    const bob = headBob(motion.bobPhase, sprint + 0.2 * Math.min(1, speed / 4.3) * (1 - sprint))
    const rightX = Math.cos(look.yaw)
    const rightZ = -Math.sin(look.yaw)
    camera.position.set(
      pivot.x + unit.x * this.boom + rightX * bob.x,
      pivot.y + unit.y * this.boom + bob.y,
      pivot.z + unit.z * this.boom + rightZ * bob.x,
    )
    camera.rotation.set(look.pitch, look.yaw, 0)
  }
}
