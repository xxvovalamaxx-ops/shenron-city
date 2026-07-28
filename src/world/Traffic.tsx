/**
 * Boulevard traffic using audited CC0 vehicle shells.
 *
 * This component owns appearance only. Every vehicle root is written by the
 * simulation in GameLoop, because the colliders are derived from the same poses
 * and the two must not disagree by a frame.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { VEHICLE } from './city-data'
import { rt, setTrafficCount } from '../gameplay/runtime'
import type { QualitySettings } from './palette'
import { StaticCityModel } from './StaticCityModel'
import { vehicleAssetFor } from './city-assets'

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

function VehicleShell({
  index,
  shadows,
  roots,
}: {
  index: number
  shadows: boolean
  roots: Array<THREE.Object3D | null>
}) {
  const bindRoot = useCallback(
    (root: THREE.Group | null) => {
      roots[index] = root
    },
    [index, roots],
  )

  return (
    <group ref={bindRoot}>
      <StaticCityModel
        url={vehicleAssetFor(index)}
        dimensions={[VEHICLE.width, VEHICLE.height, VEHICLE.length]}
        shadows={shadows}
      />
    </group>
  )
}

export function Traffic({ quality }: { quality: QualitySettings }) {
  const lamps = useRef<THREE.InstancedMesh>(null)
  const spill = useRef<THREE.InstancedMesh>(null)
  const spillTexture = useSpillTexture()
  const count = quality.vehicles
  const modelRoots = useMemo<Array<THREE.Object3D | null>>(
    () => Array.from({ length: count }, () => null),
    [count],
  )

  // Build the fleet before the first frame, so GameLoop never writes into
  // instance buffers sized for a fleet that no longer exists.
  useLayoutEffect(() => {
    setTrafficCount(count)
  }, [count])

  useLayoutEffect(() => {
    rt.refs.trafficModels = modelRoots
    rt.refs.trafficLamps = lamps.current
    rt.refs.trafficSpill = spill.current
    return () => {
      rt.refs.trafficModels = []
      rt.refs.trafficLamps = null
      rt.refs.trafficSpill = null
    }
  }, [modelRoots])

  useEffect(() => () => spillTexture.dispose(), [spillTexture])

  useEffect(() => {
    const lampMesh = lamps.current
    if (!lampMesh) return

    const colour = new THREE.Color()
    rt.vehicles.forEach((_, i) => {
      lampMesh.setColorAt(i * 2, colour.set(HEADLIGHT))
      lampMesh.setColorAt(i * 2 + 1, colour.set(TAILLIGHT))
    })
    if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true
  }, [count])

  if (count <= 0) return null

  return (
    <group>
      {Array.from({ length: count }, (_, index) => (
        <VehicleShell
          key={index}
          index={index}
          shadows={quality.shadows}
          roots={modelRoots}
        />
      ))}

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
