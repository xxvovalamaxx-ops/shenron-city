/**
 * Deterministic city-night lighting model — Phase 3C.
 *
 * The Manhattan island is one 56k-building OSM import: every facade vertex
 * carries `_bid` (the building id) and every building has a row in
 * `building_manifest.csv` with a real class, height, district and OSM tag.
 * This module is the single source of truth for how those buildings light up
 * at night, shared three ways:
 *
 *  - the build script bakes one RGBA texel per building id (kind, storefront
 *    flags, window density, floor fill) into building-lighting.bin;
 *  - the fragment shader reads that texel by `_bid` and draws windows; and
 *  - the tests prove the model's properties (determinism, seed sensitivity,
 *    kind separation, day off-state, the 02:00-vs-14:00 handoff metric).
 *
 * Rules that keep it honest:
 *  - Every decision is a pure function of (bid, world seed, hour, row, col).
 *    There is no Math.random anywhere, so the same seed reproduces the exact
 *    same city and a different seed only reshuffles which windows are lit —
 *    it cannot move buildings or change their classification.
 *  - Occupancy moves smoothly with the hour (control points, smoothstep).
 *    A window can flip state at most a couple of times a day, and brightness
 *    ramps through the same `practicals` curve as the sky, so there is no
 *    rapid flicker by construction.
 *  - At 14:00 the practicals factor is zero and every window is off.
 *
 * The shader mirrors these exact functions with 32-bit integer hashing, so a
 * screenshot is reproducible per GPU family. Values that differ only in GPU
 * float rounding are invisible; the properties tested here (state changes,
 * coverage, thresholds) hold on every machine.
 */

/** Hours, 0..24, matching the daycycle clock. */
export type Hour = number

/**
 * The five observable night personalities plus the dark and mixed buckets.
 * Plain consts (no enum): this module is imported raw by the node build
 * script, and type-stripping node only supports erasable syntax.
 */
export const BuildingKind = {
  /** No classification — commercial/residential blend. */
  MIXED: 0,
  RESIDENTIAL: 1,
  OFFICE: 2,
  HOTEL: 3,
  RETAIL: 4,
  INDUSTRIAL: 5,
  /** Never lit: sheds, garages, construction, stations, transit plant. */
  DARK: 6,
} as const

export type BuildingKindValue = (typeof BuildingKind)[keyof typeof BuildingKind]

export const KIND_COUNT = 7

export const KIND_LABEL: Record<number, string> = {
  [BuildingKind.MIXED]: 'mixed',
  [BuildingKind.RESIDENTIAL]: 'residential',
  [BuildingKind.OFFICE]: 'office',
  [BuildingKind.HOTEL]: 'hotel',
  [BuildingKind.RETAIL]: 'retail',
  [BuildingKind.INDUSTRIAL]: 'industrial',
  [BuildingKind.DARK]: 'dark',
}

/** Ground level of the island's street grid, metres (ROAD meshes sit at 12.05). */
export const CITY_GROUND_Y = 12

/** Storey height used to turn world Y into a floor index. */
export const FLOOR_HEIGHT = 3

/** Default window-column spacing, metres, before per-kind/per-building jitter. */
export const WINDOW_COLUMN_SPACING = 3.3

/** The island is always built with this seed unless a capture overrides it. */
export const DEFAULT_WORLD_SEED = 0x5eedc7a3

/* ------------------------------------------------------------------ hashing */

/** 32-bit integer avalanche hash. Deterministic, no state, Math.imul-stable. */
export function hashU32(x: number): number {
  let h = x >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h ^= h >>> 16
  return h >>> 0
}

/** Mix a seed and a few integers into one 32-bit hash. */
export function hashMix(seed: number, ...parts: number[]): number {
  let h = seed >>> 0
  for (let i = 0; i < parts.length; i++) {
    h = Math.imul(h ^ (parts[i] >>> 0), 0x9e3779b1)
  }
  return hashU32(h)
}

/** Unit value in [0,1) from a mixed hash. */
export function hash01(seed: number, ...parts: number[]): number {
  return hashMix(seed, ...parts) / 4294967296
}

/** Stable per-building seed: id mixed with the world seed. */
export function buildingSeed(bid: number, worldSeed: number): number {
  return hashMix(worldSeed, bid) | 1
}

/** Cell index for a world coordinate on the facade grid. */
export function gridCell(v: number, spacing: number): number {
  return Math.floor(v / spacing)
}

/* --------------------------------------------------------------- occupancy */

