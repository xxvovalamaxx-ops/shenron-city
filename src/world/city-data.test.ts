import { describe, expect, it } from 'vitest'
import {
  AMBIENT_ROUTES,
  CITY_OBSTACLES,
  MARKET_STALLS,
  STOREFRONTS,
  validateCityData,
} from './city-data'

describe('city district data', () => {
  it('passes its shared geometry, collision and route validation', () => {
    expect(validateCityData()).toEqual([])
  })

  it('keeps every rendered solid represented in collision data', () => {
    const obstacleIds = new Set(CITY_OBSTACLES.map((box) => box.id))

    for (const solid of [...STOREFRONTS, ...MARKET_STALLS]) {
      expect(obstacleIds.has(solid.id)).toBe(true)
    }
  })

  it('provides multiple closed ambient walking loops', () => {
    expect(AMBIENT_ROUTES.length).toBeGreaterThanOrEqual(3)
    for (const route of AMBIENT_ROUTES) {
      expect(route.points.length).toBeGreaterThanOrEqual(3)
    }
  })
})
