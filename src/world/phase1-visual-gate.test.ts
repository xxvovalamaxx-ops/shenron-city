import { describe, expect, it } from 'vitest'

import { Phase1VisualGate } from './phase1-visual-gate'

describe('Phase1VisualGate', () => {
  it('does not open until the release, every required model, visibility, and gameplay agree', () => {
    const gate = new Phase1VisualGate(['tile-a', 'tile-b'])
    gate.verifyRelease()
    gate.modelLoaded('tile-a')
    gate.modelLoaded('tile-b')
    gate.visibilityChanged('tile-a', true)
    expect(gate.snapshot().enterable).toBe(false)

    gate.setGameplayReady(true)
    expect(gate.snapshot()).toMatchObject({
      enterable: true,
      loadedRequiredTileIds: ['tile-a', 'tile-b'],
      visibleRequiredTileIds: ['tile-a'],
    })
  })

  it('remains closed after a terminal visual error even if later events look healthy', () => {
    const gate = new Phase1VisualGate(['tile-a'])
    gate.verifyRelease()
    gate.modelLoaded('tile-a')
    gate.visibilityChanged('tile-a', true)
    gate.setGameplayReady(true)
    gate.terminalVisualError()
    gate.modelLoaded('tile-a')
    expect(gate.snapshot()).toMatchObject({
      terminalVisualErrors: 1,
      enterable: false,
    })
  })
})
