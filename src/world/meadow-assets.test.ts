import { describe, expect, it } from 'vitest'
import { MEADOW_RUNTIME_PATHS, MEADOW_TEXTURES } from './meadow-assets'

describe('meadow runtime assets', () => {
  it('keeps the exact reviewed biome layers', () => {
    expect(Object.keys(MEADOW_TEXTURES)).toEqual([
      'forestGround',
      'brownMudLeaves',
      'mediumGrass',
      'fern',
      'weed',
    ])
  })

  it('uses unique same-origin WebP paths only', () => {
    expect(new Set(MEADOW_RUNTIME_PATHS).size).toBe(MEADOW_RUNTIME_PATHS.length)
    for (const path of MEADOW_RUNTIME_PATHS) {
      expect(path).toMatch(
        /^\/textures\/nature\/meadow\/[a-z0-9-]+\.webp\?v=[a-f0-9]{8}$/,
      )
      expect(path).not.toMatch(/^https?:/)
    }
  })
})
