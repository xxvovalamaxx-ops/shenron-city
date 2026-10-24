/**
 * Pointer-locked mouselook that feeds the orbit rig instead of the camera.
 *
 * A drop-in for drei's PointerLockControls — same `lock()` / `unlock()`
 * handle, same `onUnlock` — with two differences that matter here:
 *
 *   - mouse movement goes into `look` (yaw/pitch), not into
 *     `camera.rotation`. The walk camera positions the boom from those angles
 *     every frame; a second writer rotating the camera under it is what made
 *     the old third-person camera fight itself;
 *   - only a click on the game canvas while playing takes the lock. drei's
 *     version locked on any click on the document, so clicking a slider in the
 *     pause menu — or, now, the pause map — swallowed the cursor.
 *
 * Right mouse is aim (camera pulls in over the shoulder).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { useHud } from '../../ui/hud-store'
import { feedLook, look } from './look-state'

export interface PointerLookHandle {
  lock(): Promise<void> | void
  unlock(): void
}

interface Props {
  sensitivity?: number
  onLock?(): void
  onUnlock?(): void
}

/** A single event bigger than this is a browser glitch (Chrome on lock), not a flick. */
const MAX_EVENT_DELTA = 300

export const PointerLook = forwardRef<PointerLookHandle, Props>(function PointerLook(
  { sensitivity = 1, onLock, onUnlock },
  ref,
) {
  const domElement = useThree((s) => s.gl.domElement)
  const sensitivityRef = useRef(sensitivity)
  sensitivityRef.current = sensitivity
  const callbacks = useRef({ onLock, onUnlock })
  callbacks.current = { onLock, onUnlock }

  useImperativeHandle(
    ref,
    () => ({
      lock() {
        const request = domElement.requestPointerLock?.() as unknown
        if (!(request instanceof Promise)) return
        // A refused *context* (sandboxed frame, embedded preview) is permanent
        // and the caller falls back to drag-to-look. A lock that merely failed
        // this time — resumed with Esc, which is not a user activation, or too
        // soon after the last unlock — is not: the next canvas click retries.
        return request.catch((error: unknown) => {
          const name = (error as { name?: string } | null)?.name
          if (name === 'NotSupportedError' || name === 'WrongDocumentError') throw error
        })
      },
      unlock() {
        if (document.pointerLockElement === domElement) document.exitPointerLock()
      },
    }),
    [domElement],
  )

  useEffect(() => {
    const doc = domElement.ownerDocument
    const locked = () => doc.pointerLockElement === domElement

    const onMouseMove = (event: MouseEvent) => {
      if (!locked()) return
      const dx = Math.max(-MAX_EVENT_DELTA, Math.min(MAX_EVENT_DELTA, event.movementX || 0))
      const dy = Math.max(-MAX_EVENT_DELTA, Math.min(MAX_EVENT_DELTA, event.movementY || 0))
      feedLook(dx, dy, sensitivityRef.current)
    }
    const onChange = () => {
      if (locked()) callbacks.current.onLock?.()
      else {
        look.aiming = false
        callbacks.current.onUnlock?.()
      }
    }
    const onError = () => {
      console.warn('[input] pointer lock request failed')
    }
    const onClick = () => {
      if (locked() || useHud.getState().screen !== 'playing') return
      try {
        const request = domElement.requestPointerLock?.() as unknown
        if (request instanceof Promise) request.catch(() => undefined)
      } catch {
        // retried on the next click
      }
    }
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 2 && locked()) look.aiming = true
    }
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 2) look.aiming = false
    }
    const onContextMenu = (event: Event) => {
      if (locked() || useHud.getState().screen === 'playing') event.preventDefault()
    }

    doc.addEventListener('mousemove', onMouseMove)
    doc.addEventListener('pointerlockchange', onChange)
    doc.addEventListener('pointerlockerror', onError)
    doc.addEventListener('mousedown', onMouseDown)
    doc.addEventListener('mouseup', onMouseUp)
    domElement.addEventListener('click', onClick)
    domElement.addEventListener('contextmenu', onContextMenu)
    return () => {
      doc.removeEventListener('mousemove', onMouseMove)
      doc.removeEventListener('pointerlockchange', onChange)
      doc.removeEventListener('pointerlockerror', onError)
      doc.removeEventListener('mousedown', onMouseDown)
      doc.removeEventListener('mouseup', onMouseUp)
      domElement.removeEventListener('click', onClick)
      domElement.removeEventListener('contextmenu', onContextMenu)
    }
  }, [domElement])

  return null
})
