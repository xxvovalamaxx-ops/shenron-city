/**
 * Mouselook for contexts that refuse pointer lock.
 *
 * `requestPointerLock` rejects outright in any document that is not a valid
 * top-level browsing context — an embedded preview pane is the one that turns
 * up in practice — and until this existed the only fallback was no mouselook at
 * all: `?no-pointer-lock=1` simply omits the pointer-lock component, because it
 * was written as an automation switch for the capture harness rather than as a
 * way to play.
 *
 * Hold the left button and drag. Deliberately drag rather than free-look: with
 * no pointer capture the cursor is still a real cursor, and a camera that spun
 * whenever the mouse crossed the canvas would be unusable. Hold the right
 * button to aim.
 *
 * Feeds the same yaw/pitch (`look`) that pointer lock does, so the orbit
 * camera, first person and movement all read one set of angles whichever
 * input path is live.
 *
 * Also the one always-mounted input component, so it carries the look
 * preferences (base FOV) from the settings menu to the walk camera.
 */
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'

import { feedLook, look } from './player/look-state'
import { cameraPrefs } from './player/walk-camera'

interface Props {
  /** False while paused, or whenever pointer lock is doing the job instead. */
  enabled: boolean
  sensitivity?: number
  /** Base field of view from the settings, degrees. */
  fov?: number
}

export function DragLook({ enabled, sensitivity = 1, fov }: Props) {
  const domElement = useThree((s) => s.gl.domElement)
  const dragging = useRef(false)
  const sensitivityRef = useRef(sensitivity)
  sensitivityRef.current = sensitivity

  useEffect(() => {
    if (typeof fov === 'number' && Number.isFinite(fov)) cameraPrefs.fov = fov
  }, [fov])

  useEffect(() => {
    if (!enabled) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.button === 2) {
        look.aiming = true
        return
      }
      if (event.button !== 0) return
      dragging.current = true
      // setPointerCapture keeps the drag alive if the cursor leaves the canvas
      // mid-swing, which is most swings.
      try {
        domElement.setPointerCapture(event.pointerId)
      } catch {
        // capture is a convenience; the window-level pointerup still ends it
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging.current) return
      feedLook(event.movementX, event.movementY, sensitivityRef.current)
    }

    const endDrag = (event: PointerEvent) => {
      if (event.button === 2) look.aiming = false
      if (!dragging.current) return
      dragging.current = false
      try {
        domElement.releasePointerCapture(event.pointerId)
      } catch {
        // already released, or never captured
      }
    }

    const onContextMenu = (event: Event) => event.preventDefault()

    domElement.addEventListener('pointerdown', onPointerDown)
    domElement.addEventListener('pointermove', onPointerMove)
    domElement.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    // A drag interrupted by tab-away must not leave the camera stuck to a
    // pointer that is no longer down.
    const onBlur = () => {
      dragging.current = false
      look.aiming = false
    }
    window.addEventListener('blur', onBlur)

    return () => {
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('pointermove', onPointerMove)
      domElement.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('blur', onBlur)
      dragging.current = false
      look.aiming = false
    }
  }, [enabled, domElement])

  return null
}
