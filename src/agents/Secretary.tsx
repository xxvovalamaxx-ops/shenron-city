/**
 * Iris — the headquarters' animated service-android receptionist.
 *
 * This replaces the capsule-and-sphere placeholder with an audited skinned
 * character. The authored Idle and Yes clips provide breathing/posture and a
 * listening acknowledgement when her dialogue is open.
 */
import { useHud } from '../ui/hud-store'
import { WorldText as Text } from '../ui/WorldText'
import { SECRETARY } from '../world/layout'
import { PALETTE } from '../world/palette'
import { ServiceAndroid } from './ServiceAndroid'

export const SECRETARY_NAME = 'Iris'

export function Secretary() {
  const talking = useHud((state) => state.screen === 'dialogue' && state.openCharacterId === 'iris')

  return (
    <group position={[SECRETARY.x, 0, SECRETARY.z]}>
      <group scale={0.62}>
        <ServiceAndroid
          motion={talking ? 'Yes' : 'Idle'}
          style="iris"
          animationSpeed={talking ? 0.88 : 0.76}
        />

        {/* Tailored reception sash, identity badge, and headset. */}
        <mesh position={[0, 1.55, 0.31]} rotation={[0, 0, -0.12]} castShadow>
          <boxGeometry args={[0.16, 1.02, 0.055]} />
          <meshStandardMaterial color="#2dd4bf" roughness={0.48} metalness={0.32} />
        </mesh>
        <mesh position={[0.34, 1.5, 0.34]}>
          <boxGeometry args={[0.34, 0.22, 0.045]} />
          <meshStandardMaterial color="#e7f5f3" roughness={0.42} metalness={0.2} />
        </mesh>
        <mesh position={[-0.45, 2.34, 0.03]} rotation={[0, 0, -0.24]}>
          <torusGeometry args={[0.18, 0.028, 8, 22, Math.PI * 1.45]} />
          <meshStandardMaterial color="#17242b" roughness={0.42} metalness={0.66} />
        </mesh>
        <mesh position={[-0.57, 2.22, 0.17]}>
          <sphereGeometry args={[0.045, 10, 8]} />
          <meshStandardMaterial
            color="#2dd4bf"
            emissive="#2dd4bf"
            emissiveIntensity={0.9}
            roughness={0.22}
          />
        </mesh>
      </group>

      {/* A grounded light pool replaces the old floating halo. */}
      <spotLight
        position={[0.8, 3.3, 1.5]}
        target-position={[0, 1.1, 0]}
        color={PALETTE.warmLight}
        intensity={70}
        distance={11}
        angle={0.46}
        penumbra={0.72}
        decay={2}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.34, 0.5, 32]} />
        <meshBasicMaterial color={PALETTE.accent} transparent opacity={0.16} toneMapped={false} />
      </mesh>

      <group position={[0, 1.2, 1.55]}>
        <Text fontSize={0.14} color="#dbe9ef" anchorX="center" anchorY="middle">
          {SECRETARY_NAME}
        </Text>
        <Text position={[0, -0.17, 0]} fontSize={0.075} color="#6f8794" anchorX="center">
          RECEPTION · LOCAL SCENARIO
        </Text>
      </group>
    </group>
  )
}
