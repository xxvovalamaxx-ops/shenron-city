/** Iris — headquarters reception, presented with the production humanoid rig. */
import { Suspense } from 'react'
import { useHud } from '../ui/hud-store'
import { WorldText as Text } from '../ui/WorldText'
import { SECRETARY } from '../world/layout'
import { PALETTE } from '../world/palette'
import { InteractionFocusMarker } from './InteractionFocusMarker'
import { QuaterniusHero } from './QuaterniusHero'

export const SECRETARY_NAME = 'Iris'

export function Secretary() {
  const talking = useHud(
    (state) => state.screen === 'dialogue' && state.openCharacterId === 'iris',
  )

  return (
    <group position={[SECRETARY.x, 0, SECRETARY.z]} name="hero-character-iris">
      <Suspense fallback={null}>
        <QuaterniusHero
          motion={talking ? 'Idle_Talking_Loop' : 'Idle_Loop'}
          animationSpeed={talking ? 0.98 : 0.78}
          appearance={4}
          phase={0.31}
          height={1.72}
        />
      </Suspense>

      <spotLight
        position={[0.8, 3.3, 1.5]}
        target-position={[0, 1.1, 0]}
        color={PALETTE.warmLight}
        intensity={64}
        distance={10}
        angle={0.46}
        penumbra={0.72}
        decay={2}
      />
      <InteractionFocusMarker kind="secretary" color={PALETTE.accent} />

      <group position={[0, 2.08, 0.18]}>
        <Text fontSize={0.15} color="#dbe9ef" anchorX="center">
          {SECRETARY_NAME}
        </Text>
        <Text position={[0, -0.18, 0]} fontSize={0.07} color="#8195a2" anchorX="center">
          RECEPTION · OFFLINE
        </Text>
      </group>
    </group>
  )
}
