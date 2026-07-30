/**
 * Adult-proportioned, consistently rigged pedestrians on deterministic routes.
 *
 * The former Kenney/chibi crowd is intentionally not used in production.
 * Geometry, skeleton, and textures are shared; tint, stature, motion, phase,
 * and route timing provide stable variation without synchronized clones.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { ambientPedestrianPose, ambientPedestrianSpeed } from './ambient-routes'
import { DEFAULT_CHARACTER_HEIGHT } from './character-scale'
import { locomotionTimeScale } from './locomotion'
import { QuaterniusHero } from './QuaterniusHero'
import type { QuaterniusHeroMotion } from './quaternius-hero'
import { rt } from '../gameplay/runtime'
import { outdoorSimulationActive } from '../gameplay/zone'

const WALK_MOTIONS: QuaterniusHeroMotion[] = [
  'Walk_Loop',
  'Walk_Formal_Loop',
  'Walk_Carry_Loop',
]

function Pedestrian({ index }: { index: number }) {
  const root = useRef<Group>(null)

  useFrame(() => {
    if (rt.paused || !outdoorSimulationActive(rt.zone)) return
    const sample = ambientPedestrianPose(index, rt.clock.elapsed)
    const group = root.current
    if (!group) return
    group.position.set(sample.x, 0, sample.z)
    group.rotation.y = sample.heading
  })

  const heightVariation = 0.94 + (index % 7) * 0.018
  const widthVariation = 0.92 + ((index * 5) % 7) * 0.02
  const height = DEFAULT_CHARACTER_HEIGHT * heightVariation
  const animationSpeed = locomotionTimeScale(ambientPedestrianSpeed(index), height)

  return (
    <group ref={root} scale={[widthVariation, 1, 1]}>
      <QuaterniusHero
        motion={WALK_MOTIONS[index % WALK_MOTIONS.length]}
        height={height}
        appearance={index}
        phase={((index * 0.173) % 1 + 1) % 1}
        animationSpeed={animationSpeed}
        castShadow={index < 10}
        scope="outdoor"
      />
    </group>
  )
}

export function AmbientCrowd({ count }: { count: number }) {
  return (
    <group name="production-pedestrian-crowd">
      {Array.from({ length: count }, (_, index) => (
        <Pedestrian key={index} index={index} />
      ))}
    </group>
  )
}
