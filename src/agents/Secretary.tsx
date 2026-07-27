/**
 * The lobby secretary.
 *
 * An abstract presence rather than a human figure, for the same reason as the
 * agent cores: an unrigged humanoid built from primitives lands in the uncanny
 * valley and drags the whole lobby down with it. She reads as *someone* through
 * placement, light, motion and a name plate.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type { Group } from 'three'
import { SECRETARY } from '../world/layout'
import { PALETTE } from '../world/palette'
import type { LinkState } from '../adapter/store'

export const SECRETARY_NAME = 'Iris'

export function Secretary({ link }: { link: LinkState }) {
  const body = useRef<Group>(null)
  const halo = useRef<Group>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (body.current) {
      // A slow idle sway. Perfectly still reads as "broken", not "calm".
      body.current.position.y = 0.02 * Math.sin(t * 0.9)
      body.current.rotation.y = 0.06 * Math.sin(t * 0.35)
    }
    if (halo.current) halo.current.rotation.y = t * 0.35
  })

  // The halo colour is the honest link indicator: teal when she is speaking
  // from live data, amber when she is not.
  const linkColor =
    link === 'live' ? PALETTE.accent : link === 'demo' ? '#f59e0b' : '#f59e0b'

  return (
    <group position={[SECRETARY.x, 0, SECRETARY.z]}>
      <group ref={body}>
        {/* Torso */}
        <mesh position={[0, 0.95, 0]} castShadow>
          <capsuleGeometry args={[0.26, 0.72, 6, 16]} />
          <meshStandardMaterial color="#2b3442" roughness={0.55} metalness={0.25} />
        </mesh>
        {/* Head */}
        <mesh position={[0, 1.62, 0]} castShadow>
          <sphereGeometry args={[0.185, 20, 16]} />
          <meshStandardMaterial color="#39445466" roughness={0.4} metalness={0.4} />
        </mesh>
        {/* Visor band — where a face would be, doing the work a face would do */}
        <mesh position={[0, 1.64, 0.15]}>
          <boxGeometry args={[0.2, 0.045, 0.06]} />
          <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
        </mesh>

        {/* Rotating halo: status ring above her */}
        <group ref={halo} position={[0, 2.02, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.22, 0.014, 8, 32]} />
            <meshBasicMaterial color={linkColor} toneMapped={false} />
          </mesh>
        </group>
      </group>

      {/* Key light so she is the brightest thing in the lobby */}
      <pointLight
        position={[0.6, 2.3, 1.4]}
        color={PALETTE.warmLight}
        intensity={95}
        distance={12}
        decay={2}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.32, 0.5, 28]} />
        <meshBasicMaterial color={PALETTE.accent} transparent opacity={0.2} toneMapped={false} />
      </mesh>

      {/* Desk name plate, facing the approach */}
      <group position={[0, 1.2, 1.55]}>
        <Text fontSize={0.14} color="#c8d4e4" anchorX="center" anchorY="middle">
          {SECRETARY_NAME}
        </Text>
        <Text position={[0, -0.17, 0]} fontSize={0.075} color="#5f6f85" anchorX="center">
          RECEPTION
        </Text>
      </group>
    </group>
  )
}
