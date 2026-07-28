import { MARKET_KEEPER } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'
import { CitizenCharacter } from './CitizenCharacter'

export function MarketKeeper() {
  return (
    <group position={[MARKET_KEEPER.x, 0, MARKET_KEEPER.z]}>
      <CitizenCharacter
        role="vendor"
        facing={0}
        phase={0.7}
        style={{
          skin: '#b98569',
          hair: '#251c19',
          jacket: '#654760',
          trousers: '#292d38',
          shoes: '#17191f',
          accent: '#d8a849',
        }}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <ringGeometry args={[0.32, 0.46, 24]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.4} toneMapped={false} />
      </mesh>
      <Text
        position={[-0.02, 2.35, 0]}
        rotation={[0, 0, 0]}
        fontSize={0.22}
        color="#fbbf24"
      >
        MIRA
      </Text>
      <Text
        position={[-0.02, 2.12, 0]}
        rotation={[0, 0, 0]}
        fontSize={0.1}
        color="#d3b989"
      >
        NIGHT MARKET
      </Text>
    </group>
  )
}
