import { describe, expect, it } from 'vitest'
import { OFFICE_SLOTS } from '../world/layout'
import {
  cityTourTarget,
  cityTourWayfinding,
  relativeWayfinding,
} from './wayfinding'

describe('City Tour wayfinding', () => {
  const player = { x: 0, z: 0 }
  const north = { x: 0, z: -1 }

  it.each([
    ['ahead', { x: 0, z: -10 }, 0],
    ['right', { x: 10, z: 0 }, 90],
    ['left', { x: -10, z: 0 }, -90],
    ['behind', { x: 0, z: 10 }, 180],
  ] as const)('reports %s relative bearing', (_label, target, bearing) => {
    expect(relativeWayfinding(player, north, target)).toEqual({
      bearing,
      distance: 10,
    })
  })

  it('maps each ordered step and disappears after completion', () => {
    for (let completed = 0; completed < 6; completed++) {
      expect(cityTourTarget({ completed }, player)).not.toBeNull()
    }
    expect(cityTourTarget({ completed: 6 }, player)).toBeNull()
    expect(cityTourWayfinding({ completed: 6 }, player, north)).toBeNull()
  })

  it('guides the final step to the nearest office', () => {
    const playerNearEast = { x: 8, z: -20 }
    const target = cityTourTarget({ completed: 5 }, playerNearEast)

    expect(target).toEqual(OFFICE_SLOTS[5])
  })

  it('quantizes the HUD bearing and distance', () => {
    const guidance = cityTourWayfinding(
      { completed: 0 },
      { x: 0, z: 100 },
      { x: 0, z: -1 },
    )
    if (!guidance) throw new Error('expected active route guidance')

    expect(guidance.bearing % 5).toBe(0)
    expect(Number.isInteger(guidance.distance)).toBe(true)
  })
})
