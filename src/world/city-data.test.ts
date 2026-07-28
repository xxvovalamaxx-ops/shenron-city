import { describe, expect, it } from 'vitest'
import {
  AMBIENT_ROUTES,
  CITY_OBSTACLES,
  MARKET_STALLS,
  STREET_PROPS,
  STOREFRONTS,
  validateCityData,
} from './city-data'

describe('city district data', () => {
  it('passes its shared geometry, collision and route validation', () => {
    expect(validateCityData()).toEqual([])
  })

  it('keeps every rendered solid represented in collision data', () => {
    const obstacleIds = new Set(CITY_OBSTACLES.map((box) => box.id))

    for (const solid of [...STOREFRONTS, ...MARKET_STALLS, ...STREET_PROPS]) {
      expect(obstacleIds.has(solid.id)).toBe(true)
    }
  })

  it('keeps every street prop inside a sidewalk and out of the road', () => {
    for (const prop of STREET_PROPS) {
      expect(Math.abs(prop.x) - prop.width / 2).toBeGreaterThan(7.5)
      expect(prop.z - prop.depth / 2).toBeGreaterThanOrEqual(34)
      expect(prop.z + prop.depth / 2).toBeLessThanOrEqual(150)
    }
  })

  it('provides multiple closed ambient walking loops', () => {
    expect(AMBIENT_ROUTES.length).toBeGreaterThanOrEqual(3)
    for (const route of AMBIENT_ROUTES) {
      expect(route.points.length).toBeGreaterThanOrEqual(3)
    }
  })
})
