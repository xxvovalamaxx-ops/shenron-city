/**
 * Who walks down a Manhattan pavement: outfit variants and their colours.
 *
 * Pure data and pure functions — no three.js — so the choice of body, the
 * clothes colours and the height of every pedestrian are a deterministic
 * function of the pedestrian's seed and can be unit tested.
 *
 * An outfit is assembled at load from the parts in the crowd GLBs
 * (scripts/blender/people/build_crowd.py). Each part carries a paint code per
 * vertex: region 1 skin, 2 hair, 3 top, 4 bottom, 5 shoes, 6 accent. The
 * runtime paints those regions per instance from the palettes below, so a
 * dozen meshes read as a few hundred different people.
 */

export type Gender = 'men' | 'women'

export interface CrowdVariant {
  key: string
  gender: Gender
  /** Part names in the gender's GLB, without the PART_ prefix. */
  parts: string[]
  /** Silhouette used past the near LOD (PROXY_<proxy>_L1 / _L2). */
  proxy: string
  /** Relative frequency on an ordinary street. */
  weight: number
  /** Palettes, sRGB hex. */
  tops: readonly number[]
  bottoms: readonly number[]
  shoes: readonly number[]
  accents: readonly number[]
  /** A suit's trousers match its jacket. */
  matchBottom?: boolean
}

// Muted city clothing. These are sRGB and the shader converts them to linear,
// so they have to be lighter than they look in a hex editor — the old crowd
// palette (everything between 0x1d and 0x5c) rendered as silhouettes.
const SUITS = [0x2a2f3a, 0x23262c, 0x3a3f47, 0x4a4f57, 0x2e3440, 0x3d3a36, 0x55504a, 0x1f2a3a, 0x6b6f75]
const SHIRTS = [0xe8e8e4, 0xdfe6ee, 0xc9d6e6, 0xe9e2d6, 0xf2f0ea, 0xd7dde0, 0xe3d3d3]
const CASUAL_TOPS = [
  0x2b2e33, 0x39414b, 0x4c5a68, 0x6e737a, 0x8b8175, 0x5d6f80, 0x7a6a5c, 0xb9bdc0,
  0xd8d6cf, 0xe2e0da, 0xa8b2b8, 0xc2b4a2, 0x8a4a46, 0x3f5d78, 0x4c6b52, 0x9a3b34,
  0x2f4f6f, 0xc9a66b, 0x6b4f7a, 0xd06a3a, 0x3b6e8f, 0xf0efe8,
]
const OUTERWEAR = [0x2b2e33, 0x3b3f46, 0x4a5058, 0x5b4636, 0x6f6352, 0x2f3b4c, 0x46503f, 0x7a2e2e, 0x8c8a84, 0x1f2126]
const DENIM = [0x3f5068, 0x4a5c74, 0x38455a, 0x2c3542, 0x5d7089, 0x6c7f96, 0x23262b]
const TROUSERS = [0x2c2f34, 0x232629, 0x3b3f46, 0x4d525a, 0x6f6857, 0x87806c, 0x5a5346, 0x74797f, 0x9a9ea2, 0x3f5068]
const SHORTS = [0x6f6857, 0x87806c, 0x3f5068, 0x5a6b4f, 0x2c2f34, 0x9a8f7a, 0x7b8894]
const SNEAKERS = [0xe9e9e6, 0xd9d9d6, 0x2a2b2e, 0x3a3d44, 0x8a8f96, 0xb03030, 0x2f4a78, 0xc8b89a]
const DRESS_SHOES = [0x1c1c1e, 0x241c17, 0x3a2a20, 0x2a2a2c]
const BOOTS = [0x1c1c1e, 0x3a2a20, 0x5b4128, 0x2a2a2c]
const DRESSES = [0x1f2228, 0x2d3a55, 0x7a2e3a, 0x3e5f4c, 0xb8a58a, 0x6e5a7e, 0xd9c7b0, 0x9a3b34, 0x2f5f7a, 0xe0ddd6, 0x5b6b3a]
const BAGS = [0x3b4a3a, 0x2c2f34, 0x5b4636, 0x3f5068, 0x7a2e2e, 0x55504a]
const HI_VIS = [0x4d525a, 0x6f6857, 0x3f5068]

