import { MARKET_KEEPER } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'
import { ServiceAndroid } from './ServiceAndroid'

export function MarketKeeper() {
  return (
    <group position={[MARKET_KEEPER.x, 0, MARKET_KEEPER.z]}>
      <group scale={0.6}>
        <ServiceAndroid motion="Wave" style="mira" animationSpeed={0.92} />
        {/* Market apron, utility pouch, and shoulder wrap distinguish Mira's silhouette. */}
        <mesh position={[0, 1.35, 0.3]} castShadow>
          <boxGeometry args={[0.72, 0.92, 0.045]} />
          <meshStandardMaterial color="#d7b06c" roughness={0.86} />
        </mesh>
        <mesh position={[0.43, 1.08, 0.24]} castShadow>
          <boxGeometry args={[0.28, 0.38, 0.16]} />
          <meshStandardMaterial color="#4b3027" roughness={0.78} />
        </mesh>
        <mesh position={[0, 2.15, 0.02]} rotation={[0, 0, 0.08]}>
          <torusGeometry args={[0.42, 0.055, 8, 24, Math.PI * 1.45]} />
          <meshStandardMaterial color="#f5b942" roughness={0.55} metalness={0.18} />
        </mesh>
      </group>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.32, 0.46, 24]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.4} toneMapped={false} />
      </mesh>
      <Text
        position={[-0.02, 2.28, 0]}
        rotation={[0, 0, 0]}
        fontSize={0.22}
        color="#fbbf24"
      >
        MIRA
      </Text>
      <Text
        position={[-0.02, 2.06, 0]}
        rotation={[0, 0, 0]}
        fontSize={0.1}
        color="#d3b989"
      >
        NIGHT MARKET
      </Text>
    </group>
  )
}
