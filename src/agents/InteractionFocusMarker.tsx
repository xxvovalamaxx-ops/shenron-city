import type { InteractKind } from '../gameplay/interact'
import { useHud } from '../ui/hud-store'
import { interactionFocusMatches } from './interaction-focus'

interface Props {
  kind: InteractKind
  payload?: string
  color: string
  radius?: number
}

/**
 * A narrow, focus-only ground cue.
 *
 * The permanent development halos are gone. This appears only while the HUD
 * confirms that the same target is in range and in the player's view.
 */
export function InteractionFocusMarker({
  kind,
  payload,
  color,
  radius = 0.38,
}: Props) {
  const focused = useHud((state) =>
    interactionFocusMatches(
      { kind: state.promptKind, payload: state.promptPayload },
      kind,
      payload,
    ),
  )

  if (!focused) return null

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]}>
      <ringGeometry args={[radius, radius + 0.045, 32]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.42}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}
