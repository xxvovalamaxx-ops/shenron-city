import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { gradeToNight } from './night-grade'

interface Props {
  url: string
  dimensions: readonly [width: number, height: number, depth: number]
  position?: readonly [x: number, y: number, z: number]
  rotationY?: number
  shadows?: boolean
  /**
   * Grade the model's albedo for night. Off for anything already authored
   * dark, or anything whose colour carries meaning (signage, vehicles).
   */
  nightGrade?: boolean
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
  nightGrade = false,
}: Props) {
  const source = useGLTF(url)
  const { model, offset, scale, graded } = useMemo(() => {
    const instance = source.scene.clone(true)
    // clone(true) shares materials with the cached GLTF, so grading in place
    // would mutate drei's cache for every other user of this asset. Clone the
    // materials we grade, and only those.
    const owned = new Set<THREE.Material>()

    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = shadows
      object.receiveShadow = shadows
      object.frustumCulled = true
      if (!nightGrade) return

      const originals = Array.isArray(object.material) ? object.material : [object.material]
      const replacements = originals.map((original) => {
        const material = original.clone()
        owned.add(material)
        if ('color' in material && material.color instanceof THREE.Color) {
          const { r, g, b } = gradeToNight(material.color)
          material.color.setRGB(r, g, b)
          material.needsUpdate = true
        }
        return material
      })
      object.material = Array.isArray(object.material) ? replacements : replacements[0]
    })

    const bounds = new THREE.Box3().setFromObject(instance)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const safe = (value: number) => Math.max(value, 0.0001)

    return {
      model: instance,
      graded: [...owned],
      offset: new THREE.Vector3(-center.x, -bounds.min.y, -center.z),
      scale: new THREE.Vector3(
        dimensions[0] / safe(size.x),
        dimensions[1] / safe(size.y),
        dimensions[2] / safe(size.z),
      ),
    }
  }, [dimensions, shadows, nightGrade, source.scene])

  // Materials cloned here are ours to free.
  useEffect(() => () => { for (const m of graded) m.dispose() }, [graded])

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
  '/assets/production/vehicles/premium-sedan.glb',
  '/assets/production/vehicles/suv-crossover.glb',
  '/assets/production/vehicles/compact-city.glb',
  '/assets/production/vehicles/delivery-van.glb',
]) {
  useGLTF.preload(url)
}
