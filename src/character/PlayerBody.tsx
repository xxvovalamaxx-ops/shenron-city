/**
 * The player's visible body — a procedural humanoid that sits inside the
 * capsule collision volume and follows the camera.
 *
 * The camera is at pos.y + EYE_HEIGHT (1.66 m). The body extends from
 * pos.y (feet) to pos.y + 1.78 (PLAYER_HEIGHT). Looking down reveals
 * the torso, arms, and legs — the standard first-person body convention.
 *
 * Walk animation is driven by horizontal velocity: limbs swing in phase,
 * torso tilts slightly forward. No external model or animation clips needed.
 *
 * Body proportions match PLAYER_HEIGHT = 1.78 m:
 *   Head top:     1.78 m
 *   Head center:  1.62 m  (radius 0.16)
 *   Eye level:    1.58 m
 *   Neck:         1.46 m
 *   Shoulders:    1.38 m
 *   Torso top:    1.38 m
 *   Torso bottom: 0.88 m  (torso height 0.50)
 *   Hips:         0.88 m
 *   Upper knee:   0.48 m
 *   Ankle:        0.08 m
 *   Feet:         0.00 m (ground)
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Mesh } from 'three'
import { rt } from '../gameplay/runtime'

const BODY_COLOR = '#3a4558'
const SKIN_COLOR = '#d4a574'
const SHOE_COLOR = '#1a2030'
const ACCENT_COLOR = '#2dd4bf'

const HEAD_RADIUS = 0.16
const TORSO_HEIGHT = 0.50
const UPPER_LEG = 0.40
const LOWER_LEG = 0.40
const FOOT_H = 0.06

const WALK_AMPLITUDE = 0.35
const ARM_SWING_SPEED = 8
const BOB_AMPLITUDE = 0.03
const LEAN_ANGLE = 0.06

/** Vertical landmarks from ground up. */
const HEAD_CENTER = 1.62
const EYE_Y = 1.58
const SHOULDER_Y = 1.38
const TORSO_TOP = SHOULDER_Y
const TORSO_BOT = TORSO_TOP - TORSO_HEIGHT // 0.88
const HIP_Y = TORSO_BOT

function limb(
  x: number, y: number, z: number,
  w: number, h: number, d: number,
  color: string,
  ref: React.RefObject<Mesh | null>,
) {
  return (
    <mesh ref={ref} position={[x, y, z]} castShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} roughness={0.7} />
    </mesh>
  )
}

