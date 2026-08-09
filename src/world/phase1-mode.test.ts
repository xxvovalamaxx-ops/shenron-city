import { describe, expect, it } from 'vitest'

import { shouldUsePhase1City } from './phase1-mode'

describe('Phase-1 city mode', () => {
  it('is opt-in during development', () => {
    expect(shouldUsePhase1City('?city=phase1', true)).toBe(true)
    expect(shouldUsePhase1City('?foo=1&city=phase1&bar=2', true)).toBe(true)
    expect(shouldUsePhase1City('?city=legacy', true)).toBe(false)
    expect(shouldUsePhase1City('', true)).toBe(false)
  })

  it('cannot serve synthetic fixture geometry in production', () => {
    expect(shouldUsePhase1City('?city=phase1', false)).toBe(false)
  })
})
