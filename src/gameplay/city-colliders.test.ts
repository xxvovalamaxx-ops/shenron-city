/**
 * A 2 km city cannot feed every building to the sweep each frame. These cover
 * the two ways a spatial index goes wrong: missing a building the player is
 * standing next to, and returning so many that it was pointless.
 */
import { describe, expect, it } from 'vitest'
import { generateCityPlan, type Lot } from '../world/city-plan'
import { buildCityCollision, CELL } from './city-colliders'
import { collidesAt } from './collision'

const plan = generateCityPlan()
const city = buildCityCollision(plan.lots)

const at = (x: number, z: number) => ({ x, y: 0, z })

describe('buildCityCollision', () => {
  it('indexes the whole city', () => {
    expect(city.cells).toBeGreaterThan(20)
  })

  it('returns far fewer colliders than the city has buildings', () => {
    // The entire point: an O(1) lookup, not an O(buildings) scan.
    for (const lot of plan.lots.slice(0, 40)) {
      expect(city.near(at(lot.x, lot.z)).length).toBeLessThan(plan.lots.length / 4)
    }
  })

  it('finds the building the player is standing inside', () => {
    for (const lot of plan.lots.slice(0, 60)) {
      const found = city.near(at(lot.x, lot.z))
      const hit = found.some(
        (b) =>
          lot.x >= b.min[0] && lot.x <= b.max[0] && lot.z >= b.min[2] && lot.z <= b.max[2],
      )
      expect(hit).toBe(true)
    }
  })

  it('makes every building actually solid', () => {
    for (const lot of plan.lots.slice(0, 60)) {
      expect(collidesAt(at(lot.x, lot.z), city.near(at(lot.x, lot.z)))).toBe(true)
    }
  })

  it('finds a building straddling a cell boundary from both sides', () => {
    // Registering only the centre cell leaves a wall that is solid from one
    // side and open from the other — worse than none, because it looks
    // deliberate.
    const straddler = plan.lots.find((l) => {
      const minC = Math.floor((l.x - l.width / 2) / CELL)
      const maxC = Math.floor((l.x + l.width / 2) / CELL)
      return minC !== maxC
    })
    expect(straddler).toBeDefined()
    const l = straddler as Lot
    const inside = (b: { min: readonly number[]; max: readonly number[] }) =>
      l.x >= b.min[0] && l.x <= b.max[0] && l.z >= b.min[2] && l.z <= b.max[2]
    expect(city.near(at(l.x - l.width / 2 - 1, l.z)).some(inside)).toBe(true)
    expect(city.near(at(l.x + l.width / 2 + 1, l.z)).some(inside)).toBe(true)
  })

  it('accounts for a quarter-turn swapping the footprint axes', () => {
    const turned: Lot = {
      id: 't', x: 0, z: 0, width: 40, depth: 8, height: 20,
      district: 'midrise', asset: 0, rotation: Math.PI / 2,
    }
    const solo = buildCityCollision([turned])
    // Rotated 90 degrees, the long axis is now z.
    expect(collidesAt(at(0, 15), solo.near(at(0, 15)))).toBe(true)
    expect(collidesAt(at(15, 0), solo.near(at(15, 0)))).toBe(false)
  })

  it('returns nothing in open country rather than throwing', () => {
    expect(city.near(at(50_000, 50_000))).toEqual([])
  })

  it('leaves the hand-authored district clear', () => {
    // Its own colliders own that space; a generated box there would be a
    // wall in the middle of Dragon Boulevard.
    expect(collidesAt(at(0, 90), city.near(at(0, 90)))).toBe(false)
  })
})
