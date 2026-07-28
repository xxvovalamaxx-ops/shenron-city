/**
 * Laser firing hook — raycasts using Three.js Raycaster.intersectObjects()
 * against breakable meshes from the module-level registry.
 *
 * Zero timing dependencies: the registry is written synchronously in React
 * ref callbacks, not in useFrame. matrixWorld is forced before raycasting.
 * No per-frame vector allocation.
 */
import { useEffect, useRef, useCallback } from 'react'
import { Raycaster, Vector3 } from 'three'
import { rt } from '../gameplay/runtime'
import { stepLaser, LASER_CONFIG, type LaserState } from './laser'
import { getBreakableMeshes } from '../destruction/breakableMeshRegistry'

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

        const meshes = getBreakableMeshes()

        // Force matrixWorld on all breakable meshes so the raycaster
        // works correctly even on the first frame after mount.
        for (let i = 0; i < meshes.length; i++) {
          meshes[i].updateMatrixWorld(false)
        }

        const hits = meshes.length > 0
          ? _raycaster.intersectObjects(meshes, false)
          : []

        if (hits.length > 0) {
          const hit = hits[0]
          rt.player.aimPoint = { x: hit.point.x, y: hit.point.y, z: hit.point.z }
        } else {
          // No breakable in sight — beam extends to a short distance ahead
          // so the visual doesn't stretch 120m across the scene.
          const fallbackDist = 40
          _origin.addScaledVector(_dir, fallbackDist)
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
