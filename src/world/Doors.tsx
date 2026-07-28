/**
 * Sliding doors whose transforms remain owned by the deterministic game loop.
 * Visible leaves come from the Blender-authored production asset; collision
 * continues to use the tested invisible swept boxes in gameplay/layout.
 */
import { forwardRef, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Group } from 'three'
import { PRODUCTION_ASSETS } from './ProductionScene'

interface LeafProps {
  width: number
  height: number
  glass?: boolean
}

const Leaf = forwardRef<Group, LeafProps>(function Leaf(
  { width, height, glass = true },
  ref,
) {
  const source = useGLTF(PRODUCTION_ASSETS.automaticDoor)
  const model = useMemo(() => {
    const instance = source.scene.clone(true)
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
      if (!glass && object.material.name.includes('Glass')) {
        object.material = new THREE.MeshStandardMaterial({
          name: 'MAT_ElevatorDoor',
          color: '#303740',
          roughness: 0.24,
          metalness: 0.9,
        })
      }
    })
    return instance
  }, [glass, source.scene])

  return (
    <group ref={ref}>
      <primitive
        object={model}
        scale={[width / 3.35, height / 4.1, 1]}
        dispose={null}
      />
    </group>
  )
})

interface DoorPairProps {
  halfWidth: number
  height: number
  z: number
  glass?: boolean
  leftRef: (group: Group | null) => void
  rightRef: (group: Group | null) => void
}

export function DoorPair({
  halfWidth,
  height,
  z,
  glass = true,
  leftRef,
  rightRef,
}: DoorPairProps) {
  return (
    <group position={[0, 0, z]} name="automatic-door-pair">
      <group ref={leftRef}>
        <Leaf width={halfWidth} height={height} glass={glass} />
      </group>
      <group ref={rightRef}>
        <Leaf width={halfWidth} height={height} glass={glass} />
      </group>
    </group>
  )
}
