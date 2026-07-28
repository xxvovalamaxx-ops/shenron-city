/**
 * Floor 45 — the AI headquarters.
 *
 * Six offices bound to the first six agents the adapter reports, by stable
 * index. Slots beyond the agent count render as vacant; agents beyond six are
 * not shown, and the corridor sign says so rather than silently truncating.
 */
import type { Agent, WorldSnapshot } from '../contracts/mission-control'
import { AgentOffice } from '../agents/AgentOffice'
import { WorldText as Text } from '../ui/WorldText'
import { HQ, OFFICE_SLOTS, SHAFT } from './layout'
import { PALETTE, type QualitySettings } from './palette'

const { y: Y, halfWidth: W, frontZ: F, backZ: B, ceiling: C } = HQ
const DEPTH = Math.abs(B - F)
const MID = (F + B) / 2

export function Floor45({
  agents,
  quality,
  source,
}: {
  agents: Agent[]
  quality: QualitySettings
  /** Drives the in-world sign. Only 'standalone' carries the fiction warning. */
  source: WorldSnapshot['source']
}) {
  const hidden = Math.max(0, agents.length - OFFICE_SLOTS.length)

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Y + 0.01, MID]} receiveShadow>
        <planeGeometry args={[W * 2, DEPTH]} />
        <meshStandardMaterial
          color="#0c0f14"
          roughness={quality.reflections ? 0.18 : 0.4}
          metalness={0.8}
        />
      </mesh>

      {/* Corridor guide lines — thin, for the same reason as the lobby's */}
      {[-1.7, 1.7].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, Y + 0.02, MID]}>
          <planeGeometry args={[0.09, DEPTH - 3]} />
          <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, Y + 0.015, MID]}>
        <planeGeometry args={[3.4, DEPTH - 3]} />
        <meshStandardMaterial color="#12181f" roughness={0.45} metalness={0.6} />
      </mesh>

      {/* Ceiling */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, Y + C, MID]}>
        <planeGeometry args={[W * 2, DEPTH]} />
        <meshStandardMaterial color="#0d1015" roughness={0.95} />
      </mesh>

      {/* Corridor light run */}
      {[-4, -12, -20, -28].map((z) => (
        <group key={z}>
          <mesh position={[0, Y + C - 0.06, z]}>
            <boxGeometry args={[2.4, 0.04, 0.3]} />
            <meshBasicMaterial color="#dce8ff" toneMapped={false} />
          </mesh>
          <pointLight
            position={[0, Y + C - 0.5, z]}
            color={PALETTE.coolLight}
            intensity={340}
            distance={26}
            decay={2}
          />
        </group>
      ))}

      {/* Window walls. Glass to the night — you are 180 m up. */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * W, Y + C / 2, MID]}>
          <boxGeometry args={[0.18, C, DEPTH]} />
          <meshPhysicalMaterial
            color="#0a1220"
            roughness={0.03}
            metalness={0.1}
            transmission={0.55}
            thickness={0.5}
            transparent
            opacity={0.72}
          />
        </mesh>
      ))}

      {/* Far end wall with the floor mark */}
      <mesh position={[0, Y + C / 2, F]} receiveShadow>
        <boxGeometry args={[W * 2, C, 0.4]} />
        <meshStandardMaterial color={PALETTE.concrete} roughness={0.85} />
      </mesh>
      <Text
        position={[0, Y + 2.6, F - 0.25]}
        fontSize={1.5}
        color={PALETTE.accent}
        anchorX="center"
        anchorY="middle"
      >
        45
      </Text>
      <Text position={[0, Y + 1.5, F - 0.25]} fontSize={0.24} color="#66788f" anchorX="center">
        AI HEADQUARTERS
      </Text>

      {/* Back wall around the elevator */}
      {[-1, 1].map((s) => {
        const sideW = W - SHAFT.halfWidth
        return (
          <mesh key={s} position={[s * (SHAFT.halfWidth + sideW / 2), Y + C / 2, B]} receiveShadow>
            <boxGeometry args={[sideW, C, 0.4]} />
            <meshStandardMaterial color={PALETTE.stone} roughness={0.7} metalness={0.2} />
          </mesh>
        )
      })}
      <mesh position={[0, Y + C - 0.6, B]}>
        <boxGeometry args={[SHAFT.halfWidth * 2, 1.2, 0.4]} />
        <meshStandardMaterial color={PALETTE.stone} roughness={0.7} metalness={0.2} />
      </mesh>

      {/* Offices */}
      {OFFICE_SLOTS.map((slot) => (
        <AgentOffice key={slot.index} slot={slot} agent={agents[slot.index] ?? null} y={Y} />
      ))}

      {/* Honest note when the floor cannot show everything it was given */}
      {hidden > 0 && (
        <Text
          position={[0, Y + 3.6, B + 1.2]}
          fontSize={0.2}
          color="#8a6a3a"
          anchorX="center"
        >
          {`+${hidden} more agent${hidden === 1 ? '' : 's'} not shown — floor has ${OFFICE_SLOTS.length} offices`}
        </Text>
      )}

      {source === 'standalone' && (
        <Text
          position={[0, Y + 4.0, B + 1.2]}
          fontSize={0.26}
          color="#f59e0b"
          anchorX="center"
        >
          STANDALONE PROTOTYPE — OFFLINE GAME DATA
        </Text>
      )}
    </group>
  )
}
