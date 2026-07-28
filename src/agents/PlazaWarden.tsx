/**
 * Kai — plaza security, outside the headquarters entrance.
 *
 * Faces the boulevard and scans the street with an articulated idle pose.
 */
import { PLAZA_WARDEN } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'
import { useHud } from '../ui/hud-store'
import { QuaterniusHero } from './QuaterniusHero'

export function PlazaWarden() {
  const talking = useHud((state) => state.screen === 'dialogue' && state.openCharacterId === 'kai')

  return (
    <group position={[PLAZA_WARDEN.x, 0, PLAZA_WARDEN.z]}>
      <group>
        <QuaterniusHero
          motion={talking ? 'Idle_Talking_Loop' : 'Idle_FoldArms_Loop'}
          animationSpeed={talking ? 0.92 : 0.82}
        />
        {/* Shoulder camera, radio, and chest shield make Kai read as security. */}
        <mesh position={[0.42, 1.48, 0.05]} castShadow>
          <boxGeometry args={[0.18, 0.24, 0.2]} />
          <meshStandardMaterial color="#111923" roughness={0.48} metalness={0.62} />
        </mesh>
        <mesh position={[0.42, 1.57, 0.18]}>
          <sphereGeometry args={[0.055, 12, 8]} />
          <meshStandardMaterial
            color="#49dbc7"
            emissive="#49dbc7"
            emissiveIntensity={0.75}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[-0.26, 1.08, 0.27]} castShadow>
          <boxGeometry args={[0.38, 0.48, 0.06]} />
          <meshStandardMaterial color="#1a2530" roughness={0.58} metalness={0.45} />
        </mesh>
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.32, 0.46, 24]} />
        <meshBasicMaterial color="#2dd4bf" transparent opacity={0.38} toneMapped={false} />
      </mesh>
      <Text position={[0, 2.08, 0.02]} fontSize={0.22} color="#7dd3c8">
        KAI
      </Text>
      <Text position={[0, 1.88, 0.02]} fontSize={0.1} color="#93b4bd">
        PLAZA SECURITY
      </Text>
    </group>
  )
}
