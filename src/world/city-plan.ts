/**
 * The city, generated.
 *
 * Dragon Boulevard is 220 x 228 m of hand-placed geometry — seven storefronts,
 * ten trees. That is a street, not a city, and it does not scale by adding
 * more entries to an array by hand. This generates 2 x 2 km of it: arterials,
 * a street grid, blocks, and a building on every lot, from one seed.
 *
 * One plan, three consumers. Rendering, collision and the minimap all read the
 * same lots and road segments. Every time this project has had geometry and
 * collision authored separately they have drifted, and the player has ended up
 * walking through a wall or bouncing off empty pavement.
 *
 * The hand-authored district is carved out rather than overwritten. It is the
 * hero route, it is better than anything generated, and the generator's job is
 * to put a city around it — not to replace it.
 *
 * Pure and renderer-free: 4 km² of city is far too much to check by eye, so
 * the invariants that matter are asserted instead.
 */

/** Half-extent of the city, metres. 2 x 2 km total. */
export const CITY_HALF = 1000

/**
 * The hand-authored district, kept clear of generated geometry.
 * Matches CITY_GROUND in city-data.ts with a margin for its pavements.
 */
export const HERO_DISTRICT = {
  minX: -120,
  maxX: 120,
  minZ: -70,
  maxZ: 180,
} as const

/** Spacing of the street grid, metres. A walkable Manhattan block is ~80 x 180. */
export const BLOCK_X = 110
export const BLOCK_Z = 150
/** Roadway width between blocks. */
export const STREET_WIDTH = 18
/** Every Nth street is an arterial, wider and carrying through traffic. */
export const ARTERIAL_EVERY = 4
export const ARTERIAL_WIDTH = 30

export type District = 'downtown' | 'midrise' | 'residential' | 'waterfront' | 'park'

export interface Lot {
  id: string
  /** Footprint centre, metres. */
  x: number
  z: number
  width: number
  depth: number
  /** Ridge height in metres — real storeys, not arbitrary units. */
  height: number
  district: District
  /** Index into the building asset table. */
  asset: number
  /** Y rotation, radians. */
  rotation: number
}

export interface RoadSegment {
  id: string
  /** Centre line, metres. */
  x: number
  z: number
  width: number
  depth: number
  arterial: boolean
}

export interface CityPlan {
  lots: Lot[]
  roads: RoadSegment[]
  /** Water plane south of the city, the reason the waterfront exists. */
  shorelineZ: number
}

