import { describe, expect, it } from 'vitest'
import { ENTRANCE } from '../world/layout'
import { BREAKABLES } from './BreakableRegistry'
import { breakableColliders } from './collision'

describe('destructible prop collision', () => {
  it('matches every visible prop and removes destroyed props', () => {
    const all = breakableColliders(new Set())
    expect(all).toHaveLength(BREAKABLES.length)

    const removed = BREAKABLES[1]
    const active = breakableColliders(new Set([removed.id]))
    expect(active).toHaveLength(BREAKABLES.length - 1)
    expect(
      active.some(
        (box) =>
          removed.pos.x >= box.min[0] &&
          removed.pos.x <= box.max[0] &&
          removed.pos.z >= box.min[2] &&
          removed.pos.z <= box.max[2],
      ),
    ).toBe(false)
  })

  it('keeps every grounded prop above the floor', () => {
    for (const definition of BREAKABLES) {
      expect(definition.pos.y - definition.size[1] / 2).toBeGreaterThanOrEqual(0)
    }
  })

  it('keeps the full plaza-door-lift route clear', () => {
    const corridorHalfWidth = ENTRANCE.halfWidth + 1
    for (const box of breakableColliders(new Set())) {
      const inRouteDepth = box.max[2] > -30 && box.min[2] < 40
      const crossesRouteWidth =
        box.max[0] > -corridorHalfWidth && box.min[0] < corridorHalfWidth
      expect(inRouteDepth && crossesRouteWidth).toBe(false)
    }
  })
})
