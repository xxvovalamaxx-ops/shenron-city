/**
 * The benchmark registry has to be honest about two things: which locations
 * can actually run, and what camera a name points at.
 *
 * Both had drifted. Five entries targeted an application the one-Manhattan
 * consolidation deleted, and four carried the retired HQ build's names while
 * aiming somewhere unrelated — `elevator-interior` at Central Park, `hq-lobby`
 * at the Financial District canyon. A benchmark report is a list of names, so a
 * name that lies is a measurement that lies.
 */
import { describe, expect, it } from 'vitest'

import mod from './locations.cjs'

const {
  LOCATIONS,
  ALIASES,
  resolveLocation,
  runnableLocations,
  retirementReason,
  ll2xy,
  xy2ll,
} = mod

describe('what can be run', () => {
  it('reports only the game as runnable, because it is the only app left', () => {
    const runnable = runnableLocations()
    expect(runnable.length).toBeGreaterThan(0)
    for (const name of runnable) {
      expect(LOCATIONS[name].app, `${name} is not a shenron location`).toBe('shenron')
    }
  })

  it('refuses a retired location, and says why rather than just failing', () => {
    // "unknown location" or a bare throw sends the reader looking for a typo.
    const why = retirementReason('times-square')
    expect(why).toBeTruthy()
    expect(why).toMatch(/retired app "manhattan"/)
    expect(why).toMatch(/one-Manhattan consolidation/)
  })

  it('has nothing to say about a runnable location', () => {
    expect(retirementReason('midtown-street')).toBeNull()
  })

  it('names the unknown name rather than guessing', () => {
    expect(retirementReason('no-such-place')).toMatch(/unknown location/)
  })

  it('keeps the retired coordinates rather than deleting them', () => {
    // They are real surveyed positions. Retiring the runner path is not a
    // reason to lose the survey.
    expect(LOCATIONS['times-square'].spec).toHaveLength(6)
    expect(LOCATIONS['lower-manhattan'].spec[0]).toBeCloseTo(40.7069, 4)
  })
})

describe('names resolve to the camera they claim', () => {
  it('every runnable location declares the dev-view it aims at', () => {
    for (const name of runnableLocations()) {
      expect(LOCATIONS[name].view, `${name} has no view`).toBeTruthy()
    }
  })

  it('follows an old HQ name to the camera it actually was', () => {
    // The rename is only safe if the old key still resolves — evidence has
    // already been filed under these.
    const hit = resolveLocation('elevator-interior')
    expect(hit.name).toBe('central-park-open')
    expect(hit.location.view).toBe('central-park')
    expect(hit.alias).toBe('elevator-interior')
  })

  it('maps every retired HQ name that used to be in the registry', () => {
    for (const old of [
      'hero-corridor-exterior',
      'hq-plaza',
      'hq-lobby',
      'elevator-interior',
      'floor45-arrival',
    ]) {
      expect(ALIASES[old], `${old} lost its alias`).toBeTruthy()
    }
  })

  it('reports the canonical name, not the alias, so reports do not lie', () => {
    expect(resolveLocation('hq-lobby').name).toBe('financial-canyon')
    expect(resolveLocation('financial-canyon').alias).toBeNull()
  })

  it('returns null for a name nobody registered', () => {
    expect(resolveLocation('floor-99')).toBeNull()
  })

  it('never aliases a name that is already a location', () => {
    // An alias shadowing a real key would silently redirect a valid request.
    for (const alias of Object.keys(ALIASES)) {
      expect(LOCATIONS[alias], `${alias} is both an alias and a location`).toBeUndefined()
    }
  })
})

describe('the projection the surveyed coordinates depend on', () => {
  it('round-trips lat/lon through metres', () => {
    const { x, y } = ll2xy(40.7484, -73.9857)
    const back = xy2ll(x, y)
    expect(back.lat).toBeCloseTo(40.7484, 9)
    expect(back.lon).toBeCloseTo(-73.9857, 9)
  })

  it('puts the origin at the documented reference point', () => {
    const o = ll2xy(40.78, -73.968)
    expect(o.x).toBeCloseTo(0, 9)
    expect(o.y).toBeCloseTo(0, 9)
  })

  it('puts Times Square where the note says, to within a couple of metres', () => {
    // The note records -1476, -2433; the projection gives -1475.15, -2433.34.
    // The 0.85 m gap is the note being rounded, not a disagreement — so the
    // tolerance is 2 m, which is tight enough to catch a changed constant
    // (LAT0, LON0 or either metres-per-degree) and loose enough not to fail on
    // a hand-written figure. A metre either way is inside the kerb.
    const { x, y } = ll2xy(40.758, -73.9855)
    expect(Math.abs(x - -1476)).toBeLessThan(2)
    expect(Math.abs(y - -2433)).toBeLessThan(2)
  })
})
