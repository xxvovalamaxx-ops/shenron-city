/**
 * One agent's office on floor 45.
 *
 * Everything visible here is driven by the standalone scenario.
 * An empty slot renders as a dark, unlit, explicitly vacant room rather than
 * as a plausible-looking agent — a control surface must not invent occupancy.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh, MeshStandardMaterial } from 'three'
import type { Agent } from '../contracts/mission-control'
import { WorldText as Text } from '../ui/WorldText'
import { OFFICE, type OfficeSlot } from '../world/layout'
import { PALETTE, STATE_COLOR, STATE_GLOW, STATE_LABEL } from '../world/palette'

interface Props {
  slot: OfficeSlot
  agent: Agent | null
  y: number
}

/** Truncate for in-world display; long task strings must not overrun the sign. */
function clip(s: string | null, n: number): string {
  if (!s) return '—'
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/**
 * The agent's physical presence.
 *
 * Not a humanoid — a rigged character needs an asset pipeline the slice does
 * not have yet, and a bad human model reads far worse than an honest abstract
 * form. A slowly rotating core whose pulse rate tracks activity communicates
 * the same information without pretending to be something it is not.
 */
function Presence({ agent }: { agent: Agent }) {
  const core = useRef<Mesh>(null)
  const glow = useRef<MeshStandardMaterial>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const m = core.current
    if (m) {
      m.rotation.y = t * (agent.state === 'active' ? 0.55 : 0.09)
      m.rotation.x = Math.sin(t * 0.3) * 0.12
      m.position.y = 1.35 + Math.sin(t * (agent.state === 'active' ? 2.2 : 0.7)) * 0.045
    }
    if (glow.current) {
      const base = STATE_GLOW[agent.state]
      const pulse = agent.state === 'active' ? 0.35 * Math.sin(t * 3.1) : 0
      glow.current.emissiveIntensity = Math.max(0, base + pulse)
    }
  })

  const color = STATE_COLOR[agent.state]

  return (
    <group>
      <mesh ref={core} position={[0, 1.35, 0]} castShadow>
        <icosahedronGeometry args={[0.34, 1]} />
        <meshStandardMaterial
          ref={glow}
          color={color}
          emissive={color}
          emissiveIntensity={STATE_GLOW[agent.state]}
          roughness={0.25}
          metalness={0.6}
          flatShading
        />
      </mesh>
      {/* Grounding shadow-catcher ring so the core does not look weightless */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.28, 0.42, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.25} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 1.5, 0]} color={color} intensity={26} distance={7} decay={2} />
    </group>
  )
}

