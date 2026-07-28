/**
 * Kai — plaza security, outside the headquarters entrance.
 *
 * Faces the boulevard and scans the street with an articulated idle pose.
 */
import { PLAZA_WARDEN } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'
import { ServiceAndroid } from './ServiceAndroid'

export function PlazaWarden() {
  return (
    <group position={[PLAZA_WARDEN.x, 0, PLAZA_WARDEN.z]}>
      <group scale={0.6}>
        <ServiceAndroid motion="Idle" style="kai" animationSpeed={0.82} expression="alert" />
        {/* Shoulder camera, radio, and chest shield make Kai read as security. */}
        <mesh position={[0.52, 2.05, 0.06]} castShadow>
          <boxGeometry args={[0.22, 0.3, 0.28]} />
          <meshStandardMaterial color="#111923" roughness={0.48} metalness={0.62} />
        </mesh>
        <mesh position={[0.52, 2.16, 0.22]}>
          <sphereGeometry args={[0.055, 12, 8]} />
          <meshStandardMaterial
            color="#49dbc7"
            emissive="#49dbc7"
            emissiveIntensity={0.75}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[-0.33, 1.55, 0.31]} castShadow>
          <boxGeometry args={[0.46, 0.58, 0.07]} />
          <meshStandardMaterial color="#1a2530" roughness={0.58} metalness={0.45} />
        </mesh>
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.32, 0.46, 24]} />
        <meshBasicMaterial color="#2dd4bf" transparent opacity={0.38} toneMapped={false} />
      </mesh>
      <Text position={[0, 2.31, 0.02]} fontSize={0.22} color="#7dd3c8">
        KAI
      </Text>
      <Text position={[0, 2.09, 0.02]} fontSize={0.1} color="#93b4bd">
        PLAZA SECURITY
      </Text>
    </group>
  )
}
