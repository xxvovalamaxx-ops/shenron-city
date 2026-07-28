/**
 * Audited rigged pedestrians following the deterministic authored city loops.
 *
 * Rendering and collision still sample the same route function. Each visible
 * character owns an animation mixer, while geometry and textures remain
 * shared by the single 454 KB CC0 GLB.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { ambientPedestrianPose } from './ambient-routes'
import { ServiceAndroid } from './ServiceAndroid'
import type { ServiceAndroidStyle } from './service-android'

const STYLES: ServiceAndroidStyle[] = [
  'civilianBlue',
  'civilianCopper',
  'civilianGreen',
  'civilianPlum',
  'civilianSand',
  'civilianSlate',
]

function Pedestrian({ index }: { index: number }) {
  const root = useRef<Group>(null)

  useFrame((state) => {
    const sample = ambientPedestrianPose(index, state.clock.elapsedTime)
    const group = root.current
    if (!group) return
    group.position.set(sample.x, 0, sample.z)
    group.rotation.y = sample.heading
  })

  const heightScale = 0.57 + (index % 5) * 0.012
  const widthScale = 0.94 + ((index * 3) % 5) * 0.025

  return (
    <group ref={root} scale={[heightScale * widthScale, heightScale, heightScale]}>
      <ServiceAndroid
        motion="Walking"
        style={STYLES[index % STYLES.length]}
        animationSpeed={0.84 + (index % 4) * 0.06}
        castShadow={index < 10}
      />
    </group>
  )
}

export function AmbientCrowd({ count }: { count: number }) {
  return (
    <group>
      {Array.from({ length: count }, (_, index) => (
        <Pedestrian key={index} index={index} />
      ))}
    </group>
  )
}
