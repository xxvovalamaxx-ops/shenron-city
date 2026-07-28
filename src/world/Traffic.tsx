/**
 * Boulevard traffic, instanced.
 *
 * Three draw calls for the whole fleet regardless of size: bodies, cabins, and
 * lamp bars. This component owns appearance only — every matrix is written by
 * the simulation in GameLoop, because the colliders are derived from the same
 * poses and the two must not disagree by a frame.
 *
 * Colours are applied once per fleet rather than per frame. A car that changes
 * paint while you watch it is worse than no traffic at all.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { VEHICLE } from './city-data'
import { rt, setTrafficCount } from '../gameplay/runtime'
import type { QualitySettings } from './palette'

/**
 * Night-city paintwork: dark and desaturated so headlights and shopfronts stay
 * the brightest things on the street. Bright cars would out-read the signage.
 */
const PAINT = ['#3f5068', '#5a6172', '#6d5f56', '#40655e', '#5b4f66', '#736450'] as const

const HEADLIGHT = '#fff0cf'
const TAILLIGHT = '#ff2e2e'

/**
 * Soft light pool for headlight spill, drawn to a canvas.
 *
 * Sixteen spotlights would sell it properly and would also cost more than the
 * rest of the district put together. An additive blob on the tarmac reads the
 * same from a pedestrian's eye height, which is the only place anyone stands.
 *
 * Deliberately symmetrical: nothing about it depends on getting the yaw right,
 * so it cannot end up pointing out of the back of the car.
 */
function useSpillTexture(): THREE.CanvasTexture {
  return useMemo(() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context is unavailable')

    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    gradient.addColorStop(0, 'rgba(255, 236, 198, 0.62)')
    gradient.addColorStop(0.45, 'rgba(255, 226, 176, 0.20)')
    gradient.addColorStop(1, 'rgba(255, 220, 170, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [])
}

export function Traffic({ quality }: { quality: QualitySettings }) {
  const body = useRef<THREE.InstancedMesh>(null)
  const cabin = useRef<THREE.InstancedMesh>(null)
  const lamps = useRef<THREE.InstancedMesh>(null)
  const spill = useRef<THREE.InstancedMesh>(null)
  const spillTexture = useSpillTexture()
  const count = quality.vehicles

  // Build the fleet before the first frame, so GameLoop never writes into
  // instance buffers sized for a fleet that no longer exists.
  useLayoutEffect(() => {
    setTrafficCount(count)
  }, [count])

  useLayoutEffect(() => {
    rt.refs.trafficBody = body.current
    rt.refs.trafficCabin = cabin.current
    rt.refs.trafficLamps = lamps.current
    rt.refs.trafficSpill = spill.current
    return () => {
      rt.refs.trafficBody = null
      rt.refs.trafficCabin = null
      rt.refs.trafficLamps = null
      rt.refs.trafficSpill = null
    }
  }, [count])

  useEffect(() => () => spillTexture.dispose(), [spillTexture])

  useEffect(() => {
    const bodyMesh = body.current
    const lampMesh = lamps.current
    if (!bodyMesh || !lampMesh) return

    const colour = new THREE.Color()
    rt.vehicles.forEach((vehicle, i) => {
      bodyMesh.setColorAt(i, colour.set(PAINT[vehicle.tint % PAINT.length]))
      lampMesh.setColorAt(i * 2, colour.set(HEADLIGHT))
      lampMesh.setColorAt(i * 2 + 1, colour.set(TAILLIGHT))
    })
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true
    if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true
  }, [count])

  if (count <= 0) return null

  return (
    <group>
      <instancedMesh
        ref={body}
        args={[undefined, undefined, count]}
        castShadow={quality.shadows}
        receiveShadow={quality.shadows}
        // The fleet is always somewhere on the boulevard; culling per-instance
        // bounds that the simulation rewrites every frame costs more than it saves.
        frustumCulled={false}
      >
        <boxGeometry args={[VEHICLE.width, VEHICLE.height * 0.62, VEHICLE.length]} />
        {/*
          Car paint is a dielectric with a clearcoat, not a metal. At metalness
          0.55 with no environment map to reflect, these rendered as black
          cut-outs on a night street — a metal surface with nothing to mirror
          has almost no diffuse response left.
        */}
        <meshStandardMaterial roughness={0.42} metalness={0.12} />
      </instancedMesh>

      <instancedMesh
        ref={cabin}
        args={[undefined, undefined, count]}
        castShadow={quality.shadows}
        frustumCulled={false}
      >
        <boxGeometry
          args={[VEHICLE.width * 0.88, VEHICLE.height * 0.44, VEHICLE.length * 0.52]}
        />
        <meshStandardMaterial color="#0b1017" roughness={0.12} metalness={0.1} />
      </instancedMesh>

      <instancedMesh ref={lamps} args={[undefined, undefined, count * 2]} frustumCulled={false}>
        <boxGeometry args={[VEHICLE.width * 0.78, 0.19, 0.09]} />
        {/* Unlit so the lamps stay bright at night and feed the bloom pass. */}
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <instancedMesh ref={spill} args={[undefined, undefined, count]} frustumCulled={false}>
        <planeGeometry args={[4.6, 9.5]} />
        <meshBasicMaterial
          map={spillTexture}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  )
}
