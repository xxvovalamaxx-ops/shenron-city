// camera-math.test.ts — Phase 2O-A camera registry and projection tests.
//
// These pin the two facts the whole baseline depends on: the projection
// round-trips, and every benchmark camera is where its documentation says it
// is (P2-075 regression: a "Times Square" camera at Lincoln Square).

import { describe, expect, it } from 'vitest'
import { LOCATIONS, ll2xy, xy2ll } from '../../scripts/benchmarks/lib/locations.cjs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const M_LON = 111320.0 * Math.cos((40.78 * Math.PI) / 180)

describe('projection (matches phase-2 build constants)', () => {
  it('projects lat/lon to local metres', () => {
    const p = ll2xy(40.758, -73.9855)
    expect(p.x).toBeCloseTo(-1475.1, 0)
    expect(p.y).toBeCloseTo(-2432.6, 0)
  })

  it('projects the P2-075 Lincoln Square coordinates', () => {
    const p = ll2xy(40.7746, -73.9905)
    expect(p.x).toBeCloseTo(-1896.6, 0)
    expect(p.y).toBeCloseTo(-597.1, 0)
  })

  it('round-trips xy -> ll -> xy', () => {
    for (const [lat, lon] of [[40.758, -73.9855], [40.7746, -73.9905], [40.7069, -74.01], [40.809, -73.948]]) {
      const { x, y } = ll2xy(lat, lon)
      const back = xy2ll(x, y)
      expect(back.lat).toBeCloseTo(lat, 6)
      expect(back.lon).toBeCloseTo(lon, 6)
    }
  })

  it('uses the documented constants (capture.js)', () => {
    // capture.js: M_LON = 111320.0 * cos(LAT0 * pi/180)
    expect(M_LON).toBeCloseTo(84294.2, 0)
  })
})

describe('benchmark camera registry (P2-075 regression)', () => {
  it('has unique ids and valid specs', () => {
    const ids = Object.keys(LOCATIONS)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      const loc = LOCATIONS[id]
      expect(['manhattan', 'shenron']).toContain(loc.app)
      if (loc.app === 'manhattan') {
        expect(loc.spec).toHaveLength(6)
        expect(loc.spec[0]).toBeGreaterThanOrEqual(40.7) // lat inside NYC
        expect(loc.spec[1]).toBeLessThanOrEqual(-73.9)   // lon inside NYC
      } else {
        expect(typeof loc.view).toBe('string')
      }
    }
  })

  it('times-square is at the true Times Square, not Lincoln Square', () => {
    const ts = LOCATIONS['times-square']
    const p = ll2xy(ts.spec[0], ts.spec[1])
    // true Times Square is ~1.8 km from the old mislabelled START
    const lincoln = ll2xy(40.7746, -73.9905)
    expect(Math.hypot(p.x - lincoln.x, p.y - lincoln.y)).toBeGreaterThan(1500)
    // and ~1.8 km from where the code says it must not be (-1900,-600)
    expect(Math.hypot(p.x - -1900, p.y - -600)).toBeGreaterThan(1500)
  })

  it('lincoln-square is the old mislabelled START position', () => {
    const ls = LOCATIONS['lincoln-square']
    const p = ll2xy(ls.spec[0], ls.spec[1])
    expect(Math.hypot(p.x - -1900, p.y - -600)).toBeLessThan(100)
  })

  it('matches the building registry districts (building_manifest.csv)', () => {
    const csv = readFileSync(resolve(__dirname, '../../public/models/manhattan/building_manifest.csv'), 'utf8')
    const lines = csv.split(/\r?\n/).slice(1).filter((l) => l.trim())
    const ts = ll2xy(LOCATIONS['times-square'].spec[0], LOCATIONS['times-square'].spec[1])
    const ls = ll2xy(LOCATIONS['lincoln-square'].spec[0], LOCATIONS['lincoln-square'].spec[1])

    const nearest = (x, y) => {
      let best = null
      let bd = Infinity
      for (const line of lines) {
        const c = line.split(',')
        const bx = Number(c[16]) // x_m
        const by = Number(c[17]) // y_m
        const d = (bx - x) ** 2 + (by - y) ** 2
        if (d < bd) { bd = d; best = { district: c[5], name: c[2], d: Math.sqrt(d) } }
      }
      return best
    }

    // manifest columns: 0 bid, 1 osm_way_id, 2 name, 5 district,
    // 16 x_m, 17 y_m (see building_index.json schema)
    const tsNearest = nearest(ts.x, ts.y)
    expect(tsNearest!.d).toBeLessThan(600)
    expect(tsNearest!.district).toContain('Times Sq')

    const lsNearest = nearest(ls.x, ls.y)
    expect(lsNearest!.d).toBeLessThan(600)
    expect(lsNearest!.district).toBe('Upper West Side')
  })

  it('dev-view cameras exist in the source registry', () => {
    const src = readFileSync(resolve(__dirname, '../../src/gameplay/dev-view.ts'), 'utf8')
    for (const id of Object.keys(LOCATIONS)) {
      if (LOCATIONS[id].app !== 'shenron') continue
      const view = LOCATIONS[id].view
      // Registry keys with dashes are quoted; plain identifiers are not.
      expect(src.includes(`'${view}':`) || src.includes(`${view}:`), `${view} missing from dev-view.ts`).toBe(true)
    }
  })
})
