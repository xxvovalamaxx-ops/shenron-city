/**
 * Reusable GLB/GLTF model loader.
 *
 * Usage:
 *   <GLBModel src="/models/tree.glb" position={[0, 0, 5]} scale={2} />
 *
 * Models should be placed in public/models/ for direct URL access.
 * Use glTF-Transform CLI to optimize before placing:
 *   npx gltf-transform optimize input.glb output.glb --compress draco
 */
import { useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Group } from 'three'

interface GLBModelProps {
  src: string
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  castShadow?: boolean
  receiveShadow?: boolean
}

export function GLBModel({
  src,
  position = [0, 0, 0],
  rotation,
  scale = 1,
  castShadow = true,
  receiveShadow = true,
}: GLBModelProps) {
  const ref = useRef<Group>(null)
  const { scene } = useGLTF(src)

  return (
    <group ref={ref} position={position} rotation={rotation} scale={scale}>
      <primitive
        object={scene.clone()}
        onAfterRender={() => {
          if (!ref.current) return
          ref.current.traverse((child) => {
            if ('isMesh' in child) {
              child.castShadow = castShadow
              child.receiveShadow = receiveShadow
            }
          })
        }}
      />
    </group>
  )
}

/**
 * Preload a GLB model to avoid runtime pop-in.
 * Call once at module level: preloadGLB('/models/tree.glb')
 */
export function preloadGLB(src: string) {
  useGLTF.preload(src)
}
