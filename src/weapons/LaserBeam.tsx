/**
 * Laser beam visual — thin bright cylinder from camera to aim point.
 *
 * Uses MeshBasicMaterial with toneMapped=false so the bloom pass picks
 * it up and produces a glow halo. Three layers: a thin bright core,
 * a wider translucent glow, and a point light at the impact.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, PointLight, Vector3 } from 'three'
import { rt } from '../gameplay/runtime'
import { beamColor } from './laser'

const _mid = new Vector3()

export function LaserBeam() {
  const coreRef = useRef<Mesh>(null)
  const glowRef = useRef<Mesh>(null)
  const impactRef = useRef<PointLight>(null)

  useFrame(({ camera }) => {
    const core = coreRef.current
    const glow = glowRef.current
    const impact = impactRef.current
    if (!core || !glow) return

    if (!rt.player.firing || rt.player.overheated || !rt.player.aimPoint) {
      core.visible = false
      glow.visible = false
      if (impact) impact.intensity = 0
      return
    }

    const aim = rt.player.aimPoint
    const ox = camera.position.x
    const oy = camera.position.y
    const oz = camera.position.z
    const dx = aim.x - ox
    const dy = aim.y - oy
    const dz = aim.z - oz
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)

    if (dist < 0.1) {
      core.visible = false
      glow.visible = false
      if (impact) impact.intensity = 0
      return
    }

    core.visible = true
    glow.visible = true

    _mid.set(ox + dx / 2, oy + dy / 2, oz + dz / 2)

    const color = beamColor(rt.player.heat)

    // Core: thin bright line
    core.position.copy(_mid)
    core.scale.set(0.015, dist, 0.015)
    core.lookAt(aim.x, aim.y, aim.z)
    core.rotateX(Math.PI / 2)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(core.material as any).color.set(color)

    // Glow: wider translucent halo
    glow.position.copy(_mid)
    glow.scale.set(0.05, dist, 0.05)
    glow.rotation.copy(core.rotation)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(glow.material as any).color.set(color)

    // Impact point glow
    if (impact) {
      impact.position.set(aim.x, aim.y, aim.z)
      impact.color.set(color)
      impact.intensity = 8
    }
  })

  return (
    <>
      <mesh ref={coreRef}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshBasicMaterial color="#2dd4bf" toneMapped={false} />
      </mesh>
      <mesh ref={glowRef}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshBasicMaterial
          color="#2dd4bf"
          transparent
          opacity={0.12}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <pointLight ref={impactRef} distance={8} decay={2} intensity={0} />
    </>
  )
}
