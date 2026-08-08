/**
 * Mouselook for contexts that refuse pointer lock.
 *
 * `requestPointerLock` rejects outright in any document that is not a valid
 * top-level browsing context — an embedded preview pane is the one that turns
 * up in practice — and until this existed the only fallback was no mouselook at
 * all: `?no-pointer-lock=1` simply omits PointerLockControls, because it was
 * written as an automation switch for the capture harness rather than as a way
 * to play.
 *
 * Hold the left button and drag. Deliberately drag rather than free-look: with
 * no pointer capture the cursor is still a real cursor, and a camera that spun
 * whenever the mouse crossed the canvas would be unusable.
 *
 * Writes the same `camera.rotation` Euler that PointerLockControls does, in the
 * same YXZ order, so everything downstream — movement direction, the
 * third-person boom — reads it back identically through `getWorldDirection()`.
 */
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'

import { applyLookDelta, lookAnglesFromDirection, type LookAngles } from './look'

interface Props {
  /** False while paused, or whenever pointer lock is doing the job instead. */
  enabled: boolean
  sensitivity?: number
}

export function DragLook({ enabled, sensitivity = 1 }: Props) {
  const camera = useThree((s) => s.camera)
  const domElement = useThree((s) => s.gl.domElement)
  // Kept in a ref, not state: a re-render per mouse move would be absurd, and
  // the camera is mutated directly anyway.
  const angles = useRef<LookAngles>({ yaw: 0, pitch: 0 })
  const dragging = useRef(false)
  const scratch = useRef(new Vector3())
  const sensitivityRef = useRef(sensitivity)
  sensitivityRef.current = sensitivity

  useEffect(() => {
    if (!enabled) return

    // Pick up wherever the view already is, so enabling this never snaps the
    // camera — the intro camera and PointerLockControls both leave a heading.
    //
    // From the forward vector, not from camera.rotation. The intro hands over
    // a camera last oriented by lookAt, whose Euler is decomposed in XYZ order
    // with the steep downward look expressed partly in `z`. Reading x and y
    // and dropping z put the view 12.9 degrees out with its up vector rolled
    // to y = 0.53, which is what "the character is upside down" looked like.
    angles.current = lookAnglesFromDirection(camera.getWorldDirection(scratch.current))

    const apply = () => {
      camera.rotation.order = 'YXZ'
      camera.rotation.set(angles.current.pitch, angles.current.yaw, 0)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      dragging.current = true
      // Also from the direction. `apply()` is what sets the YXZ order, and it
      // only runs on pointer *move* — so on the very first drag the camera can
      // still be carrying the intro's XYZ Euler, and reading x/y off it
      // reintroduces the same roll this component was fixed for.
      angles.current = lookAnglesFromDirection(camera.getWorldDirection(scratch.current))
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
      angles.current = applyLookDelta(
        angles.current,
        event.movementX,
        event.movementY,
        sensitivityRef.current,
      )
      apply()
    }

    const endDrag = (event: PointerEvent) => {
      if (!dragging.current) return
      dragging.current = false
      try {
        domElement.releasePointerCapture(event.pointerId)
      } catch {
        // already released, or never captured
      }
    }

    domElement.addEventListener('pointerdown', onPointerDown)
    domElement.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    // A drag interrupted by tab-away must not leave the camera stuck to a
    // pointer that is no longer down.
    const onBlur = () => {
      dragging.current = false
    }
    window.addEventListener('blur', onBlur)

    return () => {
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('blur', onBlur)
      dragging.current = false
    }
  }, [enabled, camera, domElement])

  return null
}
