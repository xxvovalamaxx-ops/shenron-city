/**
 * PBR texture hooks for Shenron City.
 *
 * Loads downloaded Poly Haven textures and returns materials
 * that can be applied to existing geometry.
 */
import { useMemo } from 'react'
import * as THREE from 'three'

const textureCache = new Map<string, THREE.Texture>()

function getCachedTexture(url: string, colorSpace = true): THREE.Texture {
  if (textureCache.has(url)) return textureCache.get(url)!
  const tex = new THREE.TextureLoader().load(url)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  if (colorSpace) tex.colorSpace = THREE.SRGBColorSpace
  textureCache.set(url, tex)
  return tex
}

/** Road surface material — dark asphalt with PBR detail */
export function useRoadMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#1a1a2e',
      roughness: 0.85,
      metalness: 0.05,
    })
    try {
      mat.map = getCachedTexture('/textures/roads/asphalt_floor_diffuse.jpg')
      mat.map.repeat.set(8, 8)
      mat.normalMap = getCachedTexture('/textures/roads/asphalt_floor_normal.jpg', false)
      mat.normalMap.repeat.set(8, 8)
      mat.roughnessMap = getCachedTexture('/textures/roads/asphalt_floor_roughness.jpg', false)
      mat.roughnessMap.repeat.set(8, 8)
    } catch {}
    return mat
  }, [])
}

/** Sidewalk material — concrete pavement */
export function useSidewalkMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#475569',
      roughness: 0.9,
      metalness: 0.0,
    })
    try {
      mat.map = getCachedTexture('/textures/roads/concrete_pavement_diffuse.jpg')
      mat.map.repeat.set(6, 6)
      mat.normalMap = getCachedTexture('/textures/roads/concrete_pavement_normal.jpg', false)
      mat.normalMap.repeat.set(6, 6)
    } catch {}
    return mat
  }, [])
}

/** Building facade material — concrete wall */
export function useBuildingMaterial(color = '#1e293b') {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.05,
    })
    try {
      mat.map = getCachedTexture('/textures/architecture/concrete_wall_001_diffuse.jpg')
      mat.map.repeat.set(2, 2)
      mat.normalMap = getCachedTexture('/textures/architecture/concrete_wall_001_normal.jpg', false)
      mat.normalMap.repeat.set(2, 2)
    } catch {}
    return mat
  }, [color])
}

/** Market stall wood material */
export function useWoodMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#8b6a42',
      roughness: 0.75,
      metalness: 0.0,
    })
    try {
      mat.map = getCachedTexture('/textures/props/wood_planks_diffuse.jpg')
      mat.map.repeat.set(2, 1)
      mat.normalMap = getCachedTexture('/textures/props/wood_planks_normal.jpg', false)
      mat.normalMap.repeat.set(2, 1)
    } catch {}
    return mat
  }, [])
}

/** Plaza ground material — concrete floor */
export function usePlazaMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#1e2a36',
      roughness: 0.75,
      metalness: 0.15,
    })
    try {
      mat.map = getCachedTexture('/textures/roads/concrete_floor_diffuse.jpg')
      mat.map.repeat.set(12, 12)
      mat.normalMap = getCachedTexture('/textures/roads/concrete_floor_normal.jpg', false)
      mat.normalMap.repeat.set(12, 12)
      mat.roughnessMap = getCachedTexture('/textures/roads/concrete_floor_roughness.jpg', false)
      mat.roughnessMap.repeat.set(12, 12)
    } catch {}
    return mat
  }, [])
}

/** Tower facade material — smooth concrete with slight metalness */
export function useTowerFacadeMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#2a3040',
      roughness: 0.55,
      metalness: 0.45,
    })
    try {
      mat.map = getCachedTexture('/textures/architecture/anti_slip_concrete_diffuse.jpg')
      mat.map.repeat.set(4, 20)
      mat.normalMap = getCachedTexture('/textures/architecture/anti_slip_concrete_normal.jpg', false)
      mat.normalMap.repeat.set(4, 20)
      mat.roughnessMap = getCachedTexture('/textures/architecture/anti_slip_concrete_roughness.jpg', false)
      mat.roughnessMap.repeat.set(4, 20)
    } catch {}
    return mat
  }, [])
}

/** Planter stone material */
export function usePlanterMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#5a6270',
      roughness: 0.85,
      metalness: 0.0,
    })
    try {
      mat.map = getCachedTexture('/textures/architecture/plastered_wall_diffuse.jpg')
      mat.map.repeat.set(1, 1)
      mat.normalMap = getCachedTexture('/textures/architecture/plastered_wall_normal.jpg', false)
      mat.normalMap.repeat.set(1, 1)
    } catch {}
    return mat
  }, [])
}

/** Rusty metal material — trash cans, old fixtures */
export function useMetalRustMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#5a5550',
      roughness: 0.6,
      metalness: 0.7,
    })
    try {
      mat.map = getCachedTexture('/textures/props/rusty_metal_diffuse.jpg')
      mat.map.repeat.set(1, 1)
      mat.normalMap = getCachedTexture('/textures/props/rusty_metal_normal.jpg', false)
      mat.normalMap.repeat.set(1, 1)
    } catch {}
    return mat
  }, [])
}

/** HQ floor — dark polished surface */
export function useHQFloorMaterial(roughness = 0.18) {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#0c0f14',
      roughness,
      metalness: 0.8,
    })
    try {
      mat.map = getCachedTexture('/textures/architecture/concrete_floor_02_diffuse.jpg')
      mat.map.repeat.set(6, 8)
      mat.normalMap = getCachedTexture('/textures/architecture/concrete_floor_02_normal.jpg', false)
      mat.normalMap.repeat.set(6, 8)
    } catch {}
    return mat
  }, [roughness])
}

/** Lobby floor — polished concrete with reflection */
export function useLobbyFloorMaterial(roughness = 0.26) {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#0f1318',
      roughness,
      metalness: 0.7,
    })
    try {
      mat.map = getCachedTexture('/textures/architecture/concrete_floor_02_diffuse.jpg')
      mat.map.repeat.set(8, 6)
      mat.normalMap = getCachedTexture('/textures/architecture/concrete_floor_02_normal.jpg', false)
      mat.normalMap.repeat.set(8, 6)
    } catch {}
    return mat
  }, [roughness])
}

/** Lobby wall — plastered wall texture */
export function useLobbyWallMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#3a4558',
      roughness: 0.8,
      metalness: 0.0,
    })
    try {
      mat.map = getCachedTexture('/textures/architecture/worn_plaster_wall_diffuse.jpg')
      mat.map.repeat.set(3, 2)
      mat.normalMap = getCachedTexture('/textures/architecture/worn_plaster_wall_normal.jpg', false)
      mat.normalMap.repeat.set(3, 2)
    } catch {}
    return mat
  }, [])
}

/** Tree bark material */
export function useBarkMaterial() {
  return useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#4a3427',
      roughness: 1,
    })
    try {
      mat.map = getCachedTexture('/textures/nature/bark_brown_01_diffuse.jpg')
      mat.map.repeat.set(1, 3)
      mat.normalMap = getCachedTexture('/textures/nature/bark_brown_01_normal.jpg', false)
      mat.normalMap.repeat.set(1, 3)
    } catch {}
    return mat
  }, [])
}
