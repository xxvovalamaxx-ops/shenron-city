/**
 * The facade shader's side of the city-lighting model.
 *
 * The shader no longer evaluates the occupancy curves per fragment: it reads
 * a per-frame table (occupancyTable) and thresholds a ported integer hash
 * against it (windowLitFromTable, mirrored line for line in
 * surfaces/city-glsl.ts). These tests hold that formulation to the original
 * tested model, so every determinism property proven in
 * city-lighting.test.ts carries over to what is on screen.
 */
import { describe, expect, it } from 'vitest'
import {
  BuildingKind,
  DEFAULT_WORLD_SEED,
  KIND_COUNT,
  OCCUPANCY_RETAIL_OPEN_SLOT,
  OCCUPANCY_TABLE_SIZE,
  RoomDressing,
  defaultBuildingData,
  hash01,
  hashMix,
  litThreshold,
  nightFactor,
  occupancyAt,
  occupancyTable,
  roomStyle,
  shapeRow,
  shutterClosed,
  shutterThreshold,
  windowLit,
  windowLitFromTable,
} from './city-lighting'
import { cityLightingUniforms, syncCityOccupancy } from './city-lighting-uniforms'
import { CITY_HASH_GLSL, CITY_WINDOW_GLSL } from './surfaces/city-glsl'

const KINDS = [
  BuildingKind.MIXED,
  BuildingKind.RESIDENTIAL,
  BuildingKind.OFFICE,
  BuildingKind.HOTEL,
  BuildingKind.RETAIL,
  BuildingKind.INDUSTRIAL,
  BuildingKind.DARK,
]

describe('occupancy table', () => {
  it('holds each kind at its curve by night and zero by day', () => {
    for (const hour of [0, 2, 5.5, 19.2, 21, 23.9]) {
      const table = occupancyTable(hour)
      expect(table.length).toBe(OCCUPANCY_TABLE_SIZE)
      for (let kind = 0; kind < KIND_COUNT; kind++) {
        const expected = nightFactor(hour) > 0 ? occupancyAt(kind, hour) : 0
        expect(table[kind]).toBeCloseTo(expected, 6)
      }
    }
    const noon = occupancyTable(14)
    for (let kind = 0; kind < KIND_COUNT; kind++) expect(noon[kind]).toBe(0)
  })

  it('carries the ungated retail curve for the shutters', () => {
    for (const hour of [2, 9, 14, 18, 22]) {
      expect(occupancyTable(hour)[OCCUPANCY_RETAIL_OPEN_SLOT]).toBeCloseTo(
        occupancyAt(BuildingKind.RETAIL, hour),
        6,
      )
    }
  })

  it('syncs into the shared uniform, and only when the hour moves', () => {
    syncCityOccupancy(2)
    const table = cityLightingUniforms.uCityOcc.value
    expect(table[BuildingKind.HOTEL]).toBeCloseTo(occupancyAt(BuildingKind.HOTEL, 2), 6)
    table[BuildingKind.HOTEL] = -1
    syncCityOccupancy(2) // same hour: untouched
    expect(table[BuildingKind.HOTEL]).toBe(-1)
    syncCityOccupancy(2.5)
    expect(table[BuildingKind.HOTEL]).toBeCloseTo(occupancyAt(BuildingKind.HOTEL, 2.5), 6)
  })

  it('factors the row shaping out of litThreshold unchanged', () => {
    for (const kind of KINDS) {
      for (const row of [0, 1, 10, 20, 30, 45]) {
        const direct = litThreshold(kind, 2, 0.8, row)
        expect(shapeRow(kind, occupancyAt(kind, 2) * 0.8, row)).toBeCloseTo(direct, 9)
      }
    }
  })
})

