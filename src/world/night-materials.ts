/**
 * City materials by role — the entry points the rest of the game asks for.
 *
 * There used to be two building paths: the ported facade shader (a Lambert
 * material, flat white windows at night) on the streamed tiles the game
 * actually shows, and this module's Phase 3C night shader, which drew the
 * deterministic lit windows from building-lighting.bin but only on the
 * single-GLB fallback nobody sees. They are now one path:
 *
 *   buildings  src/city/facade.js — MeshStandardMaterial with the procedural
 *              facade, textured walls, recessed windows, interior-mapped
 *              rooms and storefronts, lit at night from the same
 *              deterministic model (city-lighting.ts, via surfaces/city-glsl)
 *   streets    surfaces/street-materials.ts — asphalt, paint, flags, kerbs
 *              and open ground, wet mode, street-light pools
 *
 * Both are single programs for day and night: the night terms are gated by
 * the shared `uCityPractical` uniform, so dusk never triggers a recompile.
 * Determinism is unchanged — every lit decision is still a pure integer hash
 * of (world seed, bid, floor, column) thresholded against the tested
 * occupancy curves, with no clock or random source in the shader.
 */
import type * as THREE from 'three'
import type { QualityPreset } from './palette'
import { FacadeMaterial } from '../city/facade.js'
import { getStreetMaterial, isStreetMaterial, StreetKind } from './surfaces/street-materials'

interface NightMaterialOptions {
  quality: QualityPreset
}

let fallbackFacade: FacadeMaterial | null = null

/**
 * The facade material for BLD_* meshes that arrive without the city runtime
 * payload (the single-GLB fallback). Same shader as the streamed city, with
 * per-building families derived from the id hash instead of the payload.
 */
export function getBuildingNightMaterial(_options: NightMaterialOptions): THREE.Material {
  if (!fallbackFacade) {
    fallbackFacade = new FacadeMaterial(null)
    fallbackFacade.material.userData.cityNight = true
  }
  return fallbackFacade.material
}

/** The shared asphalt material for every ROAD_* mesh. */
export function getRoadNightMaterial(_options: NightMaterialOptions): THREE.MeshStandardMaterial {
  const material = getStreetMaterial(StreetKind.ROAD)
  material.userData.cityNight = true
  return material
}

/** Materials owned by the city systems, so tile disposal must skip them. */
export function isCityNightMaterial(material: THREE.Material): boolean {
  return material.userData.cityNight === true || isStreetMaterial(material)
}

let nightMode = false

/**
 * Kept for the rig and the perf A/B tooling. The unified materials have no
 * separate night program any more, so this only records the mode; the
 * shaders follow `uCityPractical` directly.
 */
export function setCityNightMode(enabled: boolean): void {
  nightMode = enabled
}

export function getCityNightMode(): boolean {
  return nightMode
}

/** Night mode with hysteresis: on once practical > 0.55, off once < 0.45. */
export function cityNightModeFor(practical: number, current: boolean): boolean {
  if (current) return practical > 0.45
  return practical > 0.55
}

if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __setCityNightMode: typeof setCityNightMode }).__setCityNightMode =
    setCityNightMode
}
