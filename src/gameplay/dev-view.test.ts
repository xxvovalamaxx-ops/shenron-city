import { describe, expect, it } from 'vitest'
import { MARKET_KEEPER } from '../world/city-data'
import { HQ } from '../world/layout'
import { debugSpawnPosition, isDevInspection } from './dev-view'

describe('development visual inspection', () => {
  it('accepts only named anchors in development', () => {
    expect(debugSpawnPosition('?spawn=market', true)).toMatchObject({
      x: MARKET_KEEPER.x,
      z: MARKET_KEEPER.z + 2.7,
    })
    expect(debugSpawnPosition('?spawn=hq', true)?.y).toBeGreaterThan(HQ.y)
    expect(debugSpawnPosition('?spawn=12,34', true)).toBeNull()
  })

  it('is inert in production and without the explicit inspection flag', () => {
    expect(debugSpawnPosition('?spawn=market', false)).toBeNull()
    expect(isDevInspection('?inspect=1', true)).toBe(true)
    expect(isDevInspection('?inspect=1', false)).toBe(false)
    expect(isDevInspection('', true)).toBe(false)
  })
})