describe('shader window decision', () => {
  it('matches windowLit exactly for every kind, hour and cell sampled', () => {
    let lit = 0
    let total = 0
    for (const bid of [3, 4812, 56001]) {
      for (const kind of KINDS) {
        for (const coreGlow of [false, true]) {
          const data = { ...defaultBuildingData(bid), kind, coreGlow }
          for (const hour of [2, 6, 14, 19.4, 22.5]) {
            const table = occupancyTable(hour)
            for (let row = 0; row < 14; row++) {
              for (let col = -3; col < 7; col++) {
                const a = windowLit(bid, data, DEFAULT_WORLD_SEED, hour, { row, col })
                const b = windowLitFromTable(bid, data, DEFAULT_WORLD_SEED, table, { row, col })
                expect(b).toBe(a)
                total++
                if (a) lit++
              }
            }
          }
        }
      }
    }
    // the comparison covered both states, not just a dark city
    expect(lit).toBeGreaterThan(total * 0.05)
    expect(lit).toBeLessThan(total * 0.9)
  }, 30000)

  it('the shader float conversion stays within 2^-24 of hash01', () => {
    for (let i = 0; i < 2000; i++) {
      const h = hashMix(DEFAULT_WORLD_SEED, i, i * 31 - 7)
      const shader = (h >>> 8) / 16777216
      expect(Math.abs(shader - hash01(DEFAULT_WORLD_SEED, i, i * 31 - 7))).toBeLessThan(2 ** -24)
    }
  })

  it('the GLSL port carries the model constants', () => {
    // hashU32 multiplier, hashMix multiplier and shift, and the row salts of
    // windowLit — a drift in any of these would move lit windows.
    expect(CITY_HASH_GLSL).toContain('0x45d9f3bu')
    expect(CITY_HASH_GLSL).toContain('0x9e3779b1u')
    expect(CITY_HASH_GLSL).toContain('>> 16u')
    expect(CITY_WINDOW_GLSL).toContain('0x5343u')
    expect(CITY_WINDOW_GLSL).toContain('0x5354u')
    expect(CITY_WINDOW_GLSL).toContain('0x2f1u')
    expect(CITY_WINDOW_GLSL).toContain('0x5c7u')
    expect(CITY_WINDOW_GLSL).toContain('smoothstep( 18.0, 32.0, row )')
    expect(CITY_WINDOW_GLSL).toContain('smoothstep( 24.0, 40.0, row )')
  })
})

describe('room dressing', () => {
  const seed = 0x1234567 | 1

  it('is a pure function of the cell', () => {
    for (let row = 0; row < 10; row++) {
      for (let col = -5; col < 5; col++) {
        expect(roomStyle(seed, row, col)).toEqual(roomStyle(seed, row, col))
      }
    }
  })

  it('mixes bare glass, curtains, blinds and drawn curtains', () => {
    const counts = [0, 0, 0, 0]
    let n = 0
    for (let row = 0; row < 60; row++) {
      for (let col = 0; col < 60; col++) {
        const s = roomStyle(seed, row, col)
        counts[s.dressing]++
        n++
        expect(s.warmth).toBeGreaterThanOrEqual(0)
        expect(s.warmth).toBeLessThan(1)
        expect(s.wall).toBeGreaterThanOrEqual(0)
        expect(s.wall).toBeLessThan(6)
        expect(s.cover).toBeGreaterThanOrEqual(0)
        expect(s.cover).toBeLessThan(1)
      }
    }
    expect(counts[RoomDressing.OPEN] / n).toBeCloseTo(0.42, 1)
    expect(counts[RoomDressing.CURTAINS] / n).toBeCloseTo(0.24, 1)
    expect(counts[RoomDressing.BLINDS] / n).toBeCloseTo(0.22, 1)
    expect(counts[RoomDressing.DRAWN] / n).toBeCloseTo(0.12, 1)
  })
})

describe('shop shutters', () => {
  const seed = 0xbeef | 1

  it('more shops are shuttered at 3 am than at 6 pm', () => {
    let night = 0
    let evening = 0
    for (let shop = -200; shop < 200; shop++) {
      if (shutterClosed(seed, shop, 3)) night++
      if (shutterClosed(seed, shop, 18)) evening++
    }
    expect(night).toBeGreaterThan(evening * 2)
    expect(evening).toBeGreaterThan(0) // some are vacant all day
  })

  it('a shutter moves at most twice a day (down at night, up in the morning)', () => {
    for (let shop = 0; shop < 120; shop++) {
      let flips = 0
      let prev = shutterClosed(seed, shop, 0)
      for (let h = 0.1; h < 24; h += 0.1) {
        const now = shutterClosed(seed, shop, h)
        if (now !== prev) flips++
        prev = now
      }
      expect(flips).toBeLessThanOrEqual(2)
    }
  })

  it('threshold is bounded', () => {
    expect(shutterThreshold(0)).toBeCloseTo(0.7, 6)
    expect(shutterThreshold(0.72)).toBeCloseTo(0.1, 6)
    expect(shutterThreshold(5)).toBeCloseTo(0.1, 6)
  })
})
