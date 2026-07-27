import { describe, expect, it } from 'vitest'
import { standaloneSnapshot } from '../adapter/fixtures'
import { answerCharacter, CHARACTER_DIALOGUE } from './dialogue'

describe('local character dialogue', () => {
  it('keeps Iris grounded in the standalone headquarters scenario', () => {
    const reply = answerCharacter('iris', 'Is this connected to my computer?', standaloneSnapshot())

    expect(reply.source).toBe('grounded')
    expect(reply.text).toContain('disconnected')
  })

  it('gives Mira district-specific local answers', () => {
    const reply = answerCharacter('mira', 'What do you sell?', standaloneSnapshot())

    expect(reply.source).toBe('grounded')
    expect(reply.text).toContain('ramen')
    expect(reply.text).toContain('tea')
  })

  it('exposes both scripted character profiles', () => {
    expect(Object.keys(CHARACTER_DIALOGUE)).toEqual(['iris', 'mira'])
    expect(CHARACTER_DIALOGUE.mira.role).toBe('Night Market Keeper')
  })
})
