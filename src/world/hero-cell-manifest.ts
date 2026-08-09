/** Persistent authored replacements shipped with Manhattan. */
import clusterJson from './w47-hero-cluster.json'
import { type HeroCellRegistry, type HeroCellSpec } from './hero-cells'

export interface HeroAssetTierBudget {
  maxBytes: number
  maxTriangles: number
  /** Local-space top, including roof equipment. The base is always y=0. */
  maxHeight: number
}

export interface PersistentHeroCell {
  spec: HeroCellSpec
  source: {
    osmId: number
    x: number
    y: number
    height: number
    address: string
    name: string
    facade: string
  }
  /**
   * Diagnostics-only envelope of the real source polygon in the hero GLB's
   * inverse-yaw local frame. Geometry conformance is enforced against the
   * decoded polygon, never this broader AABB.
   */
  sourceFootprintEnvelope: { minX: number; maxX: number; minZ: number; maxZ: number }
  roofKit: string
  budgets: { lod0: HeroAssetTierBudget; lod1: HeroAssetTierBudget }
}

export const W47_HERO_CLUSTER_ID = clusterJson.clusterId
export const W47_HQ_BUILDING_ID = clusterJson.hqBuildingId

export const W47_HERO_CLUSTER: readonly PersistentHeroCell[] = Object.freeze(
  clusterJson.buildings.map((entry) => ({
    spec: {
      buildingId: entry.buildingId,
      lod0: `/models/manhattan/hero/w47/building-${entry.buildingId}-lod0.glb`,
      lod1: `/models/manhattan/hero/w47/building-${entry.buildingId}-lod1.glb`,
      lod1FromMetres: clusterJson.lod1FromMetres,
      rotationY: entry.rotationY,
      yOffset: clusterJson.groundY,
      note:
        `${clusterJson.clusterId}: OSM ${entry.osmId}, ${entry.facade}, ` +
        `${entry.roofKit}; original deterministic parametric geometry`,
    },
    source: {
      osmId: entry.osmId,
      x: entry.x,
      y: entry.y,
      height: entry.height,
      address: entry.address,
      name: entry.name,
      facade: entry.facade,
    },
    sourceFootprintEnvelope: entry.sourceFootprintEnvelope,
    roofKit: entry.roofKit,
    budgets: entry.budgets,
  })),
)

/**
 * Install once without clearing readiness on an already-running city.
 * `HeroCellRegistry.add` intentionally clears readiness, so blindly re-adding
 * during a React remount would briefly resurrect every generated building.
 */
export function installPersistentHeroCells(registry: HeroCellRegistry): void {
  for (const entry of W47_HERO_CLUSTER) {
    if (!registry.get(entry.spec.buildingId)) registry.add(entry.spec)
  }
}
