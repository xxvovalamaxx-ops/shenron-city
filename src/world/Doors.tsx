/**
 * Sliding door pairs — the entrance and the elevator car.
 *
 * These meshes are positioned by the game loop, not by React state, so their
 * transform is exact on the frame the physics used. The components only
 * register refs.
 */
import { forwardRef } from 'react'
import type { Group } from 'three'
import { PALETTE } from './palette'

interface LeafProps {
  width: number
  height: number
  glass?: boolean
}

const Leaf = forwardRef<Group, LeafProps>(function Leaf({ width, height, glass = true }, ref) {
  return (
    <group ref={ref}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, 0.08]} />
        {glass ? (
          /*
            Plain alpha blending, not `transmission`.

            Transmission refracts through a backbuffer copy: expensive, and at
            these thicknesses it turned the entrance into a milky slab you
            could not see the lobby through — the opposite of what a glass
            front door is for. Low-opacity glass reads as glass and you can see
            what is inside, which is the whole point of the entrance.
          */
          <meshPhysicalMaterial
            color="#a8cbe8"
            roughness={0.04}
            metalness={0}
            transparent
            opacity={0.16}
            ior={1.5}
            depthWrite={false}
          />
        ) : (
          <meshStandardMaterial color="#3a424e" roughness={0.18} metalness={0.95} />
        )}
      </mesh>
      {/* Frame edge so the leaf reads as an object, not a floating pane */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width, 0.05, 0.1]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.25} metalness={0.95} />
      </mesh>
      <mesh position={[0, height - 0.025, 0]}>
        <boxGeometry args={[width, 0.05, 0.1]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.25} metalness={0.95} />
      </mesh>
      {/* Vertical frame edge on the leading side so the parting line is crisp */}
      <mesh position={[width / 2 - 0.025, height / 2, 0]}>
        <boxGeometry args={[0.05, height, 0.1]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.25} metalness={0.95} />
      </mesh>
      <mesh position={[-width / 2 + 0.025, height / 2, 0]}>
        <boxGeometry args={[0.05, height, 0.1]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.25} metalness={0.95} />
      </mesh>
    </group>
  )
})

interface DoorPairProps {
  halfWidth: number
  height: number
  z: number
  glass?: boolean
  leftRef: (g: Group | null) => void
  rightRef: (g: Group | null) => void
}

/**
 * Two leaves that part from the centre. Each leaf's x is written every frame
 * by the loop as `∓halfWidth * (1 - openness) / 2`, so at openness 0 they meet
 * in the middle and at 1 they are tucked into the reveal.
 */
export function DoorPair({
  halfWidth,
  height,
  z,
  glass = true,
  leftRef,
  rightRef,
}: DoorPairProps) {
  return (
    <group position={[0, 0, z]}>
      <group ref={leftRef}>
        <Leaf width={halfWidth} height={height} glass={glass} />
      </group>
      <group ref={rightRef}>
        <Leaf width={halfWidth} height={height} glass={glass} />
      </group>
      {/* Reveal / threshold */}
      <mesh position={[0, height + 0.09, 0]}>
        <boxGeometry args={[halfWidth * 2 + 0.6, 0.18, 0.3]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.4} metalness={0.85} />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[halfWidth * 2 + 0.6, 0.3]} />
        <meshStandardMaterial color={PALETTE.metal} roughness={0.5} metalness={0.8} />
      </mesh>
    </group>
  )
}
