/**
 * The on-foot branch of the frame, lifted out of GameLoop.
 *
 * GameLoop still decides *when* this runs (not driving, not paused, intro
 * over); this decides what walking, sprinting, jumping and fly mode do. Kept
 * as its own module so the vehicle work in GameLoop's driving branch and this
 * never touch the same lines.
 *
 * Order inside a step: ground probe → input → locomotion sim → collision
 * sweep → vertical integration → publish motion for the body and camera.
 */
import { rt } from '../runtime'
import type { Keys } from '../input'
import { manhattanCollision } from '../../world/manhattan-collision'
import { cityWorld } from '../../city/registry.js'
import { look } from './look-state'
import { playerMotion } from './player-motion'
import { reconcileBlocked, stepFoot } from './on-foot'
import { damp } from './orbit-camera'

export const JUMP_VELOCITY = 6.2
export const GRAVITY = -22
const FLY_SPEED = 18
const FLY_SPRINT_SPEED = 42

export class OnFootController {
  private softFloorUntil = 0

  /** Advance the walker by `dt`. `simTime` is the pause-aware clock. */
  step(k: Keys, dt: number, simTime: number): void {
    const p = rt.player
    const motion = playerMotion

    // ── Ground height under the player ──────────────────────────────────
    const ground = manhattanCollision.groundHeightAt(p.pos.x, p.pos.z)
    // The street tiles stream toward the camera; at spawn the surface may
    // not have arrived yet. Hold the player on the data land level for a
    // short grace after the base registers — long enough for the tiles to
    // stream in, short enough that walking off the island into the harbor
    // still falls instead of walking on an invisible floor.
    const dataLand = (cityWorld.city?.meta?.land_level_m as number | undefined) ?? 12
    let effectiveGround: number | null = ground
    if (ground === null && p.pos.y > dataLand - 0.5) {
      if (this.softFloorUntil === 0 && manhattanCollision.baseReady) {
        this.softFloorUntil = performance.now() + 15000
      }
      if (performance.now() < this.softFloorUntil) effectiveGround = dataLand
    } else if (ground !== null) {
      this.softFloorUntil = 0
    }

    const fwd = (k.forward ? 1 : 0) - (k.back ? 1 : 0)
    const strafe = (k.right ? 1 : 0) - (k.left ? 1 : 0)

    if (p.flying) {
      this.fly(k, fwd, strafe, dt, ground)
      motion.foot = { ...motion.foot, vx: 0, vz: 0, sprintBlend: 0 }
      motion.groundSpeed = 0
      motion.grounded = p.grounded
      return
    }

    const wasGrounded = p.grounded
    if (k.jump && p.grounded) {
      p.velocityY = JUMP_VELOCITY
      p.grounded = false
      motion.jumpedAt = simTime
    }

    motion.foot = stepFoot(
      motion.foot,
      {
        forward: fwd,
        strafe,
        sprint: k.sprint,
        aim: look.aiming && rt.thirdPerson,
        grounded: p.grounded,
        cameraYaw: look.yaw,
        speedScale: rt.devSpeed,
        firstPerson: !rt.thirdPerson,
      },
      dt,
    )

    // Horizontal move, sliding along building walls.
    const dx = motion.foot.vx * dt
    const dz = motion.foot.vz * dt
    const before = { x: p.pos.x, z: p.pos.z }
    const moved = manhattanCollision.move(p.pos, dx, dz)
    p.pos.x = moved.x
    p.pos.z = moved.z
    const mx = p.pos.x - before.x
    const mz = p.pos.z - before.z
    motion.foot = reconcileBlocked(motion.foot, mx, mz, dt)
    motion.groundSpeed = damp(motion.groundSpeed, Math.hypot(mx, mz) / Math.max(dt, 1e-4), 14, dt)

    // Vertical integration against the island surface.
    let vy = p.velocityY + GRAVITY * dt
    let ny = p.pos.y + vy * dt
    if (effectiveGround !== null) {
      if (ny <= effectiveGround) {
        ny = effectiveGround
        vy = 0
        p.grounded = true
      } else if (p.grounded && ny - effectiveGround < 0.35 && vy <= 0) {
        // Stepping down a kerb is walking, not falling: stick to the ground
        // instead of flickering into the fall clip for a frame.
        ny = effectiveGround
        vy = 0
      } else {
        p.grounded = false
      }
    } else if (ny < -200) {
      // Fell off the island edge — pull back to the last surface.
      ny = 12.4
      vy = 0
      p.grounded = true
    }
    p.pos.y = ny
    p.velocityY = vy

    if (wasGrounded && !p.grounded) motion.airborneSince = simTime
    if (!wasGrounded && p.grounded) {
      motion.landedAt = simTime
      motion.lastAirTime = Math.max(0, simTime - motion.airborneSince)
    }
    motion.grounded = p.grounded
    // Stride phase for the camera bob: ~1.4 rad per metre travelled.
    motion.bobPhase = (motion.bobPhase + Math.hypot(mx, mz) * 1.4) % (Math.PI * 2000)
  }

  /** Fly mode: unchanged from the original loop — camera-relative, no ramps. */
  private fly(k: Keys, fwd: number, strafe: number, dt: number, ground: number | null): void {
    const p = rt.player
    let dx = 0
    let dz = 0
    const flySpeed = (k.sprint ? FLY_SPRINT_SPEED : FLY_SPEED) * rt.devSpeed
    if (fwd !== 0 || strafe !== 0) {
      const fx = -Math.sin(look.yaw)
      const fz = -Math.cos(look.yaw)
      const rx = Math.cos(look.yaw)
      const rz = -Math.sin(look.yaw)
      let mx = fx * fwd + rx * strafe
      let mz = fz * fwd + rz * strafe
      const len = Math.hypot(mx, mz) || 1
      mx /= len
      mz /= len
      dx = mx * flySpeed * dt
      dz = mz * flySpeed * dt
    }
    let dy = 0
    if (k.jump) dy += flySpeed * dt
    if (k.crouch) dy -= flySpeed * dt
    const moved = manhattanCollision.move(p.pos, dx, dz)
    p.pos.x = moved.x
    p.pos.z = moved.z
    // Descending onto a tower lands on the roof rather than dropping through
    // it into the building.
    if (dy < 0) {
      const roof = manhattanCollision.buildingTopAt(p.pos.x, p.pos.z)
      if (roof !== null && p.pos.y + dy <= roof + 1) {
        p.pos.y = roof + 1
        dy = 0
        p.grounded = true
      }
    }
    p.pos.y += dy
    p.velocityY = 0
    p.grounded = p.grounded || (dy === 0 && p.pos.y <= (ground ?? 0) + 1)
    if (ground !== null && p.pos.y < ground + 0.1) {
      p.pos.y = ground + 0.1
      p.grounded = true
    }
  }
}
