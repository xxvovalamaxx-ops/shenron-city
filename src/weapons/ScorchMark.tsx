/**
 * Scorch mark decal — a dark quad placed at the laser impact point.
 * Fades out over a few seconds.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, Object3D } from 'three'
import { rt } from '../gameplay/runtime'

interface ScorchMarkProps {
  position: [number, number, number]
  normal: [number, number, number]
  onExpire: () => void
  lifetime?: number
}

const _target = new Object3D()

export function ScorchMark({ position, normal, onExpire, lifetime = 6 }: ScorchMarkProps) {
  const meshRef = useRef<Mesh>(null)
  const age = useRef(0)

  useFrame((_, rawDt) => {
    if (rt.paused) return
    const dt = Math.min(rawDt, 1 / 20)
    age.current += dt

    const mesh = meshRef.current
    if (!mesh) return

    const t = age.current / lifetime
    if (t >= 1) {
      onExpire()
      return
    }

    const opacity = t < 0.1 ? t / 0.1 : Math.max(0, 1 - (t - 0.3) / 0.7)
    ;(mesh.material as { opacity: number }).opacity = opacity * 0.6

    _target.position.set(position[0], position[1], position[2])
    _target.lookAt(
      position[0] + normal[0],
      position[1] + normal[1],
      position[2] + normal[2],
    )
    mesh.quaternion.copy(_target.quaternion)
  })

  return (
    <mesh ref={meshRef} position={position}>
      <planeGeometry args={[0.18, 0.18]} />
      <meshBasicMaterial
        color="#111111"
        transparent
        opacity={0}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  )
}
