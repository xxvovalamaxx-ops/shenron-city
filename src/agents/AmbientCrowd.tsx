/**
 * Audited rigged pedestrians following the deterministic authored city loops.
 *
 * Rendering and collision still sample the same route function. Each visible
 * character owns an animation mixer, while geometry and textures remain
 * shared by the single 233 KB CC0 GLB.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { ambientPedestrianPose, ambientPedestrianSpeed } from './ambient-routes'
import { KenneyCitizen } from './KenneyCitizen'
import { DEFAULT_CHARACTER_HEIGHT } from './character-scale'
import { locomotionTimeScale } from './locomotion'
import type { KenneyCitizenSkin } from './kenney-citizen'

const SKINS: KenneyCitizenSkin[] = [
  'criminalMale',
  'cyborgFemale',
  'humanFemale',
  'humanMale',
  'skaterFemale',
  'skaterMale',
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

  // Build variation around a real height, now that KenneyCitizen normalises to
  // metres. These used to be the only scale applied, on a 3.76 m model.
  const heightVariation = 0.94 + (index % 5) * 0.025
  const widthVariation = 0.94 + ((index * 3) % 5) * 0.025
  const height = DEFAULT_CHARACTER_HEIGHT * heightVariation

  // Derived from the speed that actually moves this pedestrian, so the planted
  // foot stays put. A hardcoded rate slid by up to 40%.
  const animationSpeed = locomotionTimeScale(ambientPedestrianSpeed(index), height)

  return (
    <group ref={root} scale={[widthVariation, 1, 1]}>
      <KenneyCitizen
        motion="Run"
        skin={SKINS[index % SKINS.length]}
        height={height}
        animationSpeed={animationSpeed}
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
