import { lazy, Suspense, useMemo } from 'react'
import { Detailed, useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import type { QualitySettings } from './palette'
import { PALETTE } from './palette'
import { STREET_LIGHTS, STREET_TREES } from './city-data'
import { MeadowPark } from './MeadowPark'
import { Traffic } from './Traffic'
import {
  PRODUCTION_ASSETS,
  SKYLINE_LOD_DISTANCES,
  SKYLINE_PLACEMENTS,
  type SkylinePlacement,
} from './production-assets'

export { PRODUCTION_ASSETS } from './production-assets'

const textureUrls = [
  '/textures/roads/asphalt_floor_diffuse.jpg',
  '/textures/roads/asphalt_floor_normal.jpg',
  '/textures/roads/asphalt_floor_roughness.jpg',
  '/textures/roads/concrete_pavement_diffuse.jpg',
  '/textures/roads/concrete_pavement_normal.jpg',
  '/textures/architecture/concrete_wall_001_diffuse.jpg',
  '/textures/architecture/concrete_wall_001_normal.jpg',
  '/textures/architecture/concrete_floor_02_diffuse.jpg',
  '/textures/architecture/concrete_floor_02_normal.jpg',
  '/textures/props/wood_planks_diffuse.jpg',
  '/textures/props/wood_planks_normal.jpg',
] as const

function configureTexture(
  texture: THREE.Texture,
  color: boolean,
  repeat: readonly [number, number],
): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat[0], repeat[1])
  texture.anisotropy = 8
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

function useProductionMaterials(): ReadonlyMap<string, THREE.Material> {
  const textures = useTexture([...textureUrls])

  return useMemo(() => {
    const [
      asphaltColor,
      asphaltNormal,
      asphaltRoughness,
      pavementColor,
      pavementNormal,
      concreteColor,
      concreteNormal,
      stoneColor,
      stoneNormal,
      woodColor,
      woodNormal,
    ] = textures

    const asphalt = new THREE.MeshStandardMaterial({
      name: 'MAT_Asphalt_Runtime',
      map: configureTexture(asphaltColor, true, [4, 16]),
      normalMap: configureTexture(asphaltNormal, false, [4, 16]),
      roughnessMap: configureTexture(asphaltRoughness, false, [4, 16]),
      color: '#6c7180',
      roughness: 0.94,
      metalness: 0,
    })
    const sidewalk = new THREE.MeshStandardMaterial({
      name: 'MAT_Sidewalk_Runtime',
      map: configureTexture(pavementColor, true, [3, 12]),
      normalMap: configureTexture(pavementNormal, false, [3, 12]),
      color: '#879099',
      roughness: 0.9,
      metalness: 0,
    })
    const concrete = new THREE.MeshStandardMaterial({
      name: 'MAT_Concrete_Runtime',
      map: configureTexture(concreteColor, true, [4, 6]),
      normalMap: configureTexture(concreteNormal, false, [4, 6]),
      color: '#727983',
      roughness: 0.78,
      metalness: 0.02,
    })
    const stone = new THREE.MeshStandardMaterial({
      name: 'MAT_Stone_Runtime',
      map: configureTexture(stoneColor, true, [3, 3]),
      normalMap: configureTexture(stoneNormal, false, [3, 3]),
      color: '#8b8e92',
      roughness: 0.66,
      metalness: 0.03,
    })
    const wood = new THREE.MeshStandardMaterial({
      name: 'MAT_Wood_Runtime',
      map: configureTexture(woodColor, true, [2, 2]),
      normalMap: configureTexture(woodNormal, false, [2, 2]),
      color: '#a07855',
      roughness: 0.76,
      metalness: 0,
    })

    return new Map<string, THREE.Material>([
      ['MAT_Asphalt', asphalt],
      ['MAT_Sidewalk', sidewalk],
      ['MAT_Concrete', concrete],
      ['MAT_Stone', stone],
      ['MAT_Wood', wood],
    ])
  }, [textures])
}

interface ProductionStaticProps {
  url: string
  shadows: boolean
}

/**
 * One authored Blender zone with stable asset IDs and production PBR overrides.
 *
 * Geometry/material buffers remain shared through Drei's cache. The object
 * hierarchy is cloned so each zone can own visibility and world transforms.
 */
export function ProductionStatic({ url, shadows }: ProductionStaticProps) {
  const source = useGLTF(url)
  const materials = useProductionMaterials()
  const model = useMemo(() => {
    const instance = source.scene.clone(true)
    instance.name = `production-zone:${url}`
    instance.traverse((object) => {
      object.frustumCulled = true
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = shadows
      object.receiveShadow = shadows
      const originals = Array.isArray(object.material) ? object.material : [object.material]
      const replacements = originals.map((original) => {
        const override = materials.get(original.name)
        return override ?? original
      })
      object.material = Array.isArray(object.material) ? replacements : replacements[0]
      object.userData.assetId ??= object.userData.asset_id ?? object.name
      object.userData.productionRole ??= object.userData.production_role ?? 'render'
    })
    instance.updateMatrixWorld(true)
    return instance
  }, [materials, shadows, source.scene, url])

  return <primitive object={model} dispose={null} />
}