/** Deterministic PRNG — the city must be identical every run. */
function mulberry32(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Where the water starts. South of this is harbour, not buildable. */
export const SHORELINE_Z = -560

export function overlapsHero(x: number, z: number, width: number, depth: number): boolean {
  return (
    x + width / 2 > HERO_DISTRICT.minX &&
    x - width / 2 < HERO_DISTRICT.maxX &&
    z + depth / 2 > HERO_DISTRICT.minZ &&
    z - depth / 2 < HERO_DISTRICT.maxZ
  )
}

/**
 * District by position. Downtown clusters near the headquarters so the tower
 * has a skyline around it rather than standing alone in a field; height falls
 * off with distance, the way a real city's does.
 */
export function districtAt(x: number, z: number): District {
  if (z < SHORELINE_Z + 120) return 'waterfront'
  const fromCore = Math.hypot(x, z - 90)
  if (fromCore < 330) return 'downtown'
  if (fromCore < 620) return 'midrise'
  // A green wedge, so the map is not wall-to-wall building.
  if (x < -520 && z > 200) return 'park'
  return 'residential'
}

/** Height band per district, metres. */
const HEIGHT: Record<District, [min: number, max: number]> = {
  downtown: [45, 180],
  midrise: [18, 48],
  residential: [8, 20],
  waterfront: [6, 16],
  park: [0, 0],
}

/** How much of a block's area is built on, per district. */
const DENSITY: Record<District, number> = {
  downtown: 0.92,
  midrise: 0.78,
  residential: 0.62,
  waterfront: 0.45,
  park: 0.06,
}

function streetWidthAt(index: number): number {
  return index % ARTERIAL_EVERY === 0 ? ARTERIAL_WIDTH : STREET_WIDTH
}

/**
 * Build the plan.
 *
 * `assetCount` is how many distinct building meshes the renderer can instance;
 * lots reference them by index so this module needs no knowledge of the
 * asset pipeline.
 */
export function generateCityPlan(seed = 0x5121, assetCount = 5): CityPlan {
  const rand = mulberry32(seed)
  const lots: Lot[] = []
  const roads: RoadSegment[] = []

  const colsFrom = -Math.floor(CITY_HALF / BLOCK_X)
  const colsTo = Math.floor(CITY_HALF / BLOCK_X)
  const rowsFrom = Math.floor(SHORELINE_Z / BLOCK_Z)
  const rowsTo = Math.floor(CITY_HALF / BLOCK_Z)

  // Streets first: the grid is the skeleton everything else hangs off.
  for (let c = colsFrom; c <= colsTo; c++) {
    const w = streetWidthAt(c)
    roads.push({
      id: `ns-${c}`,
      x: c * BLOCK_X,
      z: (SHORELINE_Z + CITY_HALF) / 2,
      width: w,
      depth: CITY_HALF - SHORELINE_Z,
      arterial: w === ARTERIAL_WIDTH,
    })
  }
  for (let r = rowsFrom; r <= rowsTo; r++) {
    const w = streetWidthAt(r)
    roads.push({
      id: `ew-${r}`,
      x: 0,
      z: r * BLOCK_Z,
      width: CITY_HALF * 2,
      depth: w,
      arterial: w === ARTERIAL_WIDTH,
    })
  }

  // Then buildings on each block. A block is bounded by two streets per axis,
  // and those streets can be different widths — one may be an arterial. Using
  // a single width put buildings in the carriageway.
  for (let c = colsFrom; c < colsTo; c++) {
    for (let r = rowsFrom; r < rowsTo; r++) {
      const left = c * BLOCK_X + streetWidthAt(c) / 2
      const right = (c + 1) * BLOCK_X - streetWidthAt(c + 1) / 2
      const back = r * BLOCK_Z + streetWidthAt(r) / 2
      const front = (r + 1) * BLOCK_Z - streetWidthAt(r + 1) / 2

      const usableW = right - left
      const usableD = front - back
      if (usableW <= 4 || usableD <= 4) continue
      const blockX = (left + right) / 2
      const blockZ = (back + front) / 2

      const district = districtAt(blockX, blockZ)
      const density = DENSITY[district]
      if (district === 'park') continue

      // Several buildings per block, so streets get frontage instead of one
      // fat box per block. A real block has a terrace, not a monolith.
      const perBlock = district === 'downtown' ? 4 : district === 'waterfront' ? 2 : 3
      const slot = usableD / perBlock

      for (let i = 0; i < perBlock; i++) {
        if (rand() > density) continue

        // Leave a gap between neighbours so the terrace reads as separate
        // buildings, and keep the whole footprint inside the block.
        const depth = slot * (0.66 + rand() * 0.26)
        const width = usableW * (0.58 + rand() * 0.34)
        const z = back + slot * (i + 0.5)
        const jitter = Math.max(0, usableW - width) * 0.5
        const x = blockX + (rand() - 0.5) * jitter

        if (overlapsHero(x, z, width, depth)) continue
        if (z - depth / 2 < SHORELINE_Z) continue

        const [hMin, hMax] = HEIGHT[district]
        if (hMax <= 0) continue
        // Taller nearer the core, with variation — a skyline needs a silhouette.
        const falloff = Math.max(0, 1 - Math.hypot(x, z - 90) / 700)
        const height = hMin + (hMax - hMin) * (0.25 + 0.75 * falloff) * (0.6 + rand() * 0.55)

        lots.push({
          id: `lot-${c}-${r}-${i}`,
          x,
          z,
          width,
          depth,
          height: Math.max(hMin, height),
          district,
          asset: Math.floor(rand() * assetCount) % assetCount,
          // Right angles only: rotated buildings read as debris, not architecture.
          rotation: (Math.floor(rand() * 4) * Math.PI) / 2,
        })
      }
    }
  }

  return { lots, roads, shorelineZ: SHORELINE_Z }
}
