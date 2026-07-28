import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import {
  generateGroundCover,
  type GroundCoverInstance,
  type GroundCoverKind,
} from './scatter-data'
import { MEADOW_TEXTURES, type MeadowTextureSet } from './meadow-assets'

const MODEL_URL = '/models/environment/meadow-templates.glb?v=1342e73c'
const MAX_GROUND_COVER = 1_600
const ALL_GROUND_COVER = generateGroundCover(MAX_GROUND_COVER)

interface ScannedStyle {
  node: string
  height: number
  tint: string
  alternate: string
  wind: number
  textures: MeadowTextureSet
}

const SCANNED_STYLE: Record<GroundCoverKind, ScannedStyle> = {
  'short-grass': {
    node: 'MeadowGrassFine',
    height: 0.28,
    tint: '#c6d6b2',
    alternate: '#d6c89a',
    wind: 0.045,
    textures: MEADOW_TEXTURES.mediumGrass,
  },
  'tall-grass': {
    node: 'MeadowGrassTall',
    height: 0.54,
    tint: '#b6c7a3',
    alternate: '#d0bb8c',
    wind: 0.075,
    textures: MEADOW_TEXTURES.mediumGrass,
  },
  fern: {
    node: 'MeadowFern',
    height: 0.48,
    tint: '#acd0ad',
    alternate: '#c4d5ab',
    wind: 0.042,
    textures: MEADOW_TEXTURES.fern,
  },
  flower: {
    node: 'MeadowWeed',
    height: 0.44,
    tint: '#cbd4a7',
    alternate: '#ddc1ad',
    wind: 0.06,
    textures: MEADOW_TEXTURES.weed,
  },
}

const textureCache = new Map<string, THREE.Texture>()

function plantTexture(url: string, colorSpace: boolean): THREE.Texture {
  const cached = textureCache.get(url)
  if (cached) return cached
  const texture = new THREE.TextureLoader().load(url)
  texture.colorSpace = colorSpace ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 4
  textureCache.set(url, texture)
  return texture
}

function meshGeometry(scene: THREE.Group, name: string): THREE.BufferGeometry {
  const object = scene.getObjectByName(name)
  if (!(object instanceof THREE.Mesh)) {
    throw new Error(`Meadow runtime package is missing ${name}`)
  }
  return object.geometry
}

function ScannedLayer({
  kind,
  geometry,
  instances,
}: {
  kind: GroundCoverKind
  geometry: THREE.BufferGeometry
  instances: readonly GroundCoverInstance[]
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const style = SCANNED_STYLE[kind]
  const wind = useRef({ time: { value: 0 }, strength: { value: style.wind } })
  const material = useMemo(() => {
    const result = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: plantTexture(style.textures.albedo, true),
      alphaMap: style.textures.alpha
        ? plantTexture(style.textures.alpha, false)
        : undefined,
      alphaTest: 0.42,
      roughness: 0.94,
      metalness: 0,
      emissive: '#101a12',
      emissiveIntensity: 0.42,
      side: THREE.DoubleSide,
      vertexColors: true,
    })
    result.emissiveMap = result.map
    result.onBeforeCompile = (shader) => {
      shader.uniforms.uMeadowTime = wind.current.time
      shader.uniforms.uMeadowWind = wind.current.strength
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uMeadowTime;
uniform float uMeadowWind;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  float meadowRatio = clamp(position.y, 0.0, 1.0);
  float meadowPhase = instanceMatrix[3].x * 0.41 + instanceMatrix[3].z * 0.29;
  float meadowBend = meadowRatio * meadowRatio;
  transformed.x += sin(uMeadowTime * 0.92 + meadowPhase) * uMeadowWind * meadowBend;
  transformed.z += cos(uMeadowTime * 0.71 + meadowPhase * 1.17) * uMeadowWind * 0.48 * meadowBend;
#endif`,
        )
    }
    result.customProgramCacheKey = () => `shenron-scanned-meadow-${kind}-v1`
    return result
  }, [kind, style.textures])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const euler = new THREE.Euler()
    const primary = new THREE.Color(style.tint)
    const alternate = new THREE.Color(style.alternate)
    const color = new THREE.Color()

    instances.forEach((instance, index) => {
      position.set(instance.x, 0.125, instance.z)
      euler.set(0, instance.yaw, 0)
      rotation.setFromEuler(euler)
      scale.setScalar(style.height * instance.scale)
      matrix.compose(position, rotation, scale)
      mesh.setMatrixAt(index, matrix)
      const blend = 0.18 + 0.26 * (0.5 + 0.5 * Math.sin(instance.phase))
      color.copy(primary).lerp(alternate, blend)
      mesh.setColorAt(index, color)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [instances, style.alternate, style.height, style.tint])

  useFrame(({ clock }) => {
    wind.current.time.value = clock.elapsedTime
  })

  useEffect(() => () => material.dispose(), [material])

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, instances.length]}
      castShadow={false}
      receiveShadow={false}
    />
  )
}

/** Four draw calls using normalized LOD1 meshes exported from the reviewed scene. */
export function ScannedGroundCover({ count }: { count: number }) {
  const { scene } = useGLTF(MODEL_URL)
  const visible = useMemo(
    () => ALL_GROUND_COVER.slice(0, Math.max(0, Math.min(MAX_GROUND_COVER, count))),
    [count],
  )

  return (
    <group name="scanned-pocket-park-ground-cover">
      {(Object.keys(SCANNED_STYLE) as GroundCoverKind[]).map((kind) => {
        const style = SCANNED_STYLE[kind]
        return (
          <ScannedLayer
            key={kind}
            kind={kind}
            geometry={meshGeometry(scene, style.node)}
            instances={visible.filter((instance) => instance.kind === kind)}
          />
        )
      })}
    </group>
  )
}
