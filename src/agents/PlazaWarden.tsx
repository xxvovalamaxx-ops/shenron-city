/** Kai — plaza security on the production humanoid rig. */
import { Suspense } from 'react'
import { PLAZA_WARDEN } from '../world/city-data'
import { WorldText as Text } from '../ui/WorldText'
import { useHud } from '../ui/hud-store'
import { InteractionFocusMarker } from './InteractionFocusMarker'
import { QuaterniusHero } from './QuaterniusHero'

export function PlazaWarden() {
  const talking = useHud(
    (state) => state.screen === 'dialogue' && state.openCharacterId === 'kai',
  )

  return (
    <group position={[PLAZA_WARDEN.x, 0, PLAZA_WARDEN.z]} name="hero-character-kai">
      <Suspense fallback={null}>
        <QuaterniusHero
          motion={talking ? 'Idle_Talking_Loop' : 'Idle_FoldArms_Loop'}
          animationSpeed={talking ? 0.92 : 0.78}
          appearance={1}
          phase={0.18}
          height={1.84}
          scope="outdoor"
        />
      </Suspense>
      <InteractionFocusMarker kind="city-character" payload="kai" color="#7ec7bd" />
      <Text position={[0, 2.18, 0.06]} fontSize={0.16} color="#b8d6d1" anchorX="center">
        KAI
      </Text>
      <Text position={[0, 1.99, 0.06]} fontSize={0.07} color="#809da2" anchorX="center">
        PLAZA SECURITY
      </Text>
    </group>
  )
}
