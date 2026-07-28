import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

interface Props {
  url: string
  dimensions: readonly [width: number, height: number, depth: number]
  position?: readonly [x: number, y: number, z: number]
  rotationY?: number
  shadows?: boolean
}

/**
 * A shared-geometry clone normalized to authored world bounds.
 *
 * Imported packs disagree on units, origin, and model dimensions. Measuring
 * the actual scene makes the visible shell agree with the existing collision
 * data instead of relying on hand-tuned magic scales.
 */
export function StaticCityModel({
  url,
  dimensions,
  position = [0, 0, 0],
  rotationY = 0,
  shadows = true,
}: Props) {
  const source = useGLTF(url)
  const { model, offset, scale } = useMemo(() => {
    const instance = source.scene.clone(true)
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = shadows
      object.receiveShadow = shadows
      object.frustumCulled = true
    })

    const bounds = new THREE.Box3().setFromObject(instance)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const safe = (value: number) => Math.max(value, 0.0001)

    return {
      model: instance,
      offset: new THREE.Vector3(-center.x, -bounds.min.y, -center.z),
      scale: new THREE.Vector3(
        dimensions[0] / safe(size.x),
        dimensions[1] / safe(size.y),
        dimensions[2] / safe(size.z),
      ),
    }
  }, [dimensions, shadows, source.scene])

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <primitive object={model} position={offset} />
    </group>
  )
}

for (const url of [
  '/models/city/buildings/building-g.glb',
  '/models/city/buildings/building-j.glb',
  '/models/city/buildings/building-k.glb',
  '/models/city/buildings/building-l.glb',
  '/models/city/buildings/building-skyscraper-c.glb',
  '/models/city/nature/tree_detailed.glb',
  '/models/city/nature/tree_oak.glb',
  '/models/city/nature/tree_thin.glb',
  '/models/city/nature/plant_bushDetailed.glb',
  '/models/city/nature/rock_largeB.glb',
  '/models/city/vehicles/race-future.glb',
  '/models/city/vehicles/sedan.glb',
  '/models/city/vehicles/taxi.glb',
  '/models/city/vehicles/van.glb',
]) {
  useGLTF.preload(url)
}
