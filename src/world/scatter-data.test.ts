import { describe, expect, it } from 'vitest'
import {
  GROUND_COVER_EXCLUSIONS,
  POCKET_PARK_BOUNDS,
  POCKET_PARK_RING,
  generateGroundCover,
} from './scatter-data'

describe('pocket park ground-cover scatter', () => {
  it('is deterministic and returns the requested bounded population', () => {
    const first = generateGroundCover(1_600)
    const second = generateGroundCover(1_600)

    expect(second).toEqual(first)
    expect(first).toHaveLength(1_600)
    for (const instance of first) {
      expect(instance.x).toBeGreaterThanOrEqual(POCKET_PARK_BOUNDS.minX)
      expect(instance.x).toBeLessThanOrEqual(POCKET_PARK_BOUNDS.maxX)
      expect(instance.z).toBeGreaterThanOrEqual(POCKET_PARK_BOUNDS.minZ)
      expect(instance.z).toBeLessThanOrEqual(POCKET_PARK_BOUNDS.maxZ)
      expect(instance.scale).toBeGreaterThan(0)
    }
  })

  it('keeps the ring path and structural nature assets clear', () => {
    for (const instance of generateGroundCover(1_600)) {
      const ringDistance = Math.hypot(
        instance.x - POCKET_PARK_RING.x,
        instance.z - POCKET_PARK_RING.z,
      )
      expect(
        ringDistance > POCKET_PARK_RING.innerRadius &&
          ringDistance < POCKET_PARK_RING.outerRadius,
      ).toBe(false)

      for (const exclusion of GROUND_COVER_EXCLUSIONS) {
        expect(Math.hypot(instance.x - exclusion.x, instance.z - exclusion.z)).toBeGreaterThanOrEqual(
          exclusion.radius,
        )
      }
    }
  })

  it('uses several compatible vegetation layers instead of one repeated blade', () => {
    const kinds = new Set(generateGroundCover(1_600).map((instance) => instance.kind))
    expect(kinds).toEqual(new Set(['short-grass', 'tall-grass', 'fern', 'flower']))
  })
})