export function AgentOffice({ slot, agent, y }: Props) {
  const inward = -slot.side // toward the corridor
  const color = agent ? STATE_COLOR[agent.state] : '#2a2f37'

  return (
    <group position={[slot.x, y, slot.z]}>
      {/* Back wall */}
      <mesh position={[(slot.side * OFFICE.w) / 2, OFFICE.h / 2, 0]} receiveShadow>
        <boxGeometry args={[0.3, OFFICE.h, OFFICE.d]} />
        <meshStandardMaterial color={PALETTE.concrete} roughness={0.85} />
      </mesh>

      {/* Side fins */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, OFFICE.h / 2, (s * OFFICE.d) / 2]} receiveShadow>
          <boxGeometry args={[OFFICE.w, OFFICE.h, 0.3]} />
          <meshStandardMaterial color={PALETTE.concrete} roughness={0.85} />
        </mesh>
      ))}

      {/* Glass front, split to leave a walk-in gap in the middle */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[(inward * OFFICE.w) / 2, OFFICE.h / 2, s * (OFFICE.d / 2 - OFFICE.d / 8)]}
        >
          <boxGeometry args={[0.06, OFFICE.h, OFFICE.d / 4]} />
          <meshPhysicalMaterial
            color={PALETTE.glass}
            roughness={0.04}
            transmission={0.92}
            thickness={0.2}
            transparent
            opacity={0.3}
          />
        </mesh>
      ))}

      {/* Desk */}
      <mesh position={[slot.side * 1.6, 0.55, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 1.1, 1.2]} />
        <meshStandardMaterial color="#1b1f26" roughness={0.4} metalness={0.5} />
      </mesh>

      {/* Wall monitor — the office's local scenario readout */}
      <group
        position={[slot.side * (OFFICE.w / 2 - 0.22), 1.85, 0]}
        rotation={[0, slot.side === 1 ? -Math.PI / 2 : Math.PI / 2, 0]}
      >
        <mesh>
          <boxGeometry args={[3.0, 1.7, 0.08]} />
          <meshStandardMaterial color="#080a0d" roughness={0.35} metalness={0.4} />
        </mesh>
        {agent ? (
          <>
            <Text position={[-1.35, 0.62, 0.05]} fontSize={0.19} color="#e6edf6" anchorX="left">
              {clip(agent.name, 22)}
            </Text>
            <Text position={[-1.35, 0.34, 0.05]} fontSize={0.115} color="#5d6b80" anchorX="left">
              {clip(agent.role, 28)}
            </Text>
            <Text position={[1.35, 0.62, 0.05]} fontSize={0.16} color={color} anchorX="right">
              {STATE_LABEL[agent.state]}
            </Text>

            <mesh position={[0, 0.16, 0.05]}>
              <boxGeometry args={[2.7, 0.012, 0.01]} />
              <meshBasicMaterial color="#1d242e" toneMapped={false} />
            </mesh>

            <Text position={[-1.35, -0.04, 0.05]} fontSize={0.1} color="#4d5a6d" anchorX="left">
              ACTIVITY
            </Text>
            <Text position={[-1.35, -0.24, 0.05]} fontSize={0.125} color="#b9c6d6" anchorX="left">
              {clip(agent.currentTask, 34)}
            </Text>

            <Text position={[-1.35, -0.56, 0.05]} fontSize={0.1} color="#4d5a6d" anchorX="left">
              ROLE
            </Text>
            <Text position={[-0.55, -0.56, 0.05]} fontSize={0.1} color="#8b9aad" anchorX="left">
              {clip(agent.role, 20)}
            </Text>
            <Text position={[1.35, -0.56, 0.05]} fontSize={0.1} color="#4d5a6d" anchorX="right">
              {`${STATE_LABEL[agent.state]}  ·  ${agent.completedTasks} BEATS  ·  ${agent.failedActions} INCIDENTS`}
            </Text>
          </>
        ) : (
          <Text position={[0, 0, 0.05]} fontSize={0.19} color="#39424f" anchorX="center">
            VACANT
          </Text>
        )}
      </group>

      {/* Name plate by the door */}
      <group position={[inward * (OFFICE.w / 2 + 0.05), 2.1, OFFICE.d / 2 - 0.5]}>
        <mesh rotation={[0, slot.side === 1 ? -Math.PI / 2 : Math.PI / 2, 0]}>
          <boxGeometry args={[1.5, 0.34, 0.04]} />
          <meshStandardMaterial color="#12161b" roughness={0.5} metalness={0.4} />
        </mesh>
        <Text
          position={[inward * 0.04, 0, 0]}
          rotation={[0, slot.side === 1 ? -Math.PI / 2 : Math.PI / 2, 0]}
          fontSize={0.13}
          color={color}
          anchorX="center"
        >
          {agent ? clip(agent.name, 18) : 'VACANT'}
        </Text>
      </group>

      {agent && <Presence agent={agent} />}

      {/* Ceiling light — vacant offices stay dark, which is the honest signal */}
      {agent && (
        <pointLight
          position={[0, OFFICE.h - 0.35, 0]}
          color={PALETTE.warmLight}
          intensity={90}
          distance={13}
          decay={2}
        />
      )}
    </group>
  )
}
