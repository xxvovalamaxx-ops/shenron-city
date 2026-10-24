/**
 * Quality tiers for the city surface shaders, as one compile-time define.
 *
 *   SURFACE_Q 0 (low)     palette + albedo detail, no normal maps, no
 *                         interior mapping, flat recesses
 *   SURFACE_Q 1 (medium)  normal maps, recess parallax, interior mapping
 *                         out to a short range
 *   SURFACE_Q 2 (high)    everything, interior mapping out to where a window
 *                         is ~10 px wide
 *
 * A define rather than a uniform: the low tier must not pay for branches it
 * never takes. Changing tier recompiles each registered material once.
 */
import type * as THREE from 'three'
import type { QualityPreset } from '../palette'

const registry = new Set<THREE.Material>()
let current: QualityPreset = 'medium'

export function surfaceQualityLevel(q: QualityPreset): number {
  return q === 'low' ? 0 : q === 'medium' ? 1 : 2
}

function apply(material: THREE.Material): void {
  const level = surfaceQualityLevel(current)
  const defines = (material.defines ??= {}) as Record<string, unknown>
  if (defines.SURFACE_Q === level) return
  defines.SURFACE_Q = level
  material.needsUpdate = true
}

/** Track a material so its SURFACE_Q define follows the quality preset. */
export function registerSurfaceMaterial<T extends THREE.Material>(material: T): T {
  registry.add(material)
  apply(material)
  return material
}

export function unregisterSurfaceMaterial(material: THREE.Material): void {
  registry.delete(material)
}

/** Set the preset for every surface material, now and future. */
export function setSurfaceQuality(quality: QualityPreset): void {
  current = quality
  for (const material of registry) apply(material)
}

export function getSurfaceQuality(): QualityPreset {
  return current
}

// Dev-only handle so captures can compare tiers on the same frame.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __setSurfaceQuality: typeof setSurfaceQuality }).__setSurfaceQuality =
    setSurfaceQuality
}
