import { describe, expect, it } from 'vitest'
import { interactionFocusMatches } from './interaction-focus'

describe('interaction focus marker', () => {
  it('matches a singleton target by interaction kind', () => {
    expect(
      interactionFocusMatches({ kind: 'secretary', payload: null }, 'secretary'),
    ).toBe(true)
  })

  it('shows only the named character selected by the prompt', () => {
    const focus = { kind: 'city-character' as const, payload: 'mira' }
    expect(interactionFocusMatches(focus, 'city-character', 'mira')).toBe(true)
    expect(interactionFocusMatches(focus, 'city-character', 'kai')).toBe(false)
  })

  it('does not reuse an office marker for a different agent', () => {
    const focus = { kind: 'agent-office' as const, payload: 'aegis' }
    expect(interactionFocusMatches(focus, 'agent-office', 'aegis')).toBe(true)
    expect(interactionFocusMatches(focus, 'agent-office', 'echo')).toBe(false)
  })
})
