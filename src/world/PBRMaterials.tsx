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
