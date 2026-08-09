import { describe, expect, it } from 'vitest'

import {
  GeoTransform,
  GeoTransformValidationError,
  internationalFeetToMeters,
  metersToInternationalFeet,
  metersToUsSurveyFeet,
  usSurveyFeetToMeters,
  validateWgs84Position,
  type GeoTransformConfig,
  type LocalMeters,
} from './GeoTransform'

const TIMES_SQUARE = {
  latitude: 40.758,
  longitude: -73.9855,
  elevationMeters: 12,
} as const

const BASE_CONFIG: GeoTransformConfig = {
  hqGeoAnchor: TIMES_SQUARE,
  hqWorldPosition: [0, 0, 0],
  localOriginMeters: [0, 0, 0],
  northYawDegrees: 0,
  worldUnitsPerMeter: 1,
}

function distance(a: LocalMeters, b: LocalMeters): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

describe('GeoTransform WGS84 tangent plane', () => {
  it('round-trips local points to within one centimetre across a 1 km HQ AOI', () => {
    const transform = new GeoTransform({
      ...BASE_CONFIG,
      localOriginMeters: [137.25, -4.5, -82.75],
    })
    const origin = transform.config.localOriginMeters
    const offsets: readonly LocalMeters[] = [
      [0, 0, 0],
      [500, 35, 500],
      [-500, -8, 500],
      [500, 120, -500],
      [-500, 2, -500],
    ]

    for (const offset of offsets) {
      const local: LocalMeters = [
        origin[0] + offset[0],
        origin[1] + offset[1],
        origin[2] + offset[2],
      ]
      const roundTrip = transform.geographicToLocal(transform.localToGeographic(local))
      expect(distance(roundTrip, local)).toBeLessThan(0.01)
    }
  })

  it('maps a real NYC coordinate with east-positive and north-positive axes', () => {
    const transform = new GeoTransform(BASE_CONFIG)
    // Bryant Park, southeast of the Times Square anchor.
    const bryantPark = transform.geographicToLocal({
      latitude: 40.753596,
      longitude: -73.983232,
      elevationMeters: 16,
    })

    expect(bryantPark[0]).toBeGreaterThan(185)
    expect(bryantPark[0]).toBeLessThan(195)
    expect(bryantPark[2]).toBeGreaterThan(-495)
    expect(bryantPark[2]).toBeLessThan(-485)
    expect(bryantPark[1]).toBeGreaterThan(3.9)
    expect(bryantPark[1]).toBeLessThan(4.1)

    const restored = transform.localToGeographic(bryantPark)
    expect(restored.latitude).toBeCloseTo(40.753596, 9)
    expect(restored.longitude).toBeCloseTo(-73.983232, 9)
    expect(restored.elevationMeters).toBeCloseTo(16, 4)
  })

  it('maps local north to negative world Z at zero yaw', () => {
    const transform = new GeoTransform(BASE_CONFIG)
    expect(transform.localToWorld([25, 4, 80])).toEqual([25, 4, -80])
    expect(transform.worldToLocal([25, 4, -80])).toEqual([25, 4, 80])
  })

  it('applies local origin, clockwise yaw, scale, and HQ world position reversibly', () => {
    const transform = new GeoTransform({
      ...BASE_CONFIG,
      hqWorldPosition: [100, 200, 300],
      localOriginMeters: [10, 20, 30],
      northYawDegrees: 90,
      worldUnitsPerMeter: 2,
    })

    expect(transform.geographicToLocal(TIMES_SQUARE)).toEqual([10, 20, 30])
    expect(transform.geographicToWorld(TIMES_SQUARE)).toEqual([100, 200, 300])

    const eastWorld = transform.localToWorld([11, 20, 30])
    const northWorld = transform.localToWorld([10, 20, 31])
    const upWorld = transform.localToWorld([10, 21, 30])
    expect(eastWorld[0]).toBeCloseTo(100, 12)
    expect(eastWorld[2]).toBeCloseTo(302, 12)
    expect(northWorld[0]).toBeCloseTo(102, 12)
    expect(northWorld[2]).toBeCloseTo(300, 12)
    expect(upWorld).toEqual([100, 202, 300])
    expect(distance(transform.worldToLocal(eastWorld), [11, 20, 30])).toBeLessThan(1e-10)
    expect(distance(transform.worldToLocal(northWorld), [10, 20, 31])).toBeLessThan(1e-10)
  })

  it('round-trips directly between geographic and world coordinates', () => {
    const transform = new GeoTransform({
      ...BASE_CONFIG,
      hqWorldPosition: [4_000, 12, -9_000],
      localOriginMeters: [-50, 3, 75],
      northYawDegrees: -29,
      worldUnitsPerMeter: 1.25,
    })
    const geographic = {
      latitude: 40.7608,
      longitude: -73.9802,
      elevationMeters: 31.5,
    }

    const restored = transform.worldToGeographic(transform.geographicToWorld(geographic))
    expect(restored.latitude).toBeCloseTo(geographic.latitude, 9)
    expect(restored.longitude).toBeCloseTo(geographic.longitude, 9)
    expect(restored.elevationMeters).toBeCloseTo(geographic.elevationMeters, 4)
  })
})

