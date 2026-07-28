/** Floor 45 live layer over the authored production interior. */
import type { Agent, WorldSnapshot } from '../contracts/mission-control'
import { AgentOffice } from '../agents/AgentOffice'
import { WorldText as Text } from '../ui/WorldText'
import { HQ, OFFICE_SLOTS } from './layout'
import type { QualitySettings } from './palette'
import { ProductionFloor45 } from './ProductionScene'

export function Floor45({
  agents,
  quality,
  source,
}: {
  agents: Agent[]
  quality: QualitySettings
  source: WorldSnapshot['source']
}) {
  const hidden = Math.max(0, agents.length - OFFICE_SLOTS.length)

  return (
    <group name="floor-45-zone">
      <ProductionFloor45 quality={quality} />

      {OFFICE_SLOTS.map((slot) => (
        <AgentOffice
          key={slot.index}
          slot={slot}
          agent={agents[slot.index] ?? null}
          y={HQ.y}
        />
      ))}

      <Text
        position={[0, HQ.y + 2.65, HQ.frontZ - 0.24]}
        fontSize={1.35}
        color="#dbeafe"
        anchorX="center"
      >
        45
      </Text>
      <Text
        position={[0, HQ.y + 1.55, HQ.frontZ - 0.24]}
        fontSize={0.22}
        color="#8ea0b4"
        anchorX="center"
      >
        SHENRON OPERATIONS
      </Text>

      {hidden > 0 ? (
        <Text
          position={[0, HQ.y + 3.8, HQ.backZ + 1.1]}
          fontSize={0.18}
          color="#d0a25f"
          anchorX="center"
        >
          {`+${hidden} additional agent${hidden === 1 ? '' : 's'} not assigned to this floor`}
        </Text>
      ) : null}

      {source === 'standalone' ? (
        <Text
          position={[0, HQ.y + 4.1, HQ.backZ + 1.1]}
          fontSize={0.2}
          color="#d0a25f"
          anchorX="center"
        >
          OFFLINE · LOCAL SCENARIO DATA
        </Text>
      ) : null}
    </group>
  )
}
