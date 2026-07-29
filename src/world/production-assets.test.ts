import { describe, expect, it } from 'vitest'
import {
  PRODUCTION_ASSETS,
  SKYLINE_LOD_DISTANCES,
  SKYLINE_PLACEMENTS,
} from './production-assets'

describe('production skyline assets', () => {
  it('declares near, middle, and far runtime assets in order', () => {
    expect(PRODUCTION_ASSETS.skylineLods).toEqual([
      '/assets/production/architecture/distant-skyline-lod0.glb',
      '/assets/production/architecture/distant-skyline-lod1.glb',
      '/assets/production/architecture/distant-skyline-lod2.glb',
    ])
    expect(SKYLINE_LOD_DISTANCES).toEqual([0, 175, 315])
  })

  it('surrounds the hero route without putting skyline geometry in its collision lane', () => {
    expect(SKYLINE_PLACEMENTS.map(({ id }) => id)).toEqual([
      'north',
      'north-west',
      'north-east',
      'west',
      'east',
    ])
    for (const placement of SKYLINE_PLACEMENTS) {
      expect(Math.hypot(placement.position[0], placement.position[2])).toBeGreaterThan(150)
      expect(placement.scale).toBeGreaterThanOrEqual(0.8)
    }
  })
})