describe('GeoTransform validation', () => {
  it('rejects non-finite and out-of-range geographic coordinates', () => {
    expect(() => validateWgs84Position({
      latitude: Number.NaN,
      longitude: 0,
      elevationMeters: 0,
    })).toThrow(GeoTransformValidationError)
    expect(() => validateWgs84Position({
      latitude: 90.000001,
      longitude: 0,
      elevationMeters: 0,
    })).toThrow(/latitude/)
    expect(() => validateWgs84Position({
      latitude: 0,
      longitude: -180.000001,
      elevationMeters: 0,
    })).toThrow(/longitude/)
    expect(() => validateWgs84Position({
      latitude: 0,
      longitude: 0,
      elevationMeters: Number.POSITIVE_INFINITY,
    })).toThrow(/elevationMeters/)
  })

  it('rejects invalid scale, yaw, origins, and method inputs', () => {
    expect(() => new GeoTransform({ ...BASE_CONFIG, worldUnitsPerMeter: 0 })).toThrow(
      /greater than 0/,
    )
    expect(() => new GeoTransform({ ...BASE_CONFIG, worldUnitsPerMeter: -1 })).toThrow(
      /greater than 0/,
    )
    expect(() => new GeoTransform({
      ...BASE_CONFIG,
      northYawDegrees: Number.NaN,
    })).toThrow(/northYawDegrees/)
    expect(() => new GeoTransform({
      ...BASE_CONFIG,
      localOriginMeters: [0, Number.POSITIVE_INFINITY, 0],
    })).toThrow(/localOriginMeters/)
    expect(() => new GeoTransform({
      ...BASE_CONFIG,
      hqWorldPosition: [0, 0, Number.NaN],
    })).toThrow(/hqWorldPosition/)

    const transform = new GeoTransform(BASE_CONFIG)
    expect(() => transform.geographicToLocal({
      latitude: 40.75,
      longitude: 181,
      elevationMeters: 0,
    })).toThrow(/longitude/)
    expect(() => transform.localToWorld([0, Number.NaN, 0])).toThrow(/local/)
    expect(() => transform.worldToLocal([Number.POSITIVE_INFINITY, 0, 0])).toThrow(/world/)
  })
})

describe('survey unit conversion', () => {
  it('uses the exact 1200/3937 US-survey-foot definition', () => {
    expect(usSurveyFeetToMeters(3_937)).toBe(1_200)
    expect(metersToUsSurveyFeet(1_200)).toBe(3_937)
    expect(usSurveyFeetToMeters(1)).toBeCloseTo(0.3048006096012192, 15)
  })

  it('keeps international feet separate and rejects non-finite values', () => {
    expect(internationalFeetToMeters(1)).toBe(0.3048)
    expect(metersToInternationalFeet(0.3048)).toBe(1)
    expect(usSurveyFeetToMeters(1)).not.toBe(internationalFeetToMeters(1))
    expect(() => usSurveyFeetToMeters(Number.NaN)).toThrow(/finite/)
    expect(() => internationalFeetToMeters(Number.POSITIVE_INFINITY)).toThrow(/finite/)
  })
})
