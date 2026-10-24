import { describe, expect, it } from 'vitest'
import {
  bearingFromBodyYaw,
  clampStat,
  clampToBox,
  clampWanted,
  formatClock,
  formatDistance,
  formatMoney,
  northDirection,
  radarScale,
  radarToWorld,
  titleCase,
  worldToRadar,
} from './radar-math'

describe('heading-up radar', () => {
  it('puts what is ahead of the camera at the top', () => {
    // Facing east (bearing 90°): a point 10 m east is 10 units up the radar.
    const p = worldToRadar(10, 0, Math.PI / 2)
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(-10, 9)
    // Facing north, north is up and east is right.
    expect(worldToRadar(0, -5, 0).y).toBeCloseTo(-5, 9)
    expect(worldToRadar(5, 0, 0).x).toBeCloseTo(5, 9)
  })

  it('inverts cleanly', () => {
    const heading = 1.1
    const p = worldToRadar(12, -7, heading)
    const w = radarToWorld(p.x, p.y, heading)
    expect(w.dx).toBeCloseTo(12, 9)
    expect(w.dz).toBeCloseTo(-7, 9)
  })

  it('puts the N marker opposite the heading', () => {
    // Facing south, north is straight down.
    const n = northDirection(Math.PI)
    expect(n.x).toBeCloseTo(0, 9)
    expect(n.y).toBeCloseTo(1, 9)
  })

  it('reads a body yaw as a compass bearing', () => {
    // Model yaw 0 faces +Z, which is south.
    expect(bearingFromBodyYaw(0)).toBeCloseTo(Math.PI, 9)
    // Facing -Z (yaw π) is north.
    expect(Math.abs(bearingFromBodyYaw(Math.PI))).toBeCloseTo(0, 9)
    // Facing +X (yaw π/2) is east.
    expect(bearingFromBodyYaw(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 9)
  })
})

describe('radarScale', () => {
  it('zooms out with speed, and further in a car', () => {
    expect(radarScale(7, false)).toBeGreaterThan(radarScale(0, false))
    expect(radarScale(30, true)).toBeGreaterThan(radarScale(5, true))
    expect(radarScale(0, true)).toBeGreaterThan(radarScale(0, false))
    expect(radarScale(Number.NaN, false)).toBe(radarScale(0, false))
  })
})

describe('clampToBox', () => {
  const box = { left: 100, right: 100, top: 60, bottom: 40 }
  it('leaves inside points alone', () => {
    expect(clampToBox({ x: 10, y: 10 }, box)).toEqual({ x: 10, y: 10, clamped: false })
  })
  it('pulls outside points back to the rim along the ray from the centre', () => {
    const p = clampToBox({ x: 0, y: -600 }, box, 10)
    expect(p).toEqual({ x: 0, y: -50, clamped: true })
    const q = clampToBox({ x: 400, y: 100 }, box)
    expect(q.clamped).toBe(true)
    expect(q.x).toBeCloseTo(100, 9)
    expect(q.y).toBeCloseTo(25, 9)
  })
})

describe('readouts', () => {
  it('formats the clock', () => {
    expect(formatClock(17)).toBe('17:00')
    expect(formatClock(9.5)).toBe('09:30')
    expect(formatClock(23.999)).toBe('23:59')
    expect(formatClock(25.25)).toBe('01:15')
    expect(formatClock(-1)).toBe('23:00')
  })

  it('formats money GTA-style', () => {
    expect(formatMoney(0)).toBe('$0')
    expect(formatMoney(1250430)).toBe('$1,250,430')
    expect(formatMoney(-50)).toBe('-$50')
    expect(formatMoney(Number.NaN)).toBe('$0')
  })

  it('clamps stars and stats', () => {
    expect(clampWanted(7)).toBe(5)
    expect(clampWanted(-2)).toBe(0)
    expect(clampWanted(2.6)).toBe(3)
    expect(clampStat(140)).toBe(100)
    expect(clampStat(Number.NaN)).toBe(0)
  })

  it('formats GPS distances', () => {
    expect(formatDistance(183)).toBe('180 m')
    expect(formatDistance(1440)).toBe('1.4 km')
  })

  it('turns LION names into street signs', () => {
    expect(titleCase('5 AVE')).toBe('5th Ave')
    expect(titleCase('W 42 ST')).toBe('W 42nd St')
    expect(titleCase('E 11 ST')).toBe('E 11th St')
    expect(titleCase('E 23 ST')).toBe('E 23rd St')
    expect(titleCase('E 101 ST')).toBe('E 101st St')
    expect(titleCase('BROADWAY')).toBe('Broadway')
  })
})
