/**
 * A small articulated citizen rig built from inexpensive primitives.
 *
 * Named residents use this instead of the old capsule-and-sphere placeholder.
 * Separate limbs, a face plane, hair, and role accents make the silhouette
 * read as a person while keeping the standalone build asset-free.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'

export interface CitizenStyle {
  skin: string
  hair: string
  jacket: string
  trousers: string
  shoes: string
  accent: string
}

export type CitizenRole = 'vendor' | 'security'

export function CitizenCharacter({
  style,
  role,
  facing = 0,
  phase = 0,
}: {
  style: CitizenStyle
  role: CitizenRole
  facing?: number
  phase?: number
}) {
  const root = useRef<Group>(null)
  const head = useRef<Group>(null)
  const leftArm = useRef<Group>(null)
  const rightArm = useRef<Group>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime + phase
    const scan = role === 'security' ? Math.sin(t * 0.32) * 0.24 : Math.sin(t * 0.55) * 0.08
    const gesture = role === 'vendor' ? Math.max(0, Math.sin(t * 0.72)) : Math.sin(t * 0.46) * 0.12

    if (root.current) {
      root.current.position.y = Math.sin(t * 1.05) * 0.014
      root.current.rotation.y = facing + scan
    }
    if (head.current) {
      head.current.rotation.y = -scan * 0.42
      head.current.rotation.z = Math.sin(t * 0.41) * 0.018
    }
    if (leftArm.current) leftArm.current.rotation.x = -0.08 - gesture * 0.22
    if (rightArm.current) rightArm.current.rotation.x = 0.08 + gesture * 0.48
  })

  return (
    <group ref={root}>
      {/* Pelvis and torso: a tapered jacket breaks the old pill silhouette. */}
      <mesh position={[0, 0.88, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.28, 6, 12]} />
        <meshStandardMaterial color={style.trousers} roughness={0.78} />
      </mesh>
      <mesh position={[0, 1.24, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.46, 8, 16]} />
        <meshStandardMaterial color={style.jacket} roughness={0.68} />
      </mesh>
      <mesh position={[0, 1.31, 0.285]}>
        <boxGeometry args={[0.34, 0.48, 0.035]} />
        <meshStandardMaterial
          color={style.accent}
          emissive={role === 'security' ? style.accent : '#000000'}
          emissiveIntensity={role === 'security' ? 0.28 : 0}
          roughness={0.62}
        />
      </mesh>

      {/* Legs have independent silhouettes and planted shoes. */}
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * 0.15, 0.73, 0]}>
          <mesh position={[0, -0.3, 0]} castShadow>
            <capsuleGeometry args={[0.095, 0.46, 6, 10]} />
            <meshStandardMaterial color={style.trousers} roughness={0.82} />
          </mesh>
          <mesh position={[0, -0.63, 0.075]} castShadow>
            <boxGeometry args={[0.2, 0.13, 0.34]} />
            <meshStandardMaterial color={style.shoes} roughness={0.72} />
          </mesh>
        </group>
      ))}

      {/* Arms pivot at the shoulder so the idle gesture feels jointed. */}
      {([-1, 1] as const).map((side) => (
        <group
          key={side}
          ref={side < 0 ? leftArm : rightArm}
          position={[side * 0.37, 1.43, 0]}
          rotation={[0, 0, side * -0.08]}
        >
          <mesh position={[0, -0.27, 0]} castShadow>
            <capsuleGeometry args={[0.085, 0.42, 6, 10]} />
            <meshStandardMaterial color={style.jacket} roughness={0.7} />
          </mesh>
          <mesh position={[0, -0.56, 0]} castShadow>
            <sphereGeometry args={[0.105, 12, 9]} />
            <meshStandardMaterial color={style.skin} roughness={0.76} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, 1.58, 0]} castShadow>
        <cylinderGeometry args={[0.105, 0.12, 0.18, 12]} />
        <meshStandardMaterial color={style.skin} roughness={0.76} />
      </mesh>

      <group ref={head} position={[0, 1.82, 0]}>
        <mesh castShadow scale={[0.92, 1.04, 0.9]}>
          <sphereGeometry args={[0.23, 18, 14]} />
          <meshStandardMaterial color={style.skin} roughness={0.74} />
        </mesh>
        {/* Hair cap and fringe keep the head from reading as a ball. */}
        <mesh position={[0, 0.1, -0.01]} scale={[1.02, 0.55, 1.01]}>
          <sphereGeometry args={[0.235, 16, 10]} />
          <meshStandardMaterial color={style.hair} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.095, 0.21]}>
          <boxGeometry args={[0.25, 0.055, 0.035]} />
          <meshStandardMaterial color={style.hair} roughness={0.9} />
        </mesh>
        {([-1, 1] as const).map((side) => (
          <mesh key={side} position={[side * 0.075, 0.005, 0.214]}>
            <sphereGeometry args={[0.022, 8, 6]} />
            <meshBasicMaterial color="#111827" />
          </mesh>
        ))}
        <mesh position={[0, -0.055, 0.219]} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.025, 0.06, 8]} />
          <meshStandardMaterial color={style.skin} roughness={0.78} />
        </mesh>

        {role === 'security' ? (
          <group position={[0, 0.19, 0]}>
            <mesh>
              <cylinderGeometry args={[0.25, 0.23, 0.09, 18]} />
              <meshStandardMaterial color="#111923" roughness={0.82} />
            </mesh>
            <mesh position={[0, -0.015, 0.2]}>
              <boxGeometry args={[0.34, 0.035, 0.16]} />
              <meshStandardMaterial color="#111923" roughness={0.82} />
            </mesh>
          </group>
        ) : (
          <mesh position={[0, 0.18, 0]}>
            <cylinderGeometry args={[0.25, 0.2, 0.2, 18]} />
            <meshStandardMaterial color={style.hair} roughness={0.88} />
          </mesh>
        )}
      </group>
    </group>
  )
}