const DetailTree = lazy(() => import('./Tree'))
const TREE_VARIANTS = ['oak', 'birch', 'willow', 'pine'] as const

function ProductionTrees({ shadows }: { shadows: boolean }) {
  return (
    <Suspense fallback={null}>
      {STREET_TREES.map((tree, index) => (
        <DetailTree
          key={tree.id}
          position={[tree.x, 0, tree.z]}
          height={(index < 5 ? 8.5 : 4.2) * tree.scale}
          seed={20260729 + index * 97}
          variant={TREE_VARIANTS[index % TREE_VARIANTS.length]}
          shadows={shadows}
        />
      ))}
    </Suspense>
  )
}

function ExteriorPracticals() {
  return (
    <>
      {STREET_LIGHTS.map((light, index) => (
        <pointLight
          key={`${light.x}:${light.z}`}
          position={[light.x - Math.sign(light.x) * 0.72, 4.35, light.z]}
          color={index % 3 === 0 ? '#ffd4a0' : '#ffc887'}
          intensity={82}
          distance={24}
          decay={2}
        />
      ))}
      {[78, 86, 94, 102].map((z) => (
        <pointLight
          key={z}
          position={[15.8, 2.35, z]}
          color="#ffc98b"
          intensity={36}
          distance={9}
          decay={2}
        />
      ))}
    </>
  )
}

function SkylineCluster({ placement }: { placement: SkylinePlacement }) {
  return (
    <group
      name={`production-skyline-${placement.id}`}
      position={placement.position}
      rotation={placement.rotation}
      scale={placement.scale}
    >
      <Detailed distances={[...SKYLINE_LOD_DISTANCES]}>
        {PRODUCTION_ASSETS.skylineLods.map((url) => (
          <ProductionStatic key={url} url={url} shadows={false} />
        ))}
      </Detailed>
    </group>
  )
}

function ProductionSkyline() {
  return (
    <group name="production-distant-skyline">
      {SKYLINE_PLACEMENTS.map((placement) => (
        <SkylineCluster key={placement.id} placement={placement} />
      ))}
    </group>
  )
}

/** Complete exterior production zone, with gameplay-owned traffic and foliage. */
export function ProductionExterior({ quality }: { quality: QualitySettings }) {
  return (
    <group name="production-exterior-hero-district">
      <ProductionStatic url={PRODUCTION_ASSETS.exterior} shadows={quality.shadows} />
      <ProductionSkyline />
      <MeadowPark quality={quality} />
      {/* Alpha-card foliage dominates the moon shadow pass at ultrawide
          resolution. Architecture and characters keep authored shadows; tree
          grounding comes from receiving those shadows and the dark soil/
          planter contact beneath each trunk. */}
      <ProductionTrees shadows={false} />
      <Traffic quality={quality} />
      <ExteriorPracticals />
    </group>
  )
}

function LobbyLights({ shadows }: { shadows: boolean }) {
  return (
    <>
      {[-4, -10, -16, -22, -27].flatMap((z, row) =>
        [-9, 0, 9].map((x, column) => (
          <pointLight
            key={`${x}:${z}`}
            position={[x, 8.65, z]}
            color={row % 2 === 0 ? PALETTE.warmLight : '#dce9ff'}
          intensity={column === 1 ? 44 : 32}
            distance={19}
            decay={2}
            castShadow={shadows && row === 1 && column === 1}
            shadow-mapSize={[512, 512]}
            shadow-bias={-0.001}
          />
        )),
      )}
    </>
  )
}

export function ProductionLobby({ quality }: { quality: QualitySettings }) {
  return (
    <group name="production-hq-lobby">
      <ProductionStatic url={PRODUCTION_ASSETS.lobby} shadows={quality.shadows} />
      <LobbyLights shadows={quality.shadows} />
    </group>
  )
}

export function ProductionFloor45({ quality }: { quality: QualitySettings }) {
  return (
    <group name="production-floor-45">
      <ProductionStatic url={PRODUCTION_ASSETS.floor45} shadows={quality.shadows} />
      {[-3, -9, -15, -21, -27].map((z, index) => (
        <pointLight
          key={z}
          position={[0, 184.0, z]}
          color="#dce9ff"
          intensity={42}
          distance={20}
          decay={2}
          castShadow={quality.shadows && index === 1}
          shadow-mapSize={[512, 512]}
          shadow-bias={-0.001}
        />
      ))}
    </group>
  )
}

for (const url of [
  PRODUCTION_ASSETS.exterior,
  PRODUCTION_ASSETS.lobby,
  PRODUCTION_ASSETS.floor45,
  PRODUCTION_ASSETS.elevatorStatic,
  PRODUCTION_ASSETS.elevatorCar,
  PRODUCTION_ASSETS.automaticDoor,
  ...PRODUCTION_ASSETS.skylineLods,
  ...PRODUCTION_ASSETS.vehicles,
]) {
  useGLTF.preload(url)
}

for (const url of textureUrls) useTexture.preload(url)
