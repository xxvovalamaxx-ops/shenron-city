import { describe, expect, it } from 'vitest'
import { STOREFRONTS } from './city-data'
import {
  buildingAssetFor,
  CITY_BUILDING_ASSETS,
  CITY_NATURE_ASSETS,
  CITY_VEHICLE_ASSETS,
  vehicleAssetFor,
} from './city-assets'

describe('audited city asset selection', () => {
  it('assigns an imported building to every authored storefront', () => {
    expect(STOREFRONTS.map((store) => buildingAssetFor(store.id))).toEqual(
      STOREFRONTS.map(
        (store) => CITY_BUILDING_ASSETS[store.id as keyof typeof CITY_BUILDING_ASSETS],
      ),
    )
  })

  it('cycles deterministic traffic variants', () => {
    expect(Array.from({ length: 8 }, (_, index) => vehicleAssetFor(index))).toEqual([
      ...CITY_VEHICLE_ASSETS,
      ...CITY_VEHICLE_ASSETS,
    ])
  })

  it('keeps approved nature roles distinct', () => {
    expect(new Set(Object.values(CITY_NATURE_ASSETS)).size).toBe(5)
  })
})
