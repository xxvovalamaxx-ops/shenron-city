import { describe, expect, it } from 'vitest'
import { HELI_HEARING, heliPlacement } from './heli-audio'

const listener = { pos: { x: 0, y: 12, z: 0 }, forward: { x: 0, z: 1 } }

describe('helicopter sound placement', () => {
  it('is loud overhead and centred', () => {
    const p = heliPlacement({ x: 0, y: 74, z: 0 }, listener)
    expect(p.gain).toBeGreaterThan(0.6)
    expect(Math.abs(p.pan)).toBeLessThan(0.05)
  })

  it('fades with distance and is silent past hearing range', () => {
    const near = heliPlacement({ x: 60, y: 74, z: 0 }, listener).gain
    const far = heliPlacement({ x: 300, y: 74, z: 0 }, listener).gain
    expect(far).toBeLessThan(near)
    expect(heliPlacement({ x: HELI_HEARING + 10, y: 12, z: 0 }, listener).gain).toBe(0)
  })

  it('pans toward the side it is on', () => {
    // facing +Z, right is -X
    expect(heliPlacement({ x: -200, y: 74, z: 0 }, listener).pan).toBeGreaterThan(0.3)
    expect(heliPlacement({ x: 200, y: 74, z: 0 }, listener).pan).toBeLessThan(-0.3)
  })
})
