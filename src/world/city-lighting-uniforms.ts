/**
 * Shared uniforms for the Phase 3C city-night shaders.
 *
 * Every building/road material references THIS uniform object, so one write
 * per frame (from CityLightingRig) reaches every draw call without touching
 * React. The values come from the existing day-cycle clock: `practicals` is
 * the same curve the sky uses, which is what keeps the windows, the street
 * lights and the sky from disagreeing about whether it is night.
 */
import * as THREE from 'three'
import { DEFAULT_WORLD_SEED } from './city-lighting'

export interface CityLightingUniforms {
  uCityPractical: THREE.IUniform<number>
  uCityHour: THREE.IUniform<number>
  uCityWorldSeed: THREE.IUniform<number>
  uCityWetness: THREE.IUniform<number>
  uCityBuildingData: THREE.IUniform<THREE.DataTexture | null>
  uCityDataWidth: THREE.IUniform<number>
  uCityDataHeight: THREE.IUniform<number>
  /** 0 = coarse (low), 1 = full pattern (medium/high). */
  uCityPatternQuality: THREE.IUniform<number>
  /** Ground level of the island's street grid, metres. */
  uCityGroundY: THREE.IUniform<number>
  /** Dev-only: 0 = off, 1 = flat glow, 2 = bid, 3 = texture, 4 = hash. */
  uCityDebugMode: THREE.IUniform<number>
}

export const cityLightingUniforms: CityLightingUniforms = {
  uCityPractical: { value: 0 },
  uCityHour: { value: 21 },
  uCityWorldSeed: { value: DEFAULT_WORLD_SEED },
  uCityWetness: { value: 0 },
  uCityBuildingData: { value: null },
  uCityDataWidth: { value: 512 },
  uCityDataHeight: { value: 111 },
  uCityPatternQuality: { value: 1 },
  uCityGroundY: { value: 12 },
  uCityDebugMode: { value: 0 },
}

// Dev-only handle so captures can inspect the live lighting state. Stripped
// from production builds by the DEV guard.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __cityLighting: CityLightingUniforms }).__cityLighting =
    cityLightingUniforms
}
