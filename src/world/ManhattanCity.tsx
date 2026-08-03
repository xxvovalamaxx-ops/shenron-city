import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

let sharedLoader: GLTFLoader | null = null

function getGLTFLoader(): GLTFLoader {
  if (!sharedLoader) {
    const draco = new DRACOLoader()
    // Serve decoders locally — the external gstatic CDN often fails with
    // "Failed to fetch" in restricted networks or on slow connections.
    draco.setDecoderPath('/draco/')
    draco.preload()
    sharedLoader = new GLTFLoader()
    sharedLoader.setDRACOLoader(draco)
  }
  return sharedLoader
}

export function ManhattanCity({
  position = [0, 0, 0],
  scale = 1,
}: {
  mode?: 'full' | 'tiles'
  position?: [number, number, number]
  scale?: number
}) {
  const groupRef = useRef<THREE.Group>(null)

  // Load the single combined manhattan_world.glb asynchronously.
  // This runs outside React Suspense so it cannot block the loading screen.
  useEffect(() => {
    let active = true
    const loader = getGLTFLoader()

    const prepareMaterials = (root: THREE.Group) => {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const hasColor = !!obj.geometry.attributes.color
          obj.material = new THREE.MeshStandardMaterial({
            vertexColors: hasColor,
            color: hasColor ? 0xffffff : 0x8a8f96,
            roughness: 0.78,
            metalness: 0.08,
          })
          obj.castShadow = false
          obj.receiveShadow = true
        }
      })
    }

    loader.load(
      '/models/manhattan/manhattan_world.glb',
      (gltf) => {
        if (!active || !groupRef.current) return
        prepareMaterials(gltf.scene)
        groupRef.current.add(gltf.scene)
      },
      undefined,
      (err) => console.warn('[ManhattanCity] Failed to load manhattan_world.glb:', err),
    )

    const group = groupRef.current

    return () => {
      active = false
      if (group) {
        // Dispose all geometry/materials to avoid GPU leaks.
        group.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose()
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose())
            } else {
              obj.material.dispose()
            }
          }
        })
        group.clear()
      }
    }
  }, [])

  return <group ref={groupRef} position={position} scale={scale} name="manhattan-city" />
}
