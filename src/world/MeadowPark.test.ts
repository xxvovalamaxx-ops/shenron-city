import { describe, expect, it } from 'vitest'
import { meadowModeForSettings } from './MeadowPark'
import { QUALITY } from './palette'

describe('meadow quality selection', () => {
  it('keeps low quality on the no-download procedural fallback', () => {
    expect(meadowModeForSettings(QUALITY.low)).toBe('procedural')
  })

  it.each(['medium', 'high'] as const)(
    'uses scanned runtime assets on %s quality',
    (quality) => {
      expect(meadowModeForSettings(QUALITY[quality])).toBe('scanned')
    },
  )
})