export function PlayerBody() {
  const groupRef = useRef<Group>(null)
  const torsoRef = useRef<Group>(null)
  const leftArmRef = useRef<Group>(null)
  const rightArmRef = useRef<Group>(null)
  const leftLegRef = useRef<Group>(null)
  const rightLegRef = useRef<Group>(null)

  const walkPhase = useRef(0)
  const prevPos = useRef({ x: 0, y: 0, z: 0 })

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const group = groupRef.current
    if (!group) return

    const p = rt.player

    const dx = p.pos.x - prevPos.current.x
    const dz = p.pos.z - prevPos.current.z
    const hSpeed = Math.hypot(dx, dz) / Math.max(dt, 0.001)
    prevPos.current = { x: p.pos.x, y: p.pos.y, z: p.pos.z }

    group.position.set(p.pos.x, p.pos.y, p.pos.z)

    if (hSpeed > 0.05) {
      const targetAngle = Math.atan2(dx, dz)
      let currentAngle = group.rotation.y
      let diff = targetAngle - currentAngle
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      group.rotation.y += diff * Math.min(1, dt * 12)
    }

    const isMoving = hSpeed > 0.3
    const walkSpeed = Math.min(hSpeed / 7, 1)

    if (isMoving) {
      walkPhase.current += dt * ARM_SWING_SPEED * walkSpeed
    } else {
      walkPhase.current *= 0.9
    }

    const swing = Math.sin(walkPhase.current)
    const bob = isMoving ? Math.abs(Math.sin(walkPhase.current * 2)) * BOB_AMPLITUDE * walkSpeed : 0

    if (torsoRef.current) {
      torsoRef.current.position.y = HIP_Y + TORSO_HEIGHT / 2 + bob
      torsoRef.current.rotation.x = isMoving ? -LEAN_ANGLE * walkSpeed : 0
    }

    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = isMoving ? swing * WALK_AMPLITUDE * walkSpeed : 0
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = isMoving ? -swing * WALK_AMPLITUDE * walkSpeed : 0
    }
    if (leftLegRef.current) {
      leftLegRef.current.rotation.x = isMoving ? -swing * WALK_AMPLITUDE * 0.8 * walkSpeed : 0
    }
    if (rightLegRef.current) {
      rightLegRef.current.rotation.x = isMoving ? swing * WALK_AMPLITUDE * 0.8 * walkSpeed : 0
    }
  })

  const torsoMid = HIP_Y + TORSO_HEIGHT / 2
  const shoulderY = TORSO_TOP - 0.04
  const upperArmLen = 0.34
  const lowerArmLen = 0.30
  const armMid = (upperArmLen + lowerArmLen) / 2

  return (
    <group ref={groupRef}>
      {/* Shadow disc */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.35, 16]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.25} depthWrite={false} />
      </mesh>

      {/* Head */}
      <mesh position={[0, HEAD_CENTER, 0]} castShadow>
        <sphereGeometry args={[HEAD_RADIUS, 12, 10]} />
        <meshStandardMaterial color={SKIN_COLOR} roughness={0.65} />
      </mesh>

      {/* Visor / eye strip — emissive so it's always visible */}
      <mesh position={[0, EYE_Y, HEAD_RADIUS * 0.85]}>
        <boxGeometry args={[HEAD_RADIUS * 1.4, HEAD_RADIUS * 0.35, 0.03]} />
        <meshStandardMaterial
          color={ACCENT_COLOR}
          emissive={ACCENT_COLOR}
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>

      {/* Torso */}
      <group ref={torsoRef} position={[0, torsoMid, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.36, TORSO_HEIGHT, 0.22]} />
          <meshStandardMaterial color={BODY_COLOR} roughness={0.55} metalness={0.2} />
        </mesh>
        {/* Accent strip — emissive */}
        <mesh position={[0, 0, 0.111]}>
          <boxGeometry args={[0.04, TORSO_HEIGHT * 0.6, 0.01]} />
          <meshStandardMaterial
            color={ACCENT_COLOR}
            emissive={ACCENT_COLOR}
            emissiveIntensity={1.5}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Left arm — upper + lower as a single swing group */}
      <group ref={leftArmRef} position={[-0.24, shoulderY, 0]}>
        {limb(0, -armMid, 0, 0.08, upperArmLen + lowerArmLen, 0.08, BODY_COLOR, { current: null })}
      </group>

      {/* Right arm */}
      <group ref={rightArmRef} position={[0.24, shoulderY, 0]}>
        {limb(0, -armMid, 0, 0.08, upperArmLen + lowerArmLen, 0.08, BODY_COLOR, { current: null })}
      </group>

      {/* Left leg — upper */}
      <group ref={leftLegRef} position={[-0.1, HIP_Y, 0]}>
        {limb(0, -UPPER_LEG / 2, 0, 0.1, UPPER_LEG, 0.1, '#2a3548', { current: null })}
        {/* Lower leg */}
        <mesh position={[0, -UPPER_LEG - LOWER_LEG / 2, 0]}>
          <boxGeometry args={[0.09, LOWER_LEG, 0.09]} />
          <meshStandardMaterial color="#2a3548" roughness={0.6} metalness={0.15} />
        </mesh>
        {/* Foot */}
        <mesh position={[0, -UPPER_LEG - LOWER_LEG - FOOT_H / 2, 0.02]} castShadow>
          <boxGeometry args={[0.1, FOOT_H, 0.16]} />
          <meshStandardMaterial color={SHOE_COLOR} roughness={0.8} />
        </mesh>
      </group>

      {/* Right leg — upper */}
      <group ref={rightLegRef} position={[0.1, HIP_Y, 0]}>
        {limb(0, -UPPER_LEG / 2, 0, 0.1, UPPER_LEG, 0.1, '#2a3548', { current: null })}
        {/* Lower leg */}
        <mesh position={[0, -UPPER_LEG - LOWER_LEG / 2, 0]}>
          <boxGeometry args={[0.09, LOWER_LEG, 0.09]} />
          <meshStandardMaterial color="#2a3548" roughness={0.6} metalness={0.15} />
        </mesh>
        {/* Foot */}
        <mesh position={[0, -UPPER_LEG - LOWER_LEG - FOOT_H / 2, 0.02]} castShadow>
          <boxGeometry args={[0.1, FOOT_H, 0.16]} />
          <meshStandardMaterial color={SHOE_COLOR} roughness={0.8} />
        </mesh>
      </group>
    </group>
  )
}
