/**
 * The first Shenron City street, as renderer-free data.
 *
 * Rendering, collision and ambient movement all consume this module. Keeping
 * the district in one coordinate system prevents the classic prototype bug
 * where a visible shop and its invisible collision box drift apart.
 *
 * Units are metres. +Y is up. The headquarters entrance is at z=0.
 */

export interface CityBox {
  id: string
  x: number
  z: number
  width: number
  depth: number
  height: number
}

export interface Storefront extends CityBox {
  name: string
  color: string
  accent: string
  floors: number
}

export interface MarketStall extends CityBox {
  name: string
  awning: string
}

export interface StreetTree {
  id: string
  x: number
  z: number
  scale: number
}

export interface RoutePoint {
  x: number
  z: number
}

export interface AmbientRoute {
  id: string
  points: readonly RoutePoint[]
}

export const CITY_GROUND = {
  x: 0,
  z: 54,
  width: 220,
  depth: 228,
} as const

export const BOULEVARD = {
  x: 0,
  z: 92,
  width: 15,
  depth: 116,
  sidewalkWidth: 5,
} as const

export const MARKET_KEEPER = {
  id: 'mira',
  name: 'Mira',
  role: 'Night Market Keeper',
  x: 13.85,
  z: 86,
} as const

/**
 * Plaza security, stationed short of the entrance canopy.
 *
 * Off to the side of the doorway rather than in front of it — a guard standing
 * on the route would be an obstacle the player has to walk around on the way
 * to the one door that matters.
 */
export const PLAZA_WARDEN = {
  id: 'kai',
  name: 'Kai',
  role: 'Plaza Security',
  // Clear of the bollard columns at x=±5 and of their rows at z=6/14/22/30 —
  // standing in line with one puts a post through his name plate.
  x: -6.9,
  z: 9.6,
} as const

export const STOREFRONTS: readonly Storefront[] = [
  {
    id: 'west-arcade',
    name: 'Arcade 88',
    x: -37,
    z: 58,
    width: 19,
    depth: 19,
    height: 15,
    floors: 4,
    color: '#23283a',
    accent: '#8b5cf6',
  },
  {
    id: 'west-records',
    name: 'Neon Records',
    x: -37,
    z: 83,
    width: 19,
    depth: 20,
    height: 18,
    floors: 5,
    color: '#252a35',
    accent: '#ec4899',
  },
  {
    id: 'west-noodle',
    name: 'Midnight Noodles',
    x: -37,
    z: 109,
    width: 19,
    depth: 20,
    height: 13,
    floors: 3,
    color: '#30261f',
    accent: '#f59e0b',
  },
  {
    id: 'west-cinema',
    name: 'Dragon Cinema',
    x: -37,
    z: 135,
    width: 19,
    depth: 20,
    height: 22,
    floors: 6,
    color: '#202538',
    accent: '#60a5fa',
  },
  {
    id: 'east-cycles',
    name: 'Cloud Cycles',
    x: 29,
    z: 58,
    width: 20,
    depth: 22,
    height: 17,
    floors: 4,
    color: '#202d31',
    accent: '#2dd4bf',
  },
  {
    id: 'east-tea',
    name: 'Lucky Tea',
    x: 29,
    z: 112,
    width: 20,
    depth: 22,
    height: 15,
    floors: 4,
    color: '#2d2921',
    accent: '#fbbf24',
  },
  {
    id: 'east-hotel',
    name: 'Sol Hotel',
    x: 29,
    z: 140,
    width: 20,
    depth: 22,
    height: 26,
    floors: 7,
    color: '#252938',
    accent: '#fb7185',
  },
] as const

export const MARKET_STALLS: readonly MarketStall[] = [
  { id: 'stall-ramen', name: 'Ramen', x: 16.5, z: 78, width: 3.8, depth: 2.5, height: 2.4, awning: '#ef4444' },
  { id: 'stall-tea', name: 'Tea', x: 16.5, z: 86, width: 3.8, depth: 2.5, height: 2.4, awning: '#f59e0b' },
  { id: 'stall-flowers', name: 'Flowers', x: 16.5, z: 94, width: 3.8, depth: 2.5, height: 2.4, awning: '#ec4899' },
  { id: 'stall-books', name: 'Books', x: 16.5, z: 102, width: 3.8, depth: 2.5, height: 2.4, awning: '#3b82f6' },
] as const

export const STREET_TREES: readonly StreetTree[] = [
  { id: 'park-1', x: -16, z: 44, scale: 1.15 },
  { id: 'park-2', x: -20, z: 47, scale: 1.35 },
  { id: 'park-3', x: -24, z: 43, scale: 1.05 },
  { id: 'park-4', x: -19, z: 54, scale: 1.2 },
  { id: 'park-5', x: -24, z: 55, scale: 0.95 },
  { id: 'street-west-1', x: -8.4, z: 66, scale: 0.75 },
  { id: 'street-west-2', x: -8.4, z: 92, scale: 0.75 },
  { id: 'street-west-3', x: -8.4, z: 118, scale: 0.75 },
  { id: 'street-west-4', x: -8.4, z: 144, scale: 0.75 },
  { id: 'street-east-1', x: 8.4, z: 66, scale: 0.75 },
  { id: 'street-east-2', x: 8.4, z: 112, scale: 0.75 },
  { id: 'street-east-3', x: 8.4, z: 138, scale: 0.75 },
] as const

export const STREET_LIGHTS: readonly RoutePoint[] = [
  { x: -8.8, z: 52 },
  { x: 8.8, z: 52 },
  { x: -8.8, z: 76 },
  { x: 8.8, z: 76 },
  { x: -8.8, z: 100 },
  { x: 8.8, z: 100 },
  { x: -8.8, z: 124 },
  { x: 8.8, z: 124 },
  { x: -8.8, z: 148 },
  { x: 8.8, z: 148 },
] as const

