/**
 * Kai — plaza security, outside the headquarters entrance.
 *
 * Same construction as the market keeper so the two read as the same species
 * of character. Faces the boulevard rather than the door: a guard staring at
 * the wall they are guarding looks broken, and the player arrives from +z.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { PLAZA_WARDEN } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'

export function PlazaWarden() {
  const body = useRef<Group>(null)

  useFrame((state) => {
    if (!body.current) return
    const t = state.clock.elapsedTime
    // A slower, wider scan than Mira's — he is watching the street, not a stall.
    body.current.rotation.y = Math.sin(t * 0.32) * 0.26
    body.current.position.y = Math.sin(t * 0.95) * 0.012
  })

  return (
    <group position={[PLAZA_WARDEN.x, 0, PLAZA_WARDEN.z]}>
      <group ref={body}>
        <mesh position={[0, 0.94, 0]} castShadow>
          <capsuleGeometry args={[0.26, 0.82, 6, 14]} />
          <meshStandardMaterial color="#26303d" roughness={0.72} />
        </mesh>
        {/* High-visibility band, the one thing that should catch the eye. */}
        <mesh position={[0, 1.16, 0]}>
          <cylinderGeometry args={[0.272, 0.272, 0.1, 16]} />
          <meshBasicMaterial color="#2dd4bf" toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.66, 0]} castShadow>
          <sphereGeometry args={[0.19, 16, 12]} />
          <meshStandardMaterial color="#8c6448" roughness={0.78} />
        </mesh>
        <mesh position={[0, 1.83, 0]}>
          <cylinderGeometry args={[0.21, 0.21, 0.11, 16]} />
          <meshStandardMaterial color="#141b24" roughness={0.85} />
        </mesh>
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.32, 0.46, 24]} />
        <meshBasicMaterial color="#2dd4bf" transparent opacity={0.38} toneMapped={false} />
      </mesh>
      <Text position={[0, 2.28, 0.02]} fontSize={0.22} color="#7dd3c8">
        KAI
      </Text>
      <Text position={[0, 2.05, 0.02]} fontSize={0.1} color="#93b4bd">
        PLAZA SECURITY
      </Text>
    </group>
  )
}
