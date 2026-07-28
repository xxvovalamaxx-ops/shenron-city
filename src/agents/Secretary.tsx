/**
 * Iris — the headquarters' animated cyborg receptionist.
 *
 * This replaces the capsule-and-sphere placeholder with an audited CC0
 * skinned character. The authored Idle clip provides breathing and posture;
 * dialogue state slightly raises its playback rate as a listening cue.
 */
import { useHud } from '../ui/hud-store'
import { WorldText as Text } from '../ui/WorldText'
import { SECRETARY } from '../world/layout'
import { PALETTE } from '../world/palette'
import { InteractionFocusMarker } from './InteractionFocusMarker'
import { KenneyCitizen } from './KenneyCitizen'

export const SECRETARY_NAME = 'Iris'

export function Secretary() {
  const talking = useHud((state) => state.screen === 'dialogue' && state.openCharacterId === 'iris')

  return (
    <group position={[SECRETARY.x, 0, SECRETARY.z]}>
      <group>
        <KenneyCitizen
          motion="Idle"
          skin="cyborgFemale"
          animationSpeed={talking ? 1.04 : 0.82}
        />

        {/* Tailored reception sash, identity badge, and headset. */}
        <mesh position={[0, 1.05, 0.23]} rotation={[0, 0, -0.12]} castShadow>
          <boxGeometry args={[0.12, 0.7, 0.04]} />
          <meshStandardMaterial color="#2dd4bf" roughness={0.48} metalness={0.32} />
        </mesh>
        <mesh position={[0.26, 1.02, 0.25]}>
          <boxGeometry args={[0.28, 0.18, 0.04]} />
          <meshStandardMaterial color="#e7f5f3" roughness={0.42} metalness={0.2} />
        </mesh>
        <mesh position={[-0.28, 1.67, 0.03]} rotation={[0, 0, -0.24]}>
          <torusGeometry args={[0.12, 0.02, 8, 22, Math.PI * 1.45]} />
          <meshStandardMaterial color="#17242b" roughness={0.42} metalness={0.66} />
        </mesh>
        <mesh position={[-0.38, 1.59, 0.13]}>
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
      <InteractionFocusMarker kind="secretary" color={PALETTE.accent} />

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
