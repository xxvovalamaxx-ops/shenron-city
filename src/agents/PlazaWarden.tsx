/**
 * Kai — plaza security, outside the headquarters entrance.
 *
 * Faces the boulevard and scans the street with an articulated idle pose.
 */
import { PLAZA_WARDEN } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'
import { CitizenCharacter } from './CitizenCharacter'

export function PlazaWarden() {
  return (
    <group position={[PLAZA_WARDEN.x, 0, PLAZA_WARDEN.z]}>
      <CitizenCharacter
        role="security"
        phase={1.9}
        style={{
          skin: '#8c6448',
          hair: '#15181d',
          jacket: '#26303d',
          trousers: '#1b2430',
          shoes: '#10141a',
          accent: '#2dd4bf',
        }}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.32, 0.46, 24]} />
        <meshBasicMaterial color="#2dd4bf" transparent opacity={0.38} toneMapped={false} />
      </mesh>
      <Text position={[0, 2.38, 0.02]} fontSize={0.22} color="#7dd3c8">
        KAI
      </Text>
      <Text position={[0, 2.15, 0.02]} fontSize={0.1} color="#93b4bd">
        PLAZA SECURITY
      </Text>
    </group>
  )
}
