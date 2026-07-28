/**
 * Authored elevator shell and cabin with deterministic gameplay-owned motion.
 *
 * Blender owns every visible constructed surface. The runtime retains only
 * lighting, text, door transforms, and the tested elevator state machine.
 */
import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { FLOORS, currentFloor } from '../gameplay/elevator'
import { rt } from '../gameplay/runtime'
import { WorldText as Text } from '../ui/WorldText'
import { PANEL, SHAFT } from './layout'
import { PALETTE } from './palette'
import { DoorPair } from './Doors'
import { ProductionStatic, PRODUCTION_ASSETS } from './ProductionScene'

const SH = SHAFT.halfWidth
const CAR_Z = SHAFT.doorZ - SHAFT.carDepth / 2
const CAR_H = SHAFT.carHeight

function FloorIndicator() {
  const shown = useRef('L')
  const [label, setLabel] = useState('L')

  useFrame(() => {
    const state = rt.elevator
    const floor = currentFloor(state)
    let next: string
    if (floor) {
      next = FLOORS[floor].label
    } else if (state.phase === 'travelling') {
      const from = FLOORS[state.from].number
      const to = FLOORS[state.target].number
      next = String(Math.round(from + (to - from) * state.t))
    } else {
      next = shown.current
    }
    shown.current = next
    setLabel((current) => (current === next ? current : next))
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

function PanelLabels() {
  return (
    <group position={[PANEL.x - 0.075, PANEL.y, PANEL.z]} rotation={[0, -Math.PI / 2, 0]}>
      <Text position={[0, 0.25, 0.04]} fontSize={0.13} color={PALETTE.accent} anchorX="center">
        {FLOORS.hq.label}
      </Text>
      <Text position={[0, -0.25, 0.04]} fontSize={0.13} color={PALETTE.accent} anchorX="center">
        {FLOORS.lobby.label}
      </Text>
      <Text position={[0, -0.48, 0.04]} fontSize={0.05} color="#8192a5" anchorX="center">
        PRESS E
      </Text>
    </group>
  )
}

export function Elevator() {
  const car = useRef<Group>(null)

  useFrame(() => {
    if (car.current) rt.refs.car = car.current
  })

  return (
    <group name="production-elevator">
      <ProductionStatic url={PRODUCTION_ASSETS.elevatorStatic} shadows />

      <pointLight
        position={[0, CAR_H - 0.2, SHAFT.doorZ + 1.6]}
        color={PALETTE.warmLight}
        intensity={46}
        distance={16}
        decay={2}
      />

      <group ref={car}>
        <ProductionStatic url={PRODUCTION_ASSETS.elevatorCar} shadows />
        <pointLight
          position={[0, CAR_H - 0.35, CAR_Z]}
          color={PALETTE.warmLight}
          intensity={52}
          distance={14}
          decay={2}
        />
        <PanelLabels />
        <FloorIndicator />
        <DoorPair
          halfWidth={SH}
          height={CAR_H - 0.2}
          z={SHAFT.doorZ}
          glass={false}
          leftRef={(group) => {
            rt.refs.carDoorLeft = group
          }}
          rightRef={(group) => {
            rt.refs.carDoorRight = group
          }}
        />
      </group>
    </group>
  )
}
