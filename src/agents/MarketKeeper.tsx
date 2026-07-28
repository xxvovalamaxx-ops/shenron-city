import { MARKET_KEEPER } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'
import { InteractionFocusMarker } from './InteractionFocusMarker'
import { KenneyCitizen } from './KenneyCitizen'

export function MarketKeeper() {
  return (
    <group position={[MARKET_KEEPER.x, 0, MARKET_KEEPER.z]}>
      <group>
        <KenneyCitizen motion="Idle" skin="humanFemale" animationSpeed={0.86} />
        {/* Market apron and utility pouch distinguish Mira's vendor role. */}
        <mesh position={[0, 0.92, 0.23]} castShadow>
          <boxGeometry args={[0.64, 0.72, 0.035]} />
          <meshStandardMaterial color="#d7b06c" roughness={0.86} />
        </mesh>
        <mesh position={[0.38, 0.82, 0.2]} castShadow>
          <boxGeometry args={[0.22, 0.3, 0.12]} />
          <meshStandardMaterial color="#4b3027" roughness={0.78} />
        </mesh>
      </group>

      <InteractionFocusMarker kind="city-character" payload="mira" color="#f59e0b" />
      <Text
        position={[-0.02, 2.08, 0]}
        rotation={[0, 0, 0]}
        fontSize={0.22}
        color="#fbbf24"
      >
        MIRA
      </Text>
      <Text
        position={[-0.02, 1.88, 0]}
        rotation={[0, 0, 0]}
        fontSize={0.1}
        color="#d3b989"
      >
        NIGHT MARKET
      </Text>
    </group>
  )
}