/** Smoothstep interpolation between occupancy control points. */
export interface OccupancyPoint {
  hour: Hour
  value: number
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Occupancy curves per kind: what fraction of windows are occupied at an
 * hour, before density and floor bias. These are the 24/7 character of the
 * city — hotels never sleep, offices empty at 2 am, tenements stay lit.
 */
export const OCCUPANCY_CURVES: Record<number, OccupancyPoint[]> = {
  [BuildingKind.RESIDENTIAL]: [
    { hour: 0, value: 0.72 },
    { hour: 2, value: 0.66 },
    { hour: 4.5, value: 0.55 },
    { hour: 6.5, value: 0.3 },
    { hour: 9, value: 0.22 },
    { hour: 15, value: 0.24 },
    { hour: 18, value: 0.42 },
    { hour: 21, value: 0.78 },
    { hour: 23.5, value: 0.74 },
  ],
  [BuildingKind.OFFICE]: [
    { hour: 0, value: 0.09 },
    { hour: 3, value: 0.06 },
    { hour: 6.5, value: 0.08 },
    { hour: 9, value: 0.55 },
    { hour: 13, value: 0.62 },
    { hour: 17, value: 0.58 },
    { hour: 19.5, value: 0.3 },
    { hour: 22, value: 0.13 },
    { hour: 24, value: 0.09 },
  ],
  [BuildingKind.HOTEL]: [
    { hour: 0, value: 0.88 },
    { hour: 6, value: 0.84 },
    { hour: 11, value: 0.8 },
    { hour: 18, value: 0.82 },
    { hour: 24, value: 0.88 },
  ],
  [BuildingKind.RETAIL]: [
    { hour: 0, value: 0.08 },
    { hour: 6, value: 0.06 },
    { hour: 9, value: 0.45 },
    { hour: 13, value: 0.6 },
    { hour: 18, value: 0.72 },
    { hour: 21, value: 0.55 },
    { hour: 23.5, value: 0.22 },
  ],
  [BuildingKind.INDUSTRIAL]: [
    { hour: 0, value: 0.14 },
    { hour: 4, value: 0.12 },
    { hour: 7, value: 0.32 },
    { hour: 12, value: 0.4 },
    { hour: 17, value: 0.38 },
    { hour: 20, value: 0.24 },
    { hour: 24, value: 0.14 },
  ],
  [BuildingKind.MIXED]: [
    { hour: 0, value: 0.5 },
    { hour: 2, value: 0.42 },
    { hour: 5, value: 0.3 },
    { hour: 7, value: 0.22 },
    { hour: 12, value: 0.3 },
    { hour: 17, value: 0.38 },
    { hour: 21, value: 0.68 },
    { hour: 23.5, value: 0.58 },
  ],
  [BuildingKind.DARK]: [{ hour: 0, value: 0 }, { hour: 24, value: 0 }],
}

/** Night factor from the day-cycle clock: 1 at night, 0 in daylight. */
export function nightFactor(hour: Hour): number {
  const h = ((hour % 24) + 24) % 24
  // Dawn ramp 4.5-6.5, dusk ramp 18.5-20.5 — the same shoulders as skyAt.
  return 1 - smoothstep(4.5, 6.5, h) + smoothstep(18.5, 20.5, h)
}

/** Occupancy of a kind at an hour: control-point interpolation × night. */
export function occupancyAt(kind: number, hour: Hour): number {
  const curve = OCCUPANCY_CURVES[kind]
  if (!curve) return 0
  const h = ((hour % 24) + 24) % 24
  let a = curve[0]
  let b = curve[curve.length - 1]
  for (let i = 0; i < curve.length - 1; i++) {
    if (h >= curve[i].hour && h <= curve[i + 1].hour) {
      a = curve[i]
      b = curve[i + 1]
      break
    }
  }
  const t = a.hour === b.hour ? 1 : smoothstep(a.hour, b.hour, h)
  return a.value + (b.value - a.value) * t
}

/**
 * Full window occupancy: occupancy × density, shaped per floor.
 * `row` is the storey index (0 = ground). Residential towers get quieter
 * upper floors, hotels never do.
 */
export function litThreshold(
  kind: number,
  hour: Hour,
  density: number,
  row: number,
): number {
  const base = occupancyAt(kind, hour) * density
  if (row <= 0) return base
  switch (kind) {
    case BuildingKind.RESIDENTIAL:
      return base * (1 - 0.18 * smoothstep(18, 32, row))
    case BuildingKind.OFFICE:
      // Executive floors and mechanical tops sit dark late.
      return base * (1 - 0.45 * smoothstep(24, 40, row))
    case BuildingKind.HOTEL:
      return base
    default:
      return base
  }
}

/* ------------------------------------------------------------- per-building */

export interface BuildingLightingData {
  bid: number
  kind: number
  /** Ground storey is a lit storefront/lobby band. */
  storefront: boolean
  /** Interior service floors that stay lit all night. */
  coreGlow: boolean
  /** Window density in 0..1 (before occupancy). */
  density: number
  /** Window fill within a cell in 0..1. */
  floorFill: number
}

/**
 * Unpack one RGBA texel (kind, flags, density, floorFill) from the data
 * texture bytes. Non-finite or out-of-range bytes fall back to residential —
 * a corrupt texel must dim a building, never make it strobe.
 */
export function unpackBuildingData(
  r: number,
  g: number,
  b: number,
  a: number,
): Omit<BuildingLightingData, 'bid'> {
  const kind = r >= 0 && r < KIND_COUNT ? r : BuildingKind.RESIDENTIAL
  const density = Number.isFinite(b)
    ? 0.3 + Math.min(255, Math.max(0, b)) * 0.006
    : 0.6
  const floorFill = Number.isFinite(a)
    ? 0.2 + Math.min(255, Math.max(0, a)) * 0.007
    : 0.6
  const flags = Number.isFinite(g) ? g : 0
  return {
    kind,
    storefront: (flags & 1) === 1,
    coreGlow: (flags & 2) === 2,
    density,
    floorFill,
  }
}

/**
 * Pack one building's data into an RGBA byte row for the shader texture.
 * Inverse of {@link unpackBuildingData}.
 */
export function packBuildingData(data: Omit<BuildingLightingData, 'bid'>): [
  number, number, number, number,
] {
  const kind = data.kind >= 0 && data.kind < KIND_COUNT ? data.kind : BuildingKind.RESIDENTIAL
  const flags = (data.storefront ? 1 : 0) | (data.coreGlow ? 2 : 0)
  const density = Math.round((Math.min(1, Math.max(0.3, data.density)) - 0.3) / 0.006)
  const floorFill = Math.round((Math.min(1, Math.max(0.2, data.floorFill)) - 0.2) / 0.007)
  return [kind, flags, density, floorFill]
}

/* ------------------------------------------------------------ window model */

export interface WindowCell {
  row: number
  col: number
}

/** Whether a single window cell emits light at an hour. */
export function windowLit(
  bid: number,
  data: Omit<BuildingLightingData, 'bid'>,
  worldSeed: number,
  hour: Hour,
  cell: WindowCell,
): boolean {
  if (data.kind === BuildingKind.DARK) return false
  if (nightFactor(hour) <= 0) return false
  const seed = buildingSeed(bid, worldSeed)
  const threshold = litThreshold(data.kind, hour, data.density, cell.row)
  if (threshold <= 0) return false
  // Service cores and stairwells stay lit regardless of occupancy.
  if (data.coreGlow && hash01(seed, cell.row, 0x5343) < 0.3) return true
  if (hash01(seed, cell.row, 0x5354) < 0.08) return true
  return hash01(seed, cell.row, cell.col) < threshold * data.floorFill
}

/** Reference sample geometry for the coverage metric and tests. */
export interface CoverageSample {
  buildings: number[]
  floors: number
  columns: number
}

export const COVERAGE_SAMPLE: CoverageSample = {
  // Every 7th building id covers the island's whole mix deterministically.
  buildings: Array.from({ length: Math.floor(56476 / 7) }, (_, i) => i * 7),
  floors: 26,
  columns: 24,
}

/** Fraction of the reference window sample emitting light at an hour. */
export function coverageAt(
  hour: Hour,
  lookup: (bid: number) => Omit<BuildingLightingData, 'bid'>,
  sample: CoverageSample = COVERAGE_SAMPLE,
  worldSeed: number = DEFAULT_WORLD_SEED,
): number {
  let lit = 0
  let total = 0
  for (const bid of sample.buildings) {
    const data = lookup(bid)
    for (let row = 0; row < sample.floors; row++) {
      for (let col = 0; col < sample.columns; col++) {
        total++
        if (windowLit(bid, data, worldSeed, hour, { row, col })) lit++
      }
    }
  }
  return total > 0 ? lit / total : 0
}

/**
 * The documented Phase 3C handoff metric: the practical coverage ratio (PCR)
 * at two fixed hours. PCR(day) is 0 by the daytime off-state, so the
 * normalised delta is 1.0 — comfortably above the 0.40 handoff floor.
 */
export function handoffMetric(
  nightHour: Hour,
  dayHour: Hour,
  lookup: (bid: number) => Omit<BuildingLightingData, 'bid'>,
  sample: CoverageSample = COVERAGE_SAMPLE,
  worldSeed: number = DEFAULT_WORLD_SEED,
): { nightCoverage: number; dayCoverage: number; delta: number } {
  const night = coverageAt(nightHour, lookup, sample, worldSeed)
  const day = coverageAt(dayHour, lookup, sample, worldSeed)
  const denominator = Math.max(night, 0.02)
  return { nightCoverage: night, dayCoverage: day, delta: (night - day) / denominator }
}

/**
 * Deterministic fallback when the data texture has not arrived: a benign
 * residential default for every building. Keeps the city lit and testable
 * without the CSV, and stops the shader from needing a code path for missing
 * data.
 */
export function defaultBuildingData(
  bid: number,
  worldSeed: number = DEFAULT_WORLD_SEED,
): Omit<BuildingLightingData, 'bid'> {
  const seed = buildingSeed(bid, worldSeed)
  return {
    kind: BuildingKind.RESIDENTIAL,
    storefront: hash01(seed, 0x5f1) < 0.4,
    coreGlow: false,
    density: 0.55 + hash01(seed, 0x5f2) * 0.25,
    floorFill: 0.55 + hash01(seed, 0x5f3) * 0.3,
  }
}
