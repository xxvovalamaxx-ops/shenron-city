import { PARK_NATURE, STREET_TREES } from './city-data'

export type GroundCoverKind = 'short-grass' | 'tall-grass' | 'fern' | 'flower'

export interface GroundCoverInstance {
  x: number
  z: number
  scale: number
  yaw: number
  phase: number
  kind: GroundCoverKind
}

export const POCKET_PARK_BOUNDS = {
  minX: -27.55,
  maxX: -12.45,
  minZ: 39.15,
  maxZ: 58.85,
} as const

export const POCKET_PARK_RING = {
  x: -20,
  z: 49,
  innerRadius: 4.18,
  outerRadius: 5.34,
} as const

interface Exclusion {
  x: number
  z: number
  radius: number
}

export const GROUND_COVER_EXCLUSIONS: readonly Exclusion[] = [
  ...STREET_TREES.map((tree) => ({
    x: tree.x,
    z: tree.z,
    radius: Math.max(0.78, tree.scale * 0.86),
  })),
  ...PARK_NATURE.map((feature) => ({
    x: feature.x,
    z: feature.z,
    radius: Math.max(feature.width, feature.depth) * 0.62,
  })),
]

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function clusterMask(x: number, z: number): number {
  const wave =
    Math.sin(x * 0.91 + 1.7) +
    Math.cos(z * 0.73 - 0.4) +
    Math.sin((x + z) * 0.41 + 2.2)
  return Math.max(0, Math.min(1, 0.5 + wave * 0.145))
}

function isExcluded(x: number, z: number): boolean {
  const ringDistance = Math.hypot(x - POCKET_PARK_RING.x, z - POCKET_PARK_RING.z)
  if (
    ringDistance > POCKET_PARK_RING.innerRadius &&
    ringDistance < POCKET_PARK_RING.outerRadius
  ) {
    return true
  }

  return GROUND_COVER_EXCLUSIONS.some(
    (exclusion) => Math.hypot(x - exclusion.x, z - exclusion.z) < exclusion.radius,
  )
}

function chooseKind(random: () => number, mask: number): GroundCoverKind {
  const roll = random()
  if (roll < 0.045 && mask > 0.62) return 'flower'
  if (roll < 0.18 && mask > 0.55) return 'fern'
  if (roll < 0.47) return 'tall-grass'
  return 'short-grass'
}

/**
 * Deterministic clustered park scatter.
 *
 * Render-only micro vegetation deliberately has no collider. The ring path,
 * tree bases, rocks and bushes are excluded so visuals cannot contradict
 * walkable space or overlap the park's structural assets.
 */
export function generateGroundCover(count: number, seed = 0x5a3e_2026): GroundCoverInstance[] {
  const requested = Math.max(0, Math.floor(count))
  const random = mulberry32(seed)
  const instances: GroundCoverInstance[] = []
  const maxAttempts = Math.max(1_000, requested * 90)

  for (let attempt = 0; attempt < maxAttempts && instances.length < requested; attempt += 1) {
    const x =
      POCKET_PARK_BOUNDS.minX +
      random() * (POCKET_PARK_BOUNDS.maxX - POCKET_PARK_BOUNDS.minX)
    const z =
      POCKET_PARK_BOUNDS.minZ +
      random() * (POCKET_PARK_BOUNDS.maxZ - POCKET_PARK_BOUNDS.minZ)

    if (isExcluded(x, z)) continue

    const mask = clusterMask(x, z)
    if (random() > 0.22 + mask * 0.78) continue

    const kind = chooseKind(random, mask)
    const kindScale =
      kind === 'fern' ? 1.16 : kind === 'flower' ? 0.9 : kind === 'tall-grass' ? 1.08 : 0.84
    instances.push({
      x,
      z,
      kind,
      scale: kindScale * (0.72 + random() * 0.56) * (0.88 + mask * 0.22),
      yaw: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
    })
  }

  if (instances.length !== requested) {
    throw new Error(`Ground-cover scatter exhausted after ${instances.length}/${requested} points`)
  }

  return instances
}
