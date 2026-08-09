/**
 * Free-look camera for contexts that refuse pointer lock.
 *
 * When pointer lock is unavailable (embedded preview, iframe, etc.) this
 * provides direct mouse-look: any mouse movement over the canvas rotates the
 * camera without requiring a button hold. On first click it attempts pointer
 * lock; if that fails, it stays in free-look mode.
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
  const sensitivityRef = useRef(sensitivity)
  sensitivityRef.current = sensitivity

  useEffect(() => {
    if (!enabled) return

    angles.current = lookAnglesFromDirection(camera.getWorldDirection(scratch.current))
    document.body.style.cursor = 'none'

    const apply = () => {
      camera.rotation.order = 'YXZ'
      camera.rotation.set(angles.current.pitch, angles.current.yaw, 0)
    }

    const onPointerMove = (event: PointerEvent) => {
      angles.current = applyLookDelta(
        angles.current,
        event.movementX,
        event.movementY,
        sensitivityRef.current,
      )
      apply()
    }

    domElement.addEventListener('pointermove', onPointerMove)

    return () => {
      domElement.removeEventListener('pointermove', onPointerMove)
      document.body.style.cursor = ''
    }
  }, [enabled, camera, domElement])

  return null
}
