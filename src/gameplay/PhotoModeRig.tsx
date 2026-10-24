/**
 * Photo mode in the scene: P freezes the world and hands the camera to a free
 * flying lens (see photo-mode.ts); P or Escape hands it back. The HUD hides
 * itself while `photoMode` is set (App), and GameLoop treats it as a pause.
 *
 * Owns its own key, mouse and wheel listeners: the game's key state is
 * cleared every paused frame, so it cannot drive a camera while time stands
 * still.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, type PerspectiveCamera } from 'three'
import { inputLocked, useHud } from '../ui/hud-store'
import { manhattanCollision } from '../world/manhattan-collision'
import { NO_PHOTO_INPUT, startPhotoCamera, stepPhotoCamera, type PhotoCamera, type PhotoInput } from './photo-mode'

const KEY_MAP: Record<string, keyof PhotoInput> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'up', KeyR: 'up',
  ControlLeft: 'down', KeyC: 'down', KeyF: 'down',
  ShiftLeft: 'fast', ShiftRight: 'fast',
}

const _euler = new Euler(0, 0, 0, 'YXZ')

export function PhotoModeRig() {
  const { camera } = useThree()
  const cam = useRef<PhotoCamera | null>(null)
  const saved = useRef<{ fov: number } | null>(null)
  const held = useRef<Record<string, boolean>>({})
  const mouse = useRef({ dx: 0, dy: 0, zoom: 0 })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hud = useHud.getState()
      if (e.type === 'keydown' && e.code === 'KeyP' && !e.repeat) {
        if (hud.photoMode) hud.set('photoMode', false)
        else if (!inputLocked(hud.screen)) hud.set('photoMode', true)
        return
      }
      if (!hud.photoMode) return
      if (e.code === 'KeyH' && e.type === 'keydown') hud.set('photoHintHidden', !hud.photoHintHidden)
      held.current[e.code] = e.type === 'keydown'
      if (KEY_MAP[e.code] || e.code === 'KeyQ' || e.code === 'KeyE') e.preventDefault()
    }
    const onMove = (e: MouseEvent) => {
      if (!useHud.getState().photoMode) return
      if (document.pointerLockElement || (e.buttons & 1) !== 0) {
        mouse.current.dx += e.movementX
        mouse.current.dy += e.movementY
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (!useHud.getState().photoMode) return
      mouse.current.zoom += e.deltaY < 0 ? 1 : -1
    }
    const clear = () => {
      held.current = {}
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('blur', clear)
    }
  }, [])

  useFrame((_, rawDt) => {
    const persp = camera as PerspectiveCamera
    const on = useHud.getState().photoMode
    if (!on) {
      if (cam.current) {
        // Hand the lens back as it was; the game camera re-takes the pose.
        if (saved.current) {
          persp.fov = saved.current.fov
          persp.updateProjectionMatrix()
        }
        cam.current = null
        saved.current = null
        held.current = {}
      }
      return
    }
    if (!cam.current) {
      _euler.setFromQuaternion(camera.quaternion, 'YXZ')
      saved.current = { fov: persp.fov }
      cam.current = startPhotoCamera({ x: camera.position.x, y: camera.position.y, z: camera.position.z }, _euler.y, _euler.x, persp.fov)
      mouse.current = { dx: 0, dy: 0, zoom: 0 }
    }
    const k = held.current
    const input: PhotoInput = { ...NO_PHOTO_INPUT }
    for (const [code, field] of Object.entries(KEY_MAP)) if (k[code]) (input as unknown as Record<string, boolean>)[field] = true
    input.rollDir = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0)
    input.lookDx = mouse.current.dx
    input.lookDy = mouse.current.dy
    input.zoom = mouse.current.zoom
    mouse.current = { dx: 0, dy: 0, zoom: 0 }

    const s = cam.current
    const ground = manhattanCollision.groundHeightAt(s.pos.x, s.pos.z)
    const next = stepPhotoCamera(s, input, Math.min(rawDt, 0.1), ground)
    cam.current = next
    camera.position.set(next.pos.x, next.pos.y, next.pos.z)
    _euler.set(next.pitch, next.yaw, (-next.roll * Math.PI) / 180, 'YXZ')
    camera.quaternion.setFromEuler(_euler)
    if (Math.abs(persp.fov - next.fov) > 0.01) {
      persp.fov = next.fov
      persp.updateProjectionMatrix()
    }
  }, -50)

  return null
}

/** The on-screen key guide; H hides it for a clean shot. */
export function PhotoModeHint() {
  const hidden = useHud((s) => s.photoHintHidden)
  if (hidden) return null
  return (
    <div className="photo-hint" role="status">
      <b>PHOTO MODE</b>
      <span><kbd className="gta-key">WASD</kbd> move</span>
      <span><kbd className="gta-key">Mouse</kbd> look</span>
      <span><kbd className="gta-key">Space</kbd>/<kbd className="gta-key">C</kbd> up/down</span>
      <span><kbd className="gta-key">Shift</kbd> fast</span>
      <span><kbd className="gta-key">Wheel</kbd> zoom</span>
      <span><kbd className="gta-key">Q</kbd>/<kbd className="gta-key">E</kbd> tilt</span>
      <span><kbd className="gta-key">H</kbd> hide</span>
      <span><kbd className="gta-key">P</kbd> exit</span>
    </div>
  )
}
