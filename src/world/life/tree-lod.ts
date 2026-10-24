/**
 * Tree LOD bands and species choice — the pure half of tree-field.ts.
 *
 * Three representations, crossfaded by screen-door dither so nothing pops:
 *
 *   near   full tree (twigs, ~400 cards), casts shadows       < NEAR_R
 *   mid    scaffolds + ~120 large cards                         < MID_R
 *   far    a camera-facing impostor baked from the near tree    < FAR_R
 *
 * The weights here are the same smoothsteps the shaders evaluate per
 * instance, so the CPU lists (which only need to be conservative) and the
 * GPU fade agree.
 */

export const NEAR_R = 58
export const NEAR_FADE = 7
export const MID_R = 240
export const MID_FADE = 30
export const FAR_R = 2600

/** Species keys in the order their impostor rows are baked. */
export const SPECIES_ORDER = ['plane', 'locust', 'pinoak', 'ginkgo', 'pine', 'elm', 'oak'] as const
export type SpeciesKey = (typeof SPECIES_ORDER)[number]

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Share of the pixels each LOD draws at ground distance `d` (sums to 1). */
export function lodWeights(d: number): { near: number; mid: number; far: number } {
  const toMid = smoothstep(NEAR_R - NEAR_FADE, NEAR_R + NEAR_FADE, d)
  const toFar = smoothstep(MID_R - MID_FADE, MID_R + MID_FADE, d)
  const near = 1 - toMid
  const far = toFar
  return { near, mid: Math.max(0, 1 - near - far), far }
}

/** Integer hash (lowbias32). */
export function treeHash(n: number): number {
  let x = (n | 0) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b) >>> 0
  x ^= x >>> 16
  return x >>> 0
}

function pickWeighted(r: number, table: ReadonlyArray<readonly [SpeciesKey, number]>): SpeciesKey {
  let total = 0
  for (const [, w] of table) total += w
  let x = r * total
  for (const [k, w] of table) {
    x -= w
    if (x < 0) return k
  }
  return table[table.length - 1][0]
}

// NYC street-tree census, roughly: London plane and honey locust dominate,
// then pin oak; the forestry "column" genera are mostly ginkgo and pear.
const STREET_BROAD = [['plane', 0.42], ['locust', 0.33], ['pinoak', 0.25]] as const
const STREET_COLUMN = [['ginkgo', 0.75], ['pinoak', 0.25]] as const
// Central Park's canopy: elms along the Mall, oaks and planes, some pines.
const PARK = [['elm', 0.27], ['oak', 0.3], ['plane', 0.16], ['locust', 0.1], ['pine', 0.17]] as const

/** Species for a street tree from its forestry variant byte (0 broad, 1 column, 2 conifer). */
export function streetSpecies(variant: number, seed: number): SpeciesKey {
  const r = treeHash(seed * 2654435761) / 4294967296
  if (variant === 2) return 'pine'
  if (variant === 1) return pickWeighted(r, STREET_COLUMN)
  return pickWeighted(r, STREET_BROAD)
}

export function parkSpecies(seed: number): SpeciesKey {
  return pickWeighted(treeHash(seed * 40503 + 17) / 4294967296, PARK)
}

/**
 * Street-tree scale from the props.bin scale byte (x 0.02). The byte was
 * derived from trunk diameter, median ~0.84; a median street tree comes out
 * at about four fifths of its species' reference height.
 */
export function streetScale(scaleByte: number): number {
  const s = (scaleByte * 0.02) / 0.84
  return Math.min(1.3, Math.max(0.55, s)) * 0.8
}

/** Park-tree scale from the height of the placeholder cone it replaces. */
export function parkScale(coneHeight: number): number {
  return Math.min(1.25, Math.max(0.65, coneHeight / 10.3))
}
