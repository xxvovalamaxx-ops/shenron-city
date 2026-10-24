import { beforeEach, describe, expect, it } from 'vitest'
import { clearFigures, EJECT_FLEE, EJECT_PULL, EJECT_STUMBLE, ejectDriver, removeDone, stepEjected, streetFigures } from './street-figures'

const ground = () => 12.2

describe('carjack driver', () => {
  beforeEach(() => clearFigures())

  it('appears at the driver door, left of the car', () => {
    // heading 0 faces +Z; left of that is +X
    const f = ejectDriver({ x: 0, y: 12, z: 0, heading: 0 }, 5)
    expect(f.x).toBeGreaterThan(0.8)
    expect(f.clip).toBe('Interact')
    expect(streetFigures.list).toHaveLength(1)
  })

  it('is dragged out, stumbles, runs, then leaves', () => {
    const f = ejectDriver({ x: 0, y: 12, z: 0, heading: 0 }, 5)
    const seen = new Set<string>()
    for (let t = 0; t < EJECT_PULL + EJECT_STUMBLE + EJECT_FLEE + 1; t += 0.05) {
      stepEjected(f, 0.05, ground)
      seen.add(f.clip)
    }
    expect([...seen]).toEqual(['Interact', 'Walk', 'Run'])
    expect(f.done).toBe(true)
    expect(Math.hypot(f.x, f.z)).toBeGreaterThan(25)
    expect(f.y).toBe(12.2)
    removeDone()
    expect(streetFigures.list).toHaveLength(0)
  })
})
