/**
 * React hook that manages laser firing state, raycasting, and heat.
 *
 * Uses Three.js's built-in Raycaster.intersectObjects() for hit detection
 * — no manual AABB math. Zero per-frame allocation: all vectors and the
 * raycaster are module-level and reused.
 *
 * Runs in the GameLoop's useFrame via direct rt mutation.
 */
import { useEffect, useRef, useCallback } from 'react'
import { Mesh, Raycaster, Vector3 } from 'three'
import { rt } from '../gameplay/runtime'
import { stepLaser, LASER_CONFIG, type LaserState } from './laser'

const _raycaster = new Raycaster()
_raycaster.far = LASER_CONFIG.maxRange
const _origin = new Vector3()
const _dir = new Vector3()

export function useLaser() {
  const state = useRef<LaserState>({ heat: 0, overheated: false, cooldownTimer: 0 })
  const mouseDown = useRef(false)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button === 0 && !rt.paused) {
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

        // Get breakable meshes exposed by DestructionSystem.
        const breakableMeshes: Mesh[] =
          (globalThis as unknown as { __breakableMeshes?: Mesh[] }).__breakableMeshes ?? []

        // Raycast against breakable meshes.
        const hits = breakableMeshes.length > 0
          ? _raycaster.intersectObjects(breakableMeshes, false)
          : []

        if (hits.length > 0) {
          const hit = hits[0]
          rt.player.aimPoint = { x: hit.point.x, y: hit.point.y, z: hit.point.z }
        } else {
          // No breakable hit — extend beam to max range.
          _origin.addScaledVector(_dir, LASER_CONFIG.maxRange)
          rt.player.aimPoint = { x: _origin.x, y: _origin.y, z: _origin.z }
        }
      } else {
        rt.player.aimPoint = null
      }
    },
    [],
  )

  return { update, state }
}
