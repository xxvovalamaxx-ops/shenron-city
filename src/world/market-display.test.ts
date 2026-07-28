import { describe, expect, it } from 'vitest'
import { MARKET_STALLS } from './city-data'
import {
  MARKET_DISPLAYS,
  marketDisplayFor,
  validateMarketDisplays,
} from './market-display'

describe('night market displays', () => {
  it('gives every authored stall one reviewed inventory identity', () => {
    expect(validateMarketDisplays()).toEqual([])
    expect(Object.keys(MARKET_DISPLAYS)).toHaveLength(MARKET_STALLS.length)
    expect(new Set(Object.values(MARKET_DISPLAYS).map((display) => display.kind)).size).toBe(
      MARKET_STALLS.length,
    )
  })

  it('fails closed instead of rendering an empty anonymous stall', () => {
    expect(() => marketDisplayFor('stall-missing')).toThrow(
      'Missing market display for stall-missing',
    )
  })
})
