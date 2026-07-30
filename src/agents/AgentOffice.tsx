/**
 * Runtime identity and interaction layer for one authored Floor 45 office.
 *
 * All architectural geometry, furniture, glazing, and workstation hardware
 * live in the Blender-authored floor GLB. This component adds only truthful
 * live state, the animated CC0 service embodiment, and its interaction target.
 */
import type { Agent } from '../contracts/mission-control'
import { WorldText as Text } from '../ui/WorldText'
import type { OfficeSlot } from '../world/layout'
import { STATE_COLOR, STATE_LABEL } from '../world/palette'
import { ServiceAndroid } from './ServiceAndroid'
import { InteractionFocusMarker } from './InteractionFocusMarker'
import { motionForAgentState, styleForAgentName } from './service-android'

interface Props {
  slot: OfficeSlot
  agent: Agent | null
  y: number
}

function clip(value: string | null, length: number): string {
  if (!value) return '—'
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

function Presence({ agent }: { agent: Agent }) {
  return (
    <ServiceAndroid
      motion={motionForAgentState(agent.state)}
      style={styleForAgentName(agent.name)}
      animationSpeed={agent.state === 'active' ? 0.92 : 0.72}
      expression={
        agent.state === 'failed'
          ? 'concerned'
          : agent.state === 'blocked'
            ? 'alert'
            : 'neutral'
      }
      height={1.78}
      scope="floor45"
    />
  )
}

export function AgentOffice({ slot, agent, y }: Props) {
  const color = agent ? STATE_COLOR[agent.state] : '#52606f'
  const corridorX = slot.x + slot.side * 4.25

  return (
    <group position={[slot.x, y, slot.z]} name={`agent-office-${slot.index}`}>
      {agent ? (
        <>
          <Presence agent={agent} />
          <InteractionFocusMarker
            kind="agent-office"
            payload={agent.id}
            color={color}
            radius={0.25}
          />
          <pointLight
            position={[0, 2.65, 0.4]}
            color={color}
            intensity={14}
            distance={5}
            decay={2}
          />
        </>
      ) : null}

      <group
        position={[corridorX - slot.x, 2.22, 2.75]}
        rotation={[0, slot.side * Math.PI / 2, 0]}
      >
        <Text fontSize={0.15} color={color} anchorX="center">
          {agent ? clip(agent.name, 18) : 'VACANT'}
        </Text>
        <Text position={[0, -0.25, 0]} fontSize={0.085} color="#9aa8b6" anchorX="center">
          {agent ? STATE_LABEL[agent.state] : 'NO ASSIGNMENT'}
        </Text>
        {agent?.currentTask ? (
          <Text position={[0, -0.43, 0]} fontSize={0.065} color="#697887" anchorX="center">
            {clip(agent.currentTask, 30)}
          </Text>
        ) : null}
      </group>
    </group>
  )
}
