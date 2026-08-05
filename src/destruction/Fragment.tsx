/**
 * A single debris fragment — a box that flies from the impact point,
 * tumbles, falls under gravity, and fades out.
 *
 * No physics engine needed: simple Euler integration + AABB floor bounce.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Mesh, Vector3 } from 'three'
import type { BreakableDef } from './BreakableRegistry'
import type { Vec3 } from '../gameplay/collision'
import { rt } from '../gameplay/runtime'

interface FragmentProps {
  def: BreakableDef
  origin: Vec3
  direction: Vec3
  onExpired: () => void
}

const GRAVITY = -18

export function Fragment({ def, origin, direction, onExpired }: FragmentProps) {
  const meshRef = useRef<Mesh>(null)
  const vel = useRef(new Vector3())
  const rotVel = useRef(new Vector3())
  const pos = useRef(new Vector3())
  const age = useRef(0)
  const initialized = useRef(false)

  useFrame((_, rawDt) => {
    if (rt.paused) return
    const dt = Math.min(rawDt, 1 / 20)
    const mesh = meshRef.current
    if (!mesh) return

    if (!initialized.current) {
      initialized.current = true
      const spread = 0.4
      vel.current.set(
        direction.x * (3 + Math.random() * 4) + (Math.random() - 0.5) * spread,
        4 + Math.random() * 5,
        direction.z * (3 + Math.random() * 4) + (Math.random() - 0.5) * spread,
      )
      rotVel.current.set(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
      )
      pos.current.set(origin.x, origin.y, origin.z)
    }

    age.current += dt
    if (age.current > 3) {
      onExpired()
      return
    }

    vel.current.y += GRAVITY * dt
    pos.current.addScaledVector(vel.current, dt)

    if (pos.current.y < 0.05) {
      pos.current.y = 0.05
      vel.current.y = Math.abs(vel.current.y) * 0.3
      vel.current.x *= 0.7
      vel.current.z *= 0.7
      rotVel.current.multiplyScalar(0.5)
    }

    mesh.position.copy(pos.current)
    mesh.rotation.x += rotVel.current.x * dt
    mesh.rotation.y += rotVel.current.y * dt
    mesh.rotation.z += rotVel.current.z * dt

    const t = age.current / 3
    const opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1
    ;(mesh.material as { opacity: number }).opacity = opacity
  })

  const baseSize = Math.min(...def.size) * 0.4
  const fragSize = baseSize * (0.5 + Math.random() * 0.5)

  return (
    <mesh ref={meshRef} castShadow>
      <boxGeometry args={[fragSize, fragSize * (0.6 + Math.random() * 0.8), fragSize]} />
      <meshStandardMaterial
        color={def.innerColor ?? def.color}
        roughness={0.8}
        transparent
        opacity={1}
      />
    </mesh>
  )
}
