export const CITY_BUILDING_ASSETS = {
  'west-arcade': '/models/city/buildings/building-j.glb',
  'west-records': '/models/city/buildings/building-k.glb',
  'west-noodle': '/models/city/buildings/building-g.glb',
  'west-cinema': '/models/city/buildings/building-l.glb',
  'east-cycles': '/models/city/buildings/building-g.glb',
  'east-tea': '/models/city/buildings/building-k.glb',
  'east-hotel': '/models/city/buildings/building-skyscraper-c.glb',
} as const

export const CITY_NATURE_ASSETS = {
  detailed: '/models/city/nature/tree_detailed.glb',
  oak: '/models/city/nature/tree_oak.glb',
  thin: '/models/city/nature/tree_thin.glb',
  bush: '/models/city/nature/plant_bushDetailed.glb',
  rock: '/models/city/nature/rock_largeB.glb',
} as const

export const CITY_VEHICLE_ASSETS = [
  '/models/city/vehicles/race-future.glb',
  '/models/city/vehicles/sedan.glb',
  '/models/city/vehicles/taxi.glb',
  '/models/city/vehicles/van.glb',
] as const

/** Explicitly tracked because the source-pack GLBs reference these local atlases. */
export const CITY_ASSET_TEXTURES = [
  '/models/city/buildings/Textures/colormap.png',
  '/models/city/vehicles/Textures/colormap.png',
] as const

export function buildingAssetFor(id: string): string {
  return CITY_BUILDING_ASSETS[id as keyof typeof CITY_BUILDING_ASSETS] ??
    CITY_BUILDING_ASSETS['west-arcade']
}

export function vehicleAssetFor(index: number): string {
  return CITY_VEHICLE_ASSETS[index % CITY_VEHICLE_ASSETS.length]
}
