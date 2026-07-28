/**
 * Atmospheric dust — floating particles caught by the light.
 *
 * A sparse cloud of slow-moving dots that add depth and air to the scene.
 * Rendered as a single Points draw call with a generated circular sprite.
 * Positions are relative to the player and drift slowly with time.
 */
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const PARTICLE_COUNT = 260
const SPREAD = 60
const DRIFT_SPEED = 0.08
const TURBULENCE = 0.12
const POINT_SIZE = 0.12

/**
 * Generates a soft circular sprite texture via canvas.
 */
function makeDustSprite(): THREE.CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const half = size / 2
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half)
  gradient.addColorStop(0, 'rgba(200, 210, 225, 0.35)')
  gradient.addColorStop(0.4, 'rgba(200, 210, 225, 0.12)')
  gradient.addColorStop(1, 'rgba(200, 210, 225, 0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

export function AtmosphericDust() {
  const ref = useRef<THREE.Points>(null)
  const sprite = useMemo(makeDustSprite, [])

  const [positions, seeds] = useMemo(() => {
    const pos = new Float32Array(PARTICLE_COUNT * 3)
    const s = new Float32Array(PARTICLE_COUNT)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * SPREAD
      pos[i * 3 + 1] = Math.random() * 8
      pos[i * 3 + 2] = (Math.random() - 0.5) * SPREAD
      s[i] = Math.random() * Math.PI * 2
    }
    return [pos, s] as const
  }, [])

  useFrame(({ camera, clock }) => {
    const pts = ref.current
    if (!pts) return
    const geo = pts.geometry
    const posAttr = geo.attributes.position as THREE.BufferAttribute
    const t = clock.elapsedTime
    const cx = camera.position.x
    const cz = camera.position.z

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3
      const seed = seeds[i]
      const baseX = posAttr.array[i3]
      const baseZ = posAttr.array[i3 + 2]

      // Drift relative to camera so the cloud follows the player
      posAttr.array[i3] = cx + (baseX - cx) + Math.sin(t * DRIFT_SPEED + seed) * TURBULENCE
      posAttr.array[i3 + 1] += Math.sin(t * 0.3 + seed * 2) * 0.002
      posAttr.array[i3 + 2] = cz + (baseZ - cz) + Math.cos(t * DRIFT_SPEED * 0.7 + seed) * TURBULENCE

      // Wrap particles that drift too far from camera
      const dx = posAttr.array[i3] - cx
      const dz = posAttr.array[i3 + 2] - cz
      if (Math.abs(dx) > SPREAD / 2) posAttr.array[i3] = cx - dx * 0.5
      if (Math.abs(dz) > SPREAD / 2) posAttr.array[i3 + 2] = cz - dz * 0.5
    }
    posAttr.needsUpdate = true
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        map={sprite}
        size={POINT_SIZE}
        transparent
        opacity={0.4}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  )
}
