/**
 * Procedural street props: benches, trash cans, street signs, lampposts.
 *
 * All geometry is code-generated — no external model files needed.
 * Props are placed along the boulevard sidewalks.
 */
import { useMemo } from 'react'
import { BOULEVARD } from './city-data'
import { PALETTE } from './palette'
import { useWoodMaterial, useMetalRustMaterial } from './PBRMaterials'

function Bench({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const wood = useWoodMaterial()
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Seat planks */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.06, 0.4]} />
        <primitive object={wood} attach="material" />
      </mesh>
      {/* Backrest */}
      <mesh position={[0, 0.72, -0.17]} castShadow>
        <boxGeometry args={[1.6, 0.35, 0.05]} />
        <primitive object={wood} attach="material" />
      </mesh>
      {/* Metal frame legs */}
      {[-0.65, 0.65].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]} castShadow>
          <boxGeometry args={[0.06, 0.44, 0.38]} />
          <meshStandardMaterial color={PALETTE.metal} roughness={0.4} metalness={0.8} />
        </mesh>
      ))}
      {/* Armrests */}
      {[-0.65, 0.65].map((x) => (
        <mesh key={`a${x}`} position={[x, 0.58, 0.05]} castShadow>
          <boxGeometry args={[0.06, 0.06, 0.35]} />
          <meshStandardMaterial color={PALETTE.metal} roughness={0.4} metalness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function TrashCan({ position }: { position: [number, number, number] }) {
  const metal = useMetalRustMaterial()
  return (
    <group position={position}>
      {/* Cylinder body */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.22, 0.25, 0.8, 12]} />
        <primitive object={metal} attach="material" />
      </mesh>
      {/* Rim */}
      <mesh position={[0, 0.82, 0]}>
        <cylinderGeometry args={[0.26, 0.24, 0.05, 12]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.35} metalness={0.85} />
      </mesh>
    </group>
  )
}

function StreetLamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Pole */}
      <mesh position={[0, 2.2, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 4.4, 8]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.35} metalness={0.85} />
      </mesh>
      {/* Arm */}
      <mesh position={[0.4, 4.1, 0]} rotation={[0, 0, -0.3]}>
        <boxGeometry args={[0.9, 0.05, 0.05]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.35} metalness={0.85} />
      </mesh>
      {/* Lamp housing */}
      <mesh position={[0.8, 4.0, 0]}>
        <boxGeometry args={[0.3, 0.15, 0.2]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Lamp light */}
      <mesh position={[0.8, 3.9, 0]}>
        <boxGeometry args={[0.22, 0.04, 0.14]} />
        <meshBasicMaterial color={PALETTE.warmLight} toneMapped={false} />
      </mesh>
      <pointLight
        position={[0.8, 3.7, 0]}
        color={PALETTE.warmLight}
        intensity={120}
        distance={18}
        decay={2}
        castShadow={false}
      />
    </group>
  )
}

function BenchSign({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Post */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 2, 6]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.4} metalness={0.8} />
      </mesh>
      {/* Sign plate */}
      <mesh position={[0, 1.85, 0]} castShadow>
        <boxGeometry args={[0.8, 0.35, 0.03]} />
        <meshStandardMaterial color="#1a2030" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Sign border glow */}
      <mesh position={[0, 1.85, 0.02]}>
        <boxGeometry args={[0.82, 0.37, 0.005]} />
        <meshBasicMaterial color={PALETTE.accent} transparent opacity={0.15} toneMapped={false} />
      </mesh>
    </group>
  )
}

export function StreetProps() {
  const sidewalkX = BOULEVARD.width / 2 + BOULEVARD.sidewalkWidth / 2

  const props = useMemo(() => {
    const items: Array<{ type: string; x: number; z: number; side: number; rot: number }> = []

    // Benches along both sidewalks
    for (let z = 8; z < BOULEVARD.depth; z += 14) {
      items.push({ type: 'bench', x: -sidewalkX + 1.2, z, side: -1, rot: Math.PI / 2 })
      items.push({ type: 'bench', x: sidewalkX - 1.2, z, side: 1, rot: -Math.PI / 2 })
    }

    // Trash cans near benches
    for (let z = 12; z < BOULEVARD.depth; z += 28) {
      items.push({ type: 'trash', x: -sidewalkX + 0.6, z, side: -1, rot: 0 })
      items.push({ type: 'trash', x: sidewalkX - 0.6, z, side: 1, rot: 0 })
    }

    // Street lamps along the road edges
    for (let z = 4; z < BOULEVARD.depth; z += 20) {
      items.push({ type: 'lamp', x: -BOULEVARD.width / 2 - 0.5, z, side: -1, rot: 0 })
      items.push({ type: 'lamp', x: BOULEVARD.width / 2 + 0.5, z, side: 1, rot: 0 })
    }

    // Street signs at intervals
    for (let z = 16; z < BOULEVARD.depth; z += 35) {
      items.push({ type: 'sign', x: -sidewalkX + 0.8, z, side: -1, rot: 0 })
      items.push({ type: 'sign', x: sidewalkX - 0.8, z, side: 1, rot: Math.PI })
    }

    return items
  }, [sidewalkX])

  return (
    <group>
      {props.map((p, i) => {
        const pos: [number, number, number] = [p.x, 0, p.z]
        switch (p.type) {
          case 'bench':
            return <Bench key={i} position={pos} rotation={p.rot} />
          case 'trash':
            return <TrashCan key={i} position={pos} />
          case 'lamp':
            return <StreetLamp key={i} position={pos} />
          case 'sign':
            return <BenchSign key={i} position={pos} rotation={p.rot} />
          default:
            return null
        }
      })}
    </group>
  )
}
