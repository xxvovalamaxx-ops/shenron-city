export const PRODUCTION_ASSETS = {
  exterior: '/assets/production/architecture/hero-district.glb',
  skylineLods: [
    '/assets/production/architecture/distant-skyline-lod0.glb',
    '/assets/production/architecture/distant-skyline-lod1.glb',
    '/assets/production/architecture/distant-skyline-lod2.glb',
  ],
  lobby: '/assets/production/interiors/hq-lobby.glb',
  floor45: '/assets/production/interiors/floor45.glb',
  elevatorStatic: '/assets/production/interiors/elevator-static.glb',
  elevatorCar: '/assets/production/interiors/elevator-car.glb',
  automaticDoor: '/assets/production/props/automatic-door-leaf.glb',
  vehicles: [
    '/assets/production/vehicles/premium-sedan.glb',
    '/assets/production/vehicles/suv-crossover.glb',
    '/assets/production/vehicles/compact-city.glb',
    '/assets/production/vehicles/delivery-van.glb',
  ],
} as const

export interface SkylinePlacement {
  id: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
}

/**
 * The clusters form a distant authored ring around the traversable district.
 * They remain outside gameplay collision while closing the black horizon from
 * every exterior regression camera.
 */
export const SKYLINE_PLACEMENTS: readonly SkylinePlacement[] = [
  {
    id: 'north',
    position: [0, 0, -182],
    rotation: [0, 0, 0],
    scale: 1,
  },
  {
    id: 'north-west',
    position: [-136, 0, -212],
    rotation: [0, 0.12, 0],
    scale: 0.82,
  },
  {
    id: 'north-east',
    position: [136, 0, -204],
    rotation: [0, -0.1, 0],
    scale: 0.84,
  },
  {
    id: 'west',
    position: [-166, 0, 68],
    rotation: [0, Math.PI / 2, 0],
    scale: 0.88,
  },
  {
    id: 'east',
    position: [166, 0, 78],
    rotation: [0, -Math.PI / 2, 0],
    scale: 0.92,
  },
]

export const SKYLINE_LOD_DISTANCES = [0, 175, 315] as const
