import { describe, expect, it, vi } from 'vitest'

import { nearestGround, type GroundProbe } from './ground-search'

/** Ground everywhere except a disc of `radius` around (hx, hz). */
function holeAt(hx: number, hz: number, radius: number, height = 12): GroundProbe {
  return (x, z) => (Math.hypot(x - hx, z - hz) < radius ? null : height)
}

/** Ground only inside a disc — the inverse case, an island in the sea. */
function islandAt(cx: number, cz: number, radius: number, height = 12): GroundProbe {
  return (x, z) => (Math.hypot(x - cx, z - cz) <= radius ? height : null)
}

describe('nearestGround', () => {
  it('returns the point itself when it is already solid', () => {
    const probe = vi.fn<GroundProbe>(() => 12.05)
    const hit = nearestGround(probe, 100, -200)
    expect(hit).toEqual({ x: 100, z: -200, y: 12.05, movedBy: 0 })
    // One probe, not a search: the common case must be cheap.
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('finds ground just outside a hole, and says how far it moved', () => {
    // The real case: Times Square sits in a gap in LAND_manhattan, and the
    // player was being placed on a fallback height with ocean below.
    const hit = nearestGround(holeAt(0, 0, 40), 0, 0, { step: 10 })
    expect(hit).not.toBeNull()
    expect(hit!.y).toBe(12)
    expect(hit!.movedBy).toBeGreaterThanOrEqual(40)
    // Should not overshoot: the first ring past the hole edge is 50.
    expect(hit!.movedBy).toBeLessThanOrEqual(55)
  })

  it('prefers the nearest hit on a ring, not the first one it samples', () => {
    // Ground only to the east. A raster scan would return whichever direction
    // it happened to try first; the ring search must pick the closest point.
    const probe: GroundProbe = (x) => (x > 30 ? 12 : null)
    const hit = nearestGround(probe, 0, 0, { step: 10, maxRadius: 200 })
    expect(hit).not.toBeNull()
    expect(hit!.x).toBeGreaterThan(30)
    // The closest solid ground is 30 m east, so it should land near there.
    expect(hit!.movedBy).toBeLessThan(45)
    expect(Math.abs(hit!.z)).toBeLessThan(20)
  })

  it('returns null when nothing is in range rather than the original point', () => {
    // Handing back a position known to be over a hole is how the player ends
    // up standing on a fallback height with the sea underneath.
    expect(nearestGround(() => null, 0, 0, { maxRadius: 60, step: 20 })).toBeNull()
  })

  it('respects maxRadius', () => {
    // Ground exists, but further than we are willing to move someone.
    const probe = islandAt(0, 0, 10)
    expect(nearestGround(probe, 500, 0, { maxRadius: 100, step: 25 })).toBeNull()
    expect(nearestGround(probe, 40, 0, { maxRadius: 100, step: 5 })).not.toBeNull()
  })

  it('keeps ring sampling dense as the radius grows', () => {
    // A thin spur of ground far out must still be found. With a fixed spoke
    // count the arc between samples grows with the radius and a narrow target
    // slips between them.
    const probe: GroundProbe = (x, z) => (Math.abs(z) < 3 && x > 190 && x < 210 ? 12 : null)
    const hit = nearestGround(probe, 0, 0, { step: 10, maxRadius: 400, spokes: 8 })
    expect(hit).not.toBeNull()
    expect(hit!.x).toBeGreaterThan(150)
  })

  it('reports the height it found, not the height it was asked about', () => {
    const probe: GroundProbe = (x) => (x < 50 ? null : 37.5)
    const hit = nearestGround(probe, 0, 0, { step: 20 })
    expect(hit!.y).toBe(37.5)
  })

  it('does not probe forever on a fully empty world', () => {
    const probe = vi.fn<GroundProbe>(() => null)
    nearestGround(probe, 0, 0, { maxRadius: 60, step: 20 })
    // 1 centre + three rings. Bounded, and small enough to run per teleport.
    expect(probe.mock.calls.length).toBeLessThan(200)
    expect(probe.mock.calls.length).toBeGreaterThan(3)
  })
})
