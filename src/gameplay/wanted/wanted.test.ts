import { describe, expect, it } from 'vitest'
import {
  canSee,
  createWanted,
  CRIME_HEAT,
  ESCAPE_TIME,
  escapeFraction,
  isSearching,
  reportCrime,
  SEARCH_RADIUS,
  setStars,
  starsForHeat,
  STAR_HEAT,
  stepWanted,
  type WantedState,
} from './wanted'

const origin = { x: 0, z: 0 }
const never = () => false
const always = () => true

function run(state: WantedState, seconds: number, spotted: boolean, player = origin, dt = 0.1) {
  let s = state
  for (let t = 0; t < seconds - 1e-9; t += dt) s = stepWanted(s, { spotted, player, dt })
  return s
}

describe('wanted level', () => {
  it('maps heat to stars at the documented thresholds', () => {
    expect(starsForHeat(0)).toBe(0)
    expect(starsForHeat(STAR_HEAT[0] - 0.01)).toBe(0)
    STAR_HEAT.forEach((heat, i) => expect(starsForHeat(heat)).toBe(i + 1))
    expect(starsForHeat(1e9)).toBe(5)
  })

  it('a witnessed carjack is one star; ramming a cruiser is an immediate two', () => {
    const jack = reportCrime(createWanted(), { crime: 'carjack', at: origin, witnessedByPolice: true })
    expect(jack.stars).toBe(1)
    const ram = reportCrime(createWanted(), { crime: 'hit-police-vehicle', at: origin, witnessedByPolice: true })
    expect(ram.stars).toBe(2)
  })

  it('civilian reports carry less heat than police-witnessed crimes', () => {
    const seen = reportCrime(createWanted(), { crime: 'hit-pedestrian', at: origin, witnessedByPolice: true })
    const told = reportCrime(createWanted(), { crime: 'hit-pedestrian', at: origin, witnessedByPolice: false })
    expect(told.heat).toBeLessThan(seen.heat)
    expect(seen.heat).toBe(CRIME_HEAT['hit-pedestrian'])
  })

  it('does nothing without a level (returns the same object)', () => {
    const s = createWanted()
    expect(stepWanted(s, { spotted: true, player: origin, dt: 0.1 })).toBe(s)
  })

  it('stars never drop while the police can see the player', () => {
    const s = setStars(createWanted(), 3, origin)
    const after = run(s, 120, true, { x: 5000, z: 0 })
    expect(after.stars).toBe(3)
    expect(after.seen).toBe(true)
    expect(after.lastKnown).toEqual({ x: 5000, z: 0 })
  })

  it('hiding inside the search circle never clears the level', () => {
    const s = setStars(createWanted(), 2, origin)
    const after = run(s, 120, false, { x: 10, z: 10 })
    expect(after.stars).toBe(2)
    expect(isSearching(after)).toBe(true)
  })

  it('leaving the circle unseen for the escape time clears everything', () => {
    const stars = 2
    const s = setStars(createWanted(), stars, origin)
    const outside = { x: SEARCH_RADIUS[stars] + 50, z: 0 }
    const almost = run(s, ESCAPE_TIME[stars] - 0.5, false, outside)
    expect(almost.stars).toBe(stars)
    expect(escapeFraction(almost)).toBeGreaterThan(0.9)
    const clear = run(almost, 1, false, outside)
    expect(clear.stars).toBe(0)
    expect(clear.heat).toBe(0)
  })

  it('being spotted again cancels the escape', () => {
    const s = setStars(createWanted(), 1, origin)
    const outside = { x: SEARCH_RADIUS[1] + 10, z: 0 }
    const partway = run(s, ESCAPE_TIME[1] / 2, false, outside)
    const spotted = run(partway, 0.1, true, outside)
    expect(spotted.escapeProgress).toBe(0)
    expect(spotted.lastKnown).toEqual(outside)
  })

  it('a crime while hiding re-centres the search on the crime scene', () => {
    const s = run(setStars(createWanted(), 2, origin), 3, false, { x: 400, z: 0 })
    const after = reportCrime(s, { crime: 'hit-vehicle', at: { x: 400, z: 0 }, witnessedByPolice: false })
    expect(after.lastKnown).toEqual({ x: 400, z: 0 })
    expect(after.escapeProgress).toBe(0)
  })

  it('is deterministic: identical inputs give identical states', () => {
    const script = (s: WantedState) => {
      let x = reportCrime(s, { crime: 'carjack', at: origin, witnessedByPolice: true })
      x = run(x, 4, true, { x: 30, z: 0 })
      x = reportCrime(x, { crime: 'hit-pedestrian', at: { x: 30, z: 0 }, witnessedByPolice: true })
      return run(x, 9, false, { x: 500, z: 20 })
    }
    expect(script(createWanted())).toEqual(script(createWanted()))
  })
})

describe('police sight', () => {
  const cop = { pos: origin, forward: { x: 0, z: 1 } }

  it('sees a player ahead and in range when nothing blocks the view', () => {
    expect(canSee(cop, { x: 0, z: 40 }, never)).toBe(true)
  })

  it('does not see through buildings, behind itself or beyond range', () => {
    expect(canSee(cop, { x: 0, z: 40 }, always)).toBe(false)
    expect(canSee(cop, { x: 0, z: -40 }, never)).toBe(false)
    expect(canSee(cop, { x: 0, z: 400 }, never)).toBe(false)
  })

  it('notices a player right next to the car regardless of facing or walls', () => {
    expect(canSee(cop, { x: 0, z: -6 }, always)).toBe(true)
  })
})
