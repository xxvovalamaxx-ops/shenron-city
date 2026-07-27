import { describe, expect, it } from 'vitest'
import { loopLength, sampleLoop } from './ambient-routes'

const SQUARE = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
] as const

describe('ambient pedestrian routes', () => {
  it('includes the closing segment in loop length', () => {
    expect(loopLength(SQUARE)).toBe(40)
  })

  it('samples a constant-distance position and heading', () => {
    expect(sampleLoop(SQUARE, 15)).toEqual({
      x: 10,
      z: 5,
      heading: 0,
    })
  })

  it('wraps positive and negative distances', () => {
    expect(sampleLoop(SQUARE, 45)).toEqual(sampleLoop(SQUARE, 5))
    expect(sampleLoop(SQUARE, -5)).toEqual(sampleLoop(SQUARE, 35))
  })
})
