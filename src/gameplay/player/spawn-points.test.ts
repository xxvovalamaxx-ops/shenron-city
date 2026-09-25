import { describe, expect, it } from 'vitest'
import { STREET_SPAWNS, spawnFacingAt } from './spawn-points'
import { parseSimStep } from './sim-step'
import { debugSpawnOverride } from '../dev-view'

describe('street spawns', () => {
  it('start in Midtown, on land, facing along a unit heading', () => {
    expect(STREET_SPAWNS.length).toBeGreaterThan(1)
    for (const spawn of STREET_SPAWNS) {
      // Midtown band: 30th–59th Street, 3rd Ave to 8th Ave (world z = -north).
      expect(spawn.z).toBeGreaterThan(1800)
      expect(spawn.z).toBeLessThan(3600)
      expect(spawn.x).toBeGreaterThan(-2200)
      expect(spawn.x).toBeLessThan(0)
      expect(Math.hypot(spawn.facing.x, spawn.facing.z)).toBeCloseTo(1, 2)
    }
    expect(new Set(STREET_SPAWNS.map((s) => s.id)).size).toBe(STREET_SPAWNS.length)
  })

  it('face down the avenue grid (about 29° east of north)', () => {
    for (const spawn of STREET_SPAWNS) {
      const bearing = (Math.atan2(spawn.facing.x, -spawn.facing.z) * 180) / Math.PI
      const offGrid = Math.min(Math.abs(bearing - 28.5), Math.abs(Math.abs(bearing) - 151.5))
      expect(offGrid).toBeLessThan(3)
    }
  })

  it('hands back the facing only when standing on a spawn', () => {
    const first = STREET_SPAWNS[0]
    expect(spawnFacingAt(first.x + 1, first.z - 1)).toEqual(first.facing)
    expect(spawnFacingAt(first.x + 40, first.z)).toBeNull()
  })
})

describe('dev spawn override', () => {
  it('parses x,z and a compass heading, dev only', () => {
    const o = debugSpawnOverride('?spawnAt=-800,2400,90', true)!
    expect(o.x).toBe(-800)
    expect(o.z).toBe(2400)
    expect(o.facing.x).toBeCloseTo(1, 9)
    expect(o.facing.z).toBeCloseTo(0, 9)
    const north = debugSpawnOverride('?spawnAt=1,2', true)!
    expect(north.facing.z).toBeCloseTo(-1, 9)
    expect(debugSpawnOverride('?spawnAt=-800,2400', false)).toBeNull()
    expect(debugSpawnOverride('?spawnAt=abc', true)).toBeNull()
  })
})

describe('dev fixed sim step', () => {
  it('parses and clamps, dev only', () => {
    expect(parseSimStep('?simStep=0.1', true)).toBe(0.1)
    expect(parseSimStep('?simStep=9', true)).toBe(0.25)
    expect(parseSimStep('?simStep=-1', true)).toBeNull()
    expect(parseSimStep('?simStep=0.1', false)).toBeNull()
    expect(parseSimStep('', true)).toBeNull()
  })
})