/** Fitzpatrick-spread skin tones, sRGB. */
export const SKIN_TONES: readonly number[] = [
  0xe6bf9f, 0xdcb08c, 0xd3a07c, 0xc79068, 0xb57f58, 0x9e6b45, 0x86583a, 0x6f472d,
  0x5a3823, 0x472c1c,
]
/** Natural hair colours; the occasional dyed one is picked separately. */
export const HAIR_COLOURS: readonly number[] = [
  0x1a1410, 0x241a14, 0x2e2119, 0x3b2a1d, 0x4a3524, 0x6a4a30, 0x8a6a45, 0xb8955f,
  0xd6bf8a, 0x9a9a98, 0xcfcfcb, 0x161616,
]
const DYED_HAIR = [0x7a2e3a, 0x2f4a78, 0x6b4f7a, 0xb03030]

export const CROWD_VARIANTS: readonly CrowdVariant[] = [
  { key: 'm_suit', gender: 'men', parts: ['head_suit', 'body_suit', 'legs_suit', 'feet_suit', 'phone'], proxy: 'long', weight: 0.12, tops: SUITS, bottoms: SUITS, shoes: DRESS_SHOES, accents: SHIRTS, matchBottom: true },
  { key: 'm_suit_b', gender: 'men', parts: ['head_casual', 'body_suit', 'legs_suit', 'feet_suit', 'phone'], proxy: 'long', weight: 0.07, tops: SUITS, bottoms: SUITS, shoes: DRESS_SHOES, accents: SHIRTS, matchBottom: true },
  { key: 'm_tee', gender: 'men', parts: ['head_casual', 'body_tee', 'legs_jeans', 'feet_sneaker', 'phone'], proxy: 'short', weight: 0.11, tops: CASUAL_TOPS, bottoms: DENIM, shoes: SNEAKERS, accents: SHIRTS },
  { key: 'm_hoodie', gender: 'men', parts: ['head_short', 'body_hoodie', 'legs_jeans', 'feet_hoodie', 'phone'], proxy: 'long', weight: 0.09, tops: OUTERWEAR, bottoms: DENIM, shoes: SNEAKERS, accents: SHIRTS },
  { key: 'm_summer', gender: 'men', parts: ['head_long', 'body_tank', 'legs_shorts', 'feet_sneaker', 'phone'], proxy: 'short', weight: 0.04, tops: CASUAL_TOPS, bottoms: SHORTS, shoes: SNEAKERS, accents: SHIRTS },
  { key: 'm_backpack', gender: 'men', parts: ['head_suit', 'body_tee', 'legs_suit', 'feet_sneaker', 'backpack', 'phone'], proxy: 'short', weight: 0.05, tops: CASUAL_TOPS, bottoms: TROUSERS, shoes: SNEAKERS, accents: BAGS },
  { key: 'm_vest', gender: 'men', parts: ['head_short', 'body_vest', 'legs_ripped', 'feet_boot', 'phone'], proxy: 'long', weight: 0.05, tops: OUTERWEAR, bottoms: DENIM, shoes: BOOTS, accents: CASUAL_TOPS },
  { key: 'm_worker', gender: 'men', parts: ['head_worker', 'body_worker', 'legs_worker', 'feet_worker', 'phone'], proxy: 'short', weight: 0.02, tops: CASUAL_TOPS, bottoms: HI_VIS, shoes: BOOTS, accents: SHIRTS },
  { key: 'w_casual', gender: 'women', parts: ['head_bob', 'body_tee', 'legs_trousers', 'feet_flat', 'phone'], proxy: 'trousers', weight: 0.12, tops: CASUAL_TOPS, bottoms: TROUSERS.concat(DENIM), shoes: SNEAKERS, accents: SHIRTS },
  { key: 'w_dress', gender: 'women', parts: ['head_updo', 'body_dress', 'legs_dress', 'feet_heel', 'phone'], proxy: 'dress', weight: 0.09, tops: DRESSES, bottoms: DRESSES, shoes: DRESS_SHOES, accents: SHIRTS },
  { key: 'w_suit', gender: 'women', parts: ['head_bob', 'body_suit', 'legs_suit', 'feet_suit', 'phone'], proxy: 'trousers', weight: 0.08, tops: SUITS, bottoms: SUITS, shoes: DRESS_SHOES, accents: SHIRTS, matchBottom: true },
  { key: 'w_suit_b', gender: 'women', parts: ['head_updo', 'body_suit', 'legs_suit', 'feet_suit', 'phone'], proxy: 'trousers', weight: 0.05, tops: SUITS, bottoms: SUITS, shoes: DRESS_SHOES, accents: SHIRTS, matchBottom: true },
  { key: 'w_edgy', gender: 'women', parts: ['head_bob', 'body_crop', 'legs_leggings', 'feet_boot', 'phone'], proxy: 'trousers', weight: 0.05, tops: CASUAL_TOPS, bottoms: TROUSERS, shoes: BOOTS, accents: OUTERWEAR },
  { key: 'w_worker', gender: 'women', parts: ['head_worker', 'body_worker', 'legs_worker', 'feet_flat', 'phone'], proxy: 'trousers', weight: 0.01, tops: CASUAL_TOPS, bottoms: HI_VIS, shoes: BOOTS, accents: SHIRTS },
]

