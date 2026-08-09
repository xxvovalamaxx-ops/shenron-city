/**
 * Free-look camera for contexts that refuse pointer lock.
 *
 * When pointer lock is unavailable (embedded preview, iframe, etc.) this
 * provides direct mouse-look while the player holds the primary button and
 * drags over the canvas. It never requests pointer lock and never hides the
 * system cursor, so an embedded preview cannot make the pointer feel trapped.
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
  const angles = useRef<LookAngles>({ yaw: 0, pitch: 0 })
  const scratch = useRef(new Vector3())
  const draggingPointer = useRef<number | null>(null)
  const sensitivityRef = useRef(sensitivity)
  sensitivityRef.current = sensitivity

  useEffect(() => {
    if (!enabled) return

    angles.current = lookAnglesFromDirection(camera.getWorldDirection(scratch.current))

    const apply = () => {
      camera.rotation.order = 'YXZ'
      camera.rotation.set(angles.current.pitch, angles.current.yaw, 0)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      draggingPointer.current = event.pointerId
      domElement.setPointerCapture(event.pointerId)
      event.preventDefault()
    }

    const onPointerMove = (event: PointerEvent) => {
      if (draggingPointer.current !== event.pointerId) return
      angles.current = applyLookDelta(
        angles.current,
        event.movementX,
        event.movementY,
        sensitivityRef.current,
      )
      apply()
    }

    const finishDrag = (event: PointerEvent) => {
      if (draggingPointer.current !== event.pointerId) return
      draggingPointer.current = null
      if (domElement.hasPointerCapture(event.pointerId)) {
        domElement.releasePointerCapture(event.pointerId)
      }
    }

    const loseCapture = () => {
      draggingPointer.current = null
    }

    domElement.addEventListener('pointerdown', onPointerDown)
    domElement.addEventListener('pointermove', onPointerMove)
    domElement.addEventListener('pointerup', finishDrag)
    domElement.addEventListener('pointercancel', finishDrag)
    domElement.addEventListener('lostpointercapture', loseCapture)

    return () => {
      const pointerId = draggingPointer.current
      draggingPointer.current = null
      if (pointerId !== null && domElement.hasPointerCapture(pointerId)) {
        domElement.releasePointerCapture(pointerId)
      }
      domElement.removeEventListener('pointerdown', onPointerDown)
      domElement.removeEventListener('pointermove', onPointerMove)
      domElement.removeEventListener('pointerup', finishDrag)
      domElement.removeEventListener('pointercancel', finishDrag)
      domElement.removeEventListener('lostpointercapture', loseCapture)
    }
  }, [enabled, camera, domElement])

  return null
}
