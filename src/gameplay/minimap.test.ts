import { describe, expect, it } from 'vitest'
import { MINIMAP_BOUNDS, minimapHeading, minimapPoint, minimapRect } from './minimap'

describe('minimap projection', () => {
  it('places the north-west and south-east bounds at opposite corners', () => {
    expect(minimapPoint({ x: MINIMAP_BOUNDS.minX, z: MINIMAP_BOUNDS.minZ })).toEqual({
      left: 0,
      top: 0,
      clamped: false,
    })
    expect(minimapPoint({ x: MINIMAP_BOUNDS.maxX, z: MINIMAP_BOUNDS.maxZ })).toEqual({
      left: 100,
      top: 100,
      clamped: false,
    })
  })

  it('clamps off-map markers to a visible edge', () => {
    expect(minimapPoint({ x: 999, z: -999 })).toEqual({
      left: 100,
      top: 0,
      clamped: true,
    })
  })

  it('projects a box from its world-space footprint', () => {
    const box = minimapRect({ x: 0, z: 57.5, width: 52, depth: 195 })
    expect(box.left).toBe(25)
    expect(box.top).toBe(0)
    expect(box.width).toBe(50)
    expect(box.height).toBe(100)
  })

  it('uses north-up clockwise heading conventions', () => {
    expect(minimapHeading({ x: 0, z: -1 })).toBeCloseTo(0)
    expect(minimapHeading({ x: 1, z: 0 })).toBeCloseTo(90)
    expect(Math.abs(minimapHeading({ x: 0, z: 1 }))).toBeCloseTo(180)
    expect(minimapHeading({ x: -1, z: 0 })).toBeCloseTo(-90)
    expect(minimapHeading({ x: 0, z: 0 })).toBe(0)
  })
})