/** Integer hash (lowbias32). Stable across engines, unlike sin-based noise. */
export function hashU32(n: number): number {
  let x = (n | 0) >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b) >>> 0
  x ^= x >>> 16
  return x >>> 0
}

/** Deterministic 0..1 value for a seed and a salt. */
export function rand01(seed: number, salt: number): number {
  return hashU32((seed | 0) * 0x9e3779b1 + salt * 0x85ebca6b) / 4294967296
}

function pick<T>(list: readonly T[], r: number): T {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))]
}

/** Weighted variant index for a seed. */
export function pickVariant(seed: number, variants: readonly CrowdVariant[] = CROWD_VARIANTS): number {
  let total = 0
  for (const v of variants) total += v.weight
  let r = rand01(seed, 1) * total
  for (let i = 0; i < variants.length; i++) {
    r -= variants[i].weight
    if (r < 0) return i
  }
  return variants.length - 1
}

export interface CrowdLook {
  variant: number
  skin: number
  hair: number
  top: number
  bottom: number
  shoes: number
  accent: number
  /** Uniform scale on the ~1.86 m source body. */
  scale: number
}

/**
 * Everything visual about one pedestrian from its seed. Heights follow the
 * adult distributions (men 1.62–1.90 m, women 1.52–1.78 m); the source
 * bodies are both about 1.86 m tall to the crown.
 */
export function crowdLook(seed: number, variants: readonly CrowdVariant[] = CROWD_VARIANTS): CrowdLook {
  const variant = pickVariant(seed, variants)
  const v = variants[variant]
  const top = pick(v.tops, rand01(seed, 2))
  const bottom = v.matchBottom && rand01(seed, 3) < 0.85 ? top : pick(v.bottoms, rand01(seed, 4))
  const dyed = rand01(seed, 5) < 0.04
  const hair = dyed ? pick(DYED_HAIR, rand01(seed, 6)) : pick(HAIR_COLOURS, rand01(seed, 6))
  // two uniform draws summed: a gentle bell rather than a flat spread
  const h = (rand01(seed, 7) + rand01(seed, 8)) * 0.5
  const scale = v.gender === 'men' ? 0.87 + h * 0.15 : 0.82 + h * 0.14
  return {
    variant,
    skin: pick(SKIN_TONES, rand01(seed, 9)),
    hair,
    top,
    bottom,
    shoes: pick(v.shoes, rand01(seed, 10)),
    accent: pick(v.accents, rand01(seed, 11)),
    scale,
  }
}

/** 24-bit colour into a float an attribute can carry exactly. */
export function packRGB(hex: number): number {
  return hex & 0xffffff
}
