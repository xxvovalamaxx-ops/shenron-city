import { Suspense } from 'react'
import { MARKET_KEEPER } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'
import { InteractionFocusMarker } from './InteractionFocusMarker'
import { QuaterniusHero } from './QuaterniusHero'

export function MarketKeeper() {
  return (
    <group position={[MARKET_KEEPER.x, 0, MARKET_KEEPER.z]} name="hero-character-mira">
      <Suspense fallback={null}>
        <QuaterniusHero
          motion="Idle_TalkingPhone_Loop"
          animationSpeed={0.78}
          appearance={5}
          phase={0.62}
          height={1.7}
        />
      </Suspense>
      <InteractionFocusMarker kind="city-character" payload="mira" color="#d8a862" />
      <Text position={[0, 2.08, 0.08]} fontSize={0.15} color="#efd6a7" anchorX="center">
        MIRA
      </Text>
      <Text position={[0, 1.9, 0.08]} fontSize={0.07} color="#a98d6d" anchorX="center">
        NIGHT MARKET
      </Text>
    </group>
  )
}
