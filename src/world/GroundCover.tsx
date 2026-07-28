import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  generateGroundCover,
  type GroundCoverInstance,
  type GroundCoverKind,
} from './scatter-data'

const MAX_GROUND_COVER = 1_600
const ALL_GROUND_COVER = generateGroundCover(MAX_GROUND_COVER)

interface LayerStyle {
  width: number
  height: number
  crosses: number
  color: string
  alternate: string
  roughness: number
  wind: number
}

const LAYER_STYLE: Record<GroundCoverKind, LayerStyle> = {
  'short-grass': {
    width: 0.13,
    height: 0.34,
    crosses: 2,
    color: '#365c35',
    alternate: '#6a7d3c',
    roughness: 0.96,
    wind: 0.055,
  },
  'tall-grass': {
    width: 0.17,
    height: 0.58,
    crosses: 2,
    color: '#314c2d',
    alternate: '#7b7134',
    roughness: 0.94,
    wind: 0.085,
  },
  fern: {
    width: 0.4,
    height: 0.52,
    crosses: 3,
    color: '#214c31',
    alternate: '#47744b',
    roughness: 0.91,
    wind: 0.052,
  },
  flower: {
    width: 0.11,
    height: 0.5,
    crosses: 2,
    color: '#d6b24b',
    alternate: '#d989a7',
    roughness: 0.82,
    wind: 0.075,
  },
}

function crossedBladeGeometry(style: LayerStyle): THREE.BufferGeometry {
  const vertices: number[] = []
  const indices: number[] = []
  const uvs: number[] = []

  for (let cross = 0; cross < style.crosses; cross += 1) {
    const angle = (cross / style.crosses) * Math.PI
    const dx = Math.cos(angle) * style.width * 0.5
    const dz = Math.sin(angle) * style.width * 0.5
    const tipDx = dx * 0.16
    const tipDz = dz * 0.16
    const offset = vertices.length / 3

    vertices.push(
      -dx,
      0,
      -dz,
      dx,
      0,
      dz,
      tipDx,
      style.height,
      tipDz,
      -tipDx,
      style.height,
      -tipDz,
    )
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function GroundCoverLayer({
  kind,
  instances,
}: {
  kind: GroundCoverKind
  instances: readonly GroundCoverInstance[]
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const style = LAYER_STYLE[kind]
  const windUniforms = useRef({
    uFoliageTime: { value: 0 },
    uFoliageWind: { value: style.wind },
    uFoliageHeight: { value: style.height },
  })
  const geometry = useMemo(() => crossedBladeGeometry(style), [style])
  const material = useMemo(() => {
    const result = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: style.roughness,
      metalness: 0,
      side: THREE.DoubleSide,
      vertexColors: true,
    })
    result.onBeforeCompile = (shader) => {
      shader.uniforms.uFoliageTime = windUniforms.current.uFoliageTime
      shader.uniforms.uFoliageWind = windUniforms.current.uFoliageWind
      shader.uniforms.uFoliageHeight = windUniforms.current.uFoliageHeight
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uFoliageTime;
uniform float uFoliageWind;
uniform float uFoliageHeight;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  float foliageRatio = clamp(position.y / max(uFoliageHeight, 0.001), 0.0, 1.0);
  float foliagePhase = instanceMatrix[3].x * 0.41 + instanceMatrix[3].z * 0.29;
  float foliageBend = foliageRatio * foliageRatio;
  transformed.x += sin(uFoliageTime * 0.92 + foliagePhase) * uFoliageWind * foliageBend;
  transformed.z += cos(uFoliageTime * 0.71 + foliagePhase * 1.17) * uFoliageWind * 0.48 * foliageBend;
#endif`,
        )
    }
    result.customProgramCacheKey = () => `shenron-ground-cover-${kind}-v1`
    return result
  }, [kind, style.roughness])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const euler = new THREE.Euler()
    const primary = new THREE.Color(style.color)
    const alternate = new THREE.Color(style.alternate)
    const color = new THREE.Color()

    instances.forEach((instance, index) => {
      position.set(instance.x, 0.125, instance.z)
      euler.set(0, instance.yaw, 0)
      rotation.setFromEuler(euler)
      scale.setScalar(instance.scale)
      matrix.compose(position, rotation, scale)
      mesh.setMatrixAt(index, matrix)

      const blend = 0.22 + 0.28 * (0.5 + 0.5 * Math.sin(instance.phase))
      color.copy(primary).lerp(alternate, blend)
      mesh.setColorAt(index, color)
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [instances, style.alternate, style.color])

  useFrame(({ clock }) => {
    windUniforms.current.uFoliageTime.value = clock.elapsedTime
  })

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  if (instances.length === 0) return null

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, instances.length]}
      castShadow={false}
      receiveShadow={false}
    />
  )
}

/** Four draw calls for the park's complete deterministic micro-biome. */
export function GroundCover({ count }: { count: number }) {
  const visible = useMemo(
    () => ALL_GROUND_COVER.slice(0, Math.max(0, Math.min(MAX_GROUND_COVER, count))),
    [count],
  )

  return (
    <group name="pocket-park-ground-cover">
      {(Object.keys(LAYER_STYLE) as GroundCoverKind[]).map((kind) => (
        <GroundCoverLayer
          key={kind}
          kind={kind}
          instances={visible.filter((instance) => instance.kind === kind)}
        />
      ))}
    </group>
  )
}
