import phase1Config from '../../data/config/manhattan-hq.json'
import { GeoTransform, type GeoTransformConfig } from '../city/geo/GeoTransform'

const geoConfig: GeoTransformConfig = {
  hqGeoAnchor: phase1Config.hqGeoAnchor,
  hqWorldPosition: phase1Config.hqWorldPosition as [number, number, number],
  localOriginMeters: [0, 0, 0],
  northYawDegrees: phase1Config.northYawDegrees,
  worldUnitsPerMeter: phase1Config.worldUnitsPerMeter,
}

export const PHASE1_GEO_TRANSFORM = new GeoTransform(geoConfig)
export const PHASE1_AOI_SIZE_METERS = phase1Config.aoiSizeMeters
export const PHASE1_HQ_WORLD = Object.freeze({
  x: geoConfig.hqWorldPosition[0],
  y: geoConfig.hqWorldPosition[1],
  z: geoConfig.hqWorldPosition[2],
})

/** Open ground 80 m south of the fixture HQ, in the Phase-1 local contract. */
const phase1SpawnWorld = PHASE1_GEO_TRANSFORM.localToWorld([0, 0, -80])

export const PHASE1_SPAWN = Object.freeze({
  x: phase1SpawnWorld[0],
  y: phase1SpawnWorld[1],
  z: phase1SpawnWorld[2],
})

export function resolvePhase1Spawn(): { x: number; y: number; z: number } {
  return { ...PHASE1_SPAWN }
}
