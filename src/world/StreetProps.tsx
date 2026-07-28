/**
 * Procedural street props: benches, trash cans, street signs, lampposts.
 *
 * All geometry is code-generated — no external model files needed.
 * Props are placed along the boulevard sidewalks.
 */
import { STREET_PROPS } from './city-data'
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
  return (
    <group>
      {STREET_PROPS.map((p) => {
        const pos: [number, number, number] = [p.x, 0, p.z]
        switch (p.kind) {
          case 'bench':
            return <Bench key={p.id} position={pos} rotation={p.rotation} />
          case 'trash':
            return <TrashCan key={p.id} position={pos} />
          case 'sign':
            return <BenchSign key={p.id} position={pos} rotation={p.rotation} />
          default:
            return null
        }
      })}
    </group>
  )
}
