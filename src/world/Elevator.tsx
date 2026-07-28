/**
 * The elevator: shaft, car, and the panel you press.
 *
 * The car group's Y is written by the game loop from `carHeight(elevator)` —
 * the same value that carries the player — so the floor under your feet and
 * the floor you are drawn standing on can never disagree.
 */
import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { FLOORS, currentFloor, type ElevatorState } from '../gameplay/elevator'
import { rt } from '../gameplay/runtime'
import { WorldText as Text } from '../ui/WorldText'
import { PANEL, SHAFT } from './layout'
import { PALETTE } from './palette'
import { DoorPair } from './Doors'

const SH = SHAFT.halfWidth
const CAR_Z = SHAFT.doorZ - SHAFT.carDepth / 2
const CAR_H = SHAFT.carHeight

/** Light rings racing past the car. The main cue that you are actually moving. */
function ShaftLights() {
  const group = useRef<Group>(null)

  useFrame(() => {
    const g = group.current
    if (!g) return
    const s: ElevatorState = rt.elevator
    if (s.phase !== 'travelling') {
      g.visible = false
      return
    }
    g.visible = true
    const from = FLOORS[s.from].y
    const to = FLOORS[s.target].y
    const carY = from + (to - from) * s.t
    // Rings are fixed in the shaft; we scroll them relative to the car so a
    // handful of meshes reads as a whole shaft's worth of passing structure.
    const spacing = 4
    g.position.y = carY - (((carY % spacing) + spacing) % spacing)
  })

  return (
    <group ref={group}>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[0, (i - 6) * 4, CAR_Z]}>
          <torusGeometry args={[SH * 1.5, 0.05, 6, 4]} />
          <meshBasicMaterial color={PALETTE.accentDim} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function FloorIndicator() {
  const shown = useRef('L')
  const [label, setLabel] = useState('L')

  useFrame(() => {
    const s = rt.elevator
    const floor = currentFloor(s)
    let label: string
    if (floor) {
      label = FLOORS[floor].label
    } else if (s.phase === 'travelling') {
      // Count through the intervening floors while in the shaft.
      const from = FLOORS[s.from].number
      const to = FLOORS[s.target].number
      label = String(Math.round(from + (to - from) * s.t))
    } else {
      label = shown.current
    }
    shown.current = label
    setLabel((current) => (current === label ? current : label))
  })

  return (
    <Text
      position={[0, CAR_H - 0.45, CAR_Z - SHAFT.carDepth / 2 + 0.12]}
      fontSize={0.32}
      color={PALETTE.accent}
      anchorX="center"
      anchorY="middle"
    >
      {label}
    </Text>
  )
}

function Panel() {
  return (
    <group position={[PANEL.x, PANEL.y, PANEL.z]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh>
        <boxGeometry args={[0.44, 1.0, 0.06]} />
        <meshStandardMaterial color="#12161c" roughness={0.3} metalness={0.7} />
      </mesh>
      {(['hq', 'lobby'] as const).map((id, i) => (
        <group key={id} position={[0, 0.25 - i * 0.5, 0.05]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.115, 0.115, 0.035, 20]} />
            <meshStandardMaterial color="#20262e" roughness={0.4} metalness={0.6} />
          </mesh>
          <Text position={[0, 0, 0.03]} fontSize={0.13} color={PALETTE.accent} anchorX="center">
            {FLOORS[id].label}
          </Text>
        </group>
      ))}
      <Text position={[0, -0.42, 0.05]} fontSize={0.055} color="#5c6b80" anchorX="center">
        PRESS E
      </Text>
    </group>
  )
}

export function Elevator() {
  const car = useRef<Group>(null)

  // The loop owns this transform; registering the ref is all React does.
  useFrame(() => {
    if (car.current) rt.refs.car = car.current
  })

  return (
    <group>
      <ShaftLights />

      {/*
        Shaft enclosure, built as separate walls rather than one box.
        A box here renders its near face inside the lobby — a 190 m black slab
        standing between you and the lift. Three walls behind the door line
        leave the opening genuinely open.
      */}
      <mesh position={[0, 92, SHAFT.backZ]}>
        <boxGeometry args={[SH * 2.8, 190, 0.4]} />
        <meshStandardMaterial color="#0a0d12" roughness={0.95} metalness={0.1} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * SH * 1.35, 92, (SHAFT.doorZ + SHAFT.backZ) / 2]}>
          <boxGeometry args={[0.4, 190, Math.abs(SHAFT.backZ - SHAFT.doorZ)]} />
          <meshStandardMaterial color="#0a0d12" roughness={0.95} metalness={0.1} />
        </mesh>
      ))}

      {/* Portal: the lift has to read as an opening in the wall, not a hole */}
      <group position={[0, 0, SHAFT.doorZ + 0.28]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (SH + 0.22), (CAR_H + 0.4) / 2, 0]}>
            <boxGeometry args={[0.44, CAR_H + 0.4, 0.5]} />
            <meshStandardMaterial color="#2c333d" roughness={0.28} metalness={0.92} />
          </mesh>
        ))}
        <mesh position={[0, CAR_H + 0.4, 0]}>
          <boxGeometry args={[SH * 2 + 0.88, 0.4, 0.5]} />
          <meshStandardMaterial color="#2c333d" roughness={0.28} metalness={0.92} />
        </mesh>
        {/* Lit reveal tracing the jamb */}
        <mesh position={[0, CAR_H + 0.62, 0.2]}>
          <boxGeometry args={[SH * 2 + 0.5, 0.05, 0.05]} />
          <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
        </mesh>
        {/* Call-panel plate beside the doors, lobby side */}
        <mesh position={[SH + 0.6, 1.3, 0.24]}>
          <boxGeometry args={[0.3, 0.5, 0.05]} />
          <meshStandardMaterial color="#151a21" roughness={0.4} metalness={0.6} />
        </mesh>
        <mesh position={[SH + 0.6, 1.42, 0.28]}>
          <circleGeometry args={[0.055, 16]} />
          <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
        </mesh>
      </group>

      {/* Wash so the lift alcove is never a black hole from across the lobby */}
      <pointLight
        position={[0, CAR_H - 0.2, SHAFT.doorZ + 1.6]}
        color={PALETTE.warmLight}
        intensity={105}
        distance={16}
        decay={2}
      />

      <group ref={car}>
        {/* Car shell */}
        <mesh position={[0, -0.08, CAR_Z]} receiveShadow>
          <boxGeometry args={[SH * 2, 0.16, SHAFT.carDepth]} />
          <meshStandardMaterial color="#1a1e24" roughness={0.3} metalness={0.7} />
        </mesh>
        <mesh position={[0, CAR_H + 0.08, CAR_Z]}>
          <boxGeometry args={[SH * 2, 0.16, SHAFT.carDepth]} />
          <meshStandardMaterial color="#15181d" roughness={0.6} metalness={0.4} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * SH, CAR_H / 2, CAR_Z]}>
            <boxGeometry args={[0.12, CAR_H, SHAFT.carDepth]} />
            <meshStandardMaterial color="#232830" roughness={0.25} metalness={0.85} />
          </mesh>
        ))}
        <mesh position={[0, CAR_H / 2, CAR_Z - SHAFT.carDepth / 2]}>
          <boxGeometry args={[SH * 2, CAR_H, 0.12]} />
          <meshStandardMaterial color="#232830" roughness={0.2} metalness={0.9} />
        </mesh>

        {/* Ceiling light */}
        <mesh position={[0, CAR_H - 0.04, CAR_Z]}>
          <boxGeometry args={[SH * 1.4, 0.03, SHAFT.carDepth * 0.6]} />
          <meshBasicMaterial color={PALETTE.warmLight} toneMapped={false} />
        </mesh>
        {/* Intensity is candela with physically-correct falloff: a ceiling
            light 3 m up needs hundreds, not single digits. The first pass used
            9 and the car read as an unlit void. */}
        <pointLight
          position={[0, CAR_H - 0.35, CAR_Z]}
          color={PALETTE.warmLight}
          intensity={130}
          distance={14}
          decay={2}
        />

        {/* Accent reveal at floor level */}
        <mesh position={[0, 0.03, CAR_Z]}>
          <boxGeometry args={[SH * 1.9, 0.02, SHAFT.carDepth * 0.95]} />
          <meshBasicMaterial color={PALETTE.accentDim} toneMapped={false} />
        </mesh>

        <Panel />
        <FloorIndicator />

        <DoorPair
          halfWidth={SH}
          height={CAR_H - 0.2}
          z={SHAFT.doorZ}
          glass={false}
          leftRef={(g) => {
            rt.refs.carDoorLeft = g
          }}
          rightRef={(g) => {
            rt.refs.carDoorRight = g
          }}
        />
      </group>
    </group>
  )
}
