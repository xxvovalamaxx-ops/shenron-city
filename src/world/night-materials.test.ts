import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { getRoadNightMaterial, getBuildingNightMaterial, isCityNightMaterial } from './night-materials'

describe('getRoadNightMaterial', () => {
  it('does not read vertex colours, because roads have none', () => {
    // The defect: ROAD_* meshes carry only POSITION and NORMAL. With
    // vertexColors on, WebGL supplies the default (0,0,0,1) for the missing
    // attribute, diffuse becomes 0xffffff x black, and every road in the city
    // renders as a void. Verified against the shipped tiles — ROAD_+00_+00 has
    // no COLOR_0 while BLD_lowrise_+00_+00 does.
    const material = getRoadNightMaterial({ quality: 'high' })
    expect(material.vertexColors).toBe(false)
  })

  it('carries the exporter\'s asphalt colour rather than white', () => {
    // MAT_asphalt in the tile GLBs is linear 0.028 / 0.028 / 0.031. A white
    // base would be a different bug in the other direction.
    const material = getRoadNightMaterial({ quality: 'high' })
    const rgb = material.color.getRGB(
      { r: 0, g: 0, b: 0 },
      THREE.LinearSRGBColorSpace,
    )
    expect(rgb.r).toBeCloseTo(0.028, 3)
    expect(rgb.g).toBeCloseTo(0.028, 3)
    expect(rgb.b).toBeCloseTo(0.031, 3)
  })

  it('is never pure black — a road that renders as a void is the bug', () => {
    const material = getRoadNightMaterial({ quality: 'high' })
    const { r, g, b } = material.color
    expect(r + g + b).toBeGreaterThan(0)
  })

  it('is shared per quality preset, so tiles do not each build one', () => {
    const a = getRoadNightMaterial({ quality: 'high' })
    const b = getRoadNightMaterial({ quality: 'high' })
    expect(b).toBe(a)
  })

  it('is marked as owned by the city-night system, so tile disposal skips it', () => {
    // A shared material disposed with the first tile that unloads would take
    // every other road on the island with it.
    expect(isCityNightMaterial(getRoadNightMaterial({ quality: 'high' }))).toBe(true)
  })
})

describe('getBuildingNightMaterial', () => {
  it('does read vertex colours, because BLD_* meshes carry COLOR_0', () => {
    // The counterpart. Buildings genuinely have the attribute, so this one is
    // correct as it stands — the asymmetry is the point.
    expect(getBuildingNightMaterial({ quality: 'high' }).vertexColors).toBe(true)
  })

  it('is shared and marked like the road material', () => {
    const a = getBuildingNightMaterial({ quality: 'medium' })
    expect(getBuildingNightMaterial({ quality: 'medium' })).toBe(a)
    expect(isCityNightMaterial(a)).toBe(true)
  })
})
