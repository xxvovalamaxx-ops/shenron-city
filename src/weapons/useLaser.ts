/**
 * React hook that manages laser firing state, raycasting, and heat.
 * Runs in the GameLoop's useFrame via direct rt mutation — this hook
 * just wires the mouse events and exposes the state for the HUD.
 */
import { useEffect, useRef, useCallback } from 'react'
import { Raycaster, Vector3 } from 'three'
import { rt } from '../gameplay/runtime'
import { stepLaser, LASER_CONFIG, type LaserState } from './laser'
import type { AABB } from '../gameplay/collision'

const _raycaster = new Raycaster()
_raycaster.far = LASER_CONFIG.maxRange
const _origin = new Vector3()
const _dir = new Vector3()

export function useLaser(colliderGetter: () => AABB[]) {
  const state = useRef<LaserState>({ heat: 0, overheated: false, cooldownTimer: 0 })
  const mouseDown = useRef(false)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button === 0 && rt.keys && !rt.paused) {
        mouseDown.current = true
      }
    }
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) {
        mouseDown.current = false
      }
    }

    window.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const update = useCallback(
    (camera: { position: Vector3; getWorldDirection: (target: Vector3) => Vector3 }, dt: number) => {
      const s = state.current
      const firing = mouseDown.current && !s.overheated
      stepLaser(s, firing, dt)

      rt.player.heat = s.heat
      rt.player.firing = firing
      rt.player.overheated = s.overheated

      if (firing) {
        _origin.copy(camera.position)
        camera.getWorldDirection(_dir)
        _raycaster.set(_origin, _dir)

        const colliders = colliderGetter()
        if (colliders.length > 0) {
          const boxes = colliders.map((c) => {
            const cx = (c.min[0] + c.max[0]) / 2
            const cy = (c.min[1] + c.max[1]) / 2
            const cz = (c.min[2] + c.max[2]) / 2
            const sx = c.max[0] - c.min[0]
            const sy = c.max[1] - c.min[1]
            const sz = c.max[2] - c.min[2]
            return { cx, cy, cz, sx, sy, sz }
          })

          let closestDist = Infinity
          let closestPoint: Vector3 | null = null

          for (const box of boxes) {
            const hx = box.sx / 2
            const hy = box.sy / 2
            const hz = box.sz / 2

            const local = new Vector3()
            local.copy(_origin)
            local.x -= box.cx
            local.y -= box.cy
            local.z -= box.cz

            let tmin = -Infinity
            let tmax = Infinity

            for (const [axis, half, localComponent] of [
              ['x', hx, local.x] as const,
              ['y', hy, local.y] as const,
              ['z', hz, local.z] as const,
            ]) {
              const invD = axis === 'x' ? 1 / _dir.x : axis === 'y' ? 1 / _dir.y : 1 / _dir.z
              const t0 = ((localComponent - half) * invD)
              const t1 = ((localComponent + half) * invD)
              const tNear = Math.min(t0, t1)
              const tFar = Math.max(t0, t1)
              tmin = Math.max(tmin, tNear)
              tmax = Math.min(tmax, tFar)
              if (tmin > tmax) break
            }

            if (tmin < tmax && tmin > 0 && tmin < closestDist) {
              closestDist = tmin
              closestPoint = new Vector3()
              closestPoint.copy(_origin)
              closestPoint.addScaledVector(_dir, tmin)
            }
          }

          if (closestPoint) {
            rt.player.aimPoint = { x: closestPoint.x, y: closestPoint.y, z: closestPoint.z }
          } else {
            const fallback = new Vector3().copy(_origin).addScaledVector(_dir, LASER_CONFIG.maxRange)
            rt.player.aimPoint = { x: fallback.x, y: fallback.y, z: fallback.z }
          }
        } else {
          const fallback = new Vector3().copy(_origin).addScaledVector(_dir, LASER_CONFIG.maxRange)
          rt.player.aimPoint = { x: fallback.x, y: fallback.y, z: fallback.z }
        }
      } else {
        rt.player.aimPoint = null
      }
    },
    [colliderGetter],
  )

  return { update, state }
}
