/**
 * Laser beam visual — a cylinder from camera origin to aim point.
 *
 * Uses MeshBasicMaterial with toneMapped=false so the bloom pass picks
 * it up and produces a glow halo. Two layers: a thin bright core and
 * a wider translucent glow.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, Vector3 } from 'three'
import { rt } from '../gameplay/runtime'
import { LASER_CONFIG, beamColor } from './laser'

const ORIGIN = new Vector3()

export function LaserBeam() {
  const coreRef = useRef<Mesh>(null)
  const glowRef = useRef<Mesh>(null)

  useFrame(({ camera }) => {
    const core = coreRef.current
    const glow = glowRef.current
    if (!core || !glow) return

    if (!rt.player.firing || rt.player.overheated || !rt.player.aimPoint) {
      core.visible = false
      glow.visible = false
      return
    }

    core.visible = true
    glow.visible = true

    ORIGIN.copy(camera.position)
    const aim = rt.player.aimPoint
    const dx = aim.x - ORIGIN.x
    const dy = aim.y - ORIGIN.y
    const dz = aim.z - ORIGIN.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    const midX = ORIGIN.x + dx / 2
    const midY = ORIGIN.y + dy / 2
    const midZ = ORIGIN.z + dz / 2

    const color = beamColor(rt.player.heat)

    core.position.set(midX, midY, midZ)
    core.scale.set(LASER_CONFIG.beamRadius, dist, LASER_CONFIG.beamRadius)
    core.rotation.set(0, 0, 0)
    core.lookAt(aim.x, aim.y, aim.z)
    core.rotateX(Math.PI / 2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(core.material as any).color.set(color)

    glow.position.set(midX, midY, midZ)
    glow.scale.set(LASER_CONFIG.glowRadius, dist, LASER_CONFIG.glowRadius)
    glow.rotation.copy(core.rotation)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(glow.material as any).color.set(color)
  })

  return (
    <>
      <mesh ref={coreRef}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshBasicMaterial color="#2dd4bf" toneMapped={false} />
      </mesh>
      <mesh ref={glowRef}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshBasicMaterial color="#2dd4bf" transparent opacity={0.15} toneMapped={false} depthWrite={false} />
      </mesh>
    </>
  )
}
