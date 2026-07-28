/** Headquarters lobby live signage over the Blender-authored interior. */
import { WorldText as Text } from '../ui/WorldText'
import type { QualitySettings } from './palette'
import { LOBBY } from './layout'
import { ProductionLobby } from './ProductionScene'

export function Lobby({ quality }: { quality: QualitySettings }) {
  return (
    <group name="headquarters-lobby-zone">
      <ProductionLobby quality={quality} />

      <Text
        position={[-6.5, 4.45, LOBBY.backZ + 0.24]}
        fontSize={0.78}
        color="#dce7ef"
        anchorX="center"
      >
        SHENRON
      </Text>
      <Text
        position={[-6.5, 3.62, LOBBY.backZ + 0.24]}
        fontSize={0.23}
        color="#7f91a1"
        anchorX="center"
      >
        OPERATIONS HEADQUARTERS
      </Text>
      <Text
        position={[13.2, 3.72, LOBBY.backZ + 0.24]}
        fontSize={0.24}
        color="#dce7ef"
        anchorX="center"
      >
        DIRECTORY
      </Text>
      {[
        ['45', 'SHENRON OPERATIONS'],
        ['30–44', 'CITY SYSTEMS'],
        ['12–29', 'ENGINEERING'],
        ['02–11', 'RESEARCH'],
        ['L', 'RECEPTION'],
      ].map(([floor, label], index) => (
        <group
          key={floor}
          position={[13.2, 3.18 - index * 0.47, LOBBY.backZ + 0.24]}
        >
          <Text position={[-2.35, 0, 0]} fontSize={0.18} color="#bac8d4" anchorX="left">
            {floor}
          </Text>
          <Text position={[-1.05, 0, 0]} fontSize={0.17} color="#708292" anchorX="left">
            {label}
          </Text>
        </group>
      ))}
    </group>
  )
}