export const AMBIENT_ROUTES: readonly AmbientRoute[] = [
  {
    id: 'west-sidewalk',
    points: [
      { x: -10.7, z: 48 },
      { x: -10.7, z: 148 },
      { x: -14, z: 152 },
      { x: -14, z: 48 },
    ],
  },
  {
    id: 'east-sidewalk',
    points: [
      { x: 9.4, z: 48 },
      { x: 9.4, z: 150 },
      { x: 10.8, z: 150 },
      { x: 10.8, z: 48 },
    ],
  },
  {
    id: 'market-loop',
    points: [
      { x: 11.3, z: 72 },
      { x: 11.3, z: 106 },
      { x: 13.1, z: 106 },
      { x: 13.1, z: 72 },
    ],
  },
  {
    id: 'park-loop',
    points: [
      { x: -14, z: 39 },
      { x: -24, z: 39 },
      { x: -25, z: 58 },
      { x: -14, z: 59 },
    ],
  },
] as const

/**
 * Solid city objects generated from the same data the renderer consumes.
 * Awning roofs stay non-solid so the player can walk underneath them.
 */
/**
 * The traffic loop: north up the east lane, south down the west lane.
 *
 * A single closed loop rather than two one-way lanes, so vehicles circulate
 * forever without needing spawn and despawn logic. The two turning segments sit
 * at z=30 and z=156 — beyond both ends of the walkable stretch of Dragon
 * Boulevard (z 34..150), so the player never watches a car make an
 * unexplained U-turn in the middle of the road.
 *
 * Right-hand traffic: +x is east, so northbound belongs on the +x side.
 */
export const TRAFFIC_LOOP: readonly RoutePoint[] = [
  { x: 3.6, z: 30 },
  { x: 3.6, z: 156 },
  { x: -3.6, z: 156 },
  { x: -3.6, z: 30 },
] as const

/** A saloon, roughly. Used for rendering and for the collider alike. */
export const VEHICLE = {
  length: 4.35,
  width: 1.86,
  height: 1.44,
  /** Roof box, as a fraction of the body. */
  cabinLength: 0.52,
  cabinHeight: 0.62,
} as const

export const CITY_OBSTACLES: readonly CityBox[] = [
  ...STOREFRONTS,
  ...MARKET_STALLS.map((stall) => ({
    ...stall,
    height: 1.05,
  })),
  { id: 'market-keeper', x: MARKET_KEEPER.x, z: MARKET_KEEPER.z, width: 0.7, depth: 0.7, height: 1.8 },
  { id: 'plaza-warden', x: PLAZA_WARDEN.x, z: PLAZA_WARDEN.z, width: 0.7, depth: 0.7, height: 1.8 },
] as const

function boxContains(box: CityBox, point: RoutePoint, margin = 0): boolean {
  return (
    point.x > box.x - box.width / 2 - margin &&
    point.x < box.x + box.width / 2 + margin &&
    point.z > box.z - box.depth / 2 - margin &&
    point.z < box.z + box.depth / 2 + margin
  )
}

function segmentIntersectsBox(
  start: RoutePoint,
  end: RoutePoint,
  box: CityBox,
  margin: number,
): boolean {
  let near = 0
  let far = 1

  for (const axis of ['x', 'z'] as const) {
    const half = axis === 'x' ? box.width / 2 : box.depth / 2
    const min = box[axis] - half - margin
    const max = box[axis] + half + margin
    const delta = end[axis] - start[axis]

    if (Math.abs(delta) < 1e-8) {
      if (start[axis] < min || start[axis] > max) return false
      continue
    }

    const a = (min - start[axis]) / delta
    const b = (max - start[axis]) / delta
    near = Math.max(near, Math.min(a, b))
    far = Math.min(far, Math.max(a, b))
    if (near > far) return false
  }

  return true
}

/** Validate authored district data before it can become geometry or collision. */
export function validateCityData(): string[] {
  const issues: string[] = []
  const ids = new Set<string>()
  const identified = [...STOREFRONTS, ...MARKET_STALLS, ...STREET_TREES, ...AMBIENT_ROUTES]

  for (const item of identified) {
    if (ids.has(item.id)) issues.push(`Duplicate city id: ${item.id}`)
    ids.add(item.id)
  }

  for (const box of [...STOREFRONTS, ...MARKET_STALLS]) {
    if (box.width <= 0 || box.depth <= 0 || box.height <= 0) {
      issues.push(`${box.id} has a non-positive dimension`)
    }
  }

  for (const route of AMBIENT_ROUTES) {
    if (route.points.length < 3) {
      issues.push(`${route.id} needs at least three points`)
      continue
    }
    for (const point of route.points) {
      const outside =
        Math.abs(point.x - CITY_GROUND.x) > CITY_GROUND.width / 2 ||
        Math.abs(point.z - CITY_GROUND.z) > CITY_GROUND.depth / 2
      if (outside) issues.push(`${route.id} leaves the city ground`)

      const obstacle = CITY_OBSTACLES.find((box) => boxContains(box, point, 0.35))
      if (obstacle) issues.push(`${route.id} has a point inside ${obstacle.id}`)
    }

    for (let index = 0; index < route.points.length; index++) {
      const start = route.points[index]
      const end = route.points[(index + 1) % route.points.length]
      const obstacle = CITY_OBSTACLES.find((box) =>
        segmentIntersectsBox(start, end, box, 0.35),
      )
      if (obstacle) issues.push(`${route.id} crosses ${obstacle.id}`)
    }
  }

  return issues
}
