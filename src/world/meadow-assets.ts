export interface MeadowTextureSet {
  albedo: string
  alpha?: string
  normal?: string
  roughness?: string
}

/** Reviewed, same-origin runtime subset generated from the pinned CC0 sources. */
export const MEADOW_TEXTURES = {
  forestGround: {
    albedo: '/textures/nature/meadow/forest-ground-04-albedo.webp?v=f0e8778f',
    normal: '/textures/nature/meadow/forest-ground-04-normal.webp?v=0835d9c9',
    roughness:
      '/textures/nature/meadow/forest-ground-04-roughness.webp?v=34184b1c',
  },
  brownMudLeaves: {
    albedo:
      '/textures/nature/meadow/brown-mud-leaves-01-albedo.webp?v=b26774b3',
    normal:
      '/textures/nature/meadow/brown-mud-leaves-01-normal.webp?v=b462d5a8',
  },
  mediumGrass: {
    albedo: '/textures/nature/meadow/grass-medium-01-albedo.webp?v=842b997b',
    alpha: '/textures/nature/meadow/grass-medium-01-alpha.webp?v=bdb5203e',
  },
  fern: {
    albedo: '/textures/nature/meadow/fern-02-albedo.webp?v=50a288dc',
    alpha: '/textures/nature/meadow/fern-02-alpha.webp?v=966e07c9',
  },
  weed: {
    albedo: '/textures/nature/meadow/weed-plant-02-albedo.webp?v=850ce203',
    alpha: '/textures/nature/meadow/weed-plant-02-alpha.webp?v=8ef73698',
  },
} as const satisfies Record<string, MeadowTextureSet>

export const MEADOW_RUNTIME_PATHS = Object.values(MEADOW_TEXTURES).flatMap(
  (textureSet) => Object.values(textureSet),
)
