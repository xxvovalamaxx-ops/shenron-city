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

  it('gives Kai plaza-specific local answers', () => {
    const reply = answerCharacter('kai', 'What is on floor 45?', standaloneSnapshot())

    expect(reply.source).toBe('grounded')
    expect(reply.text).toContain('45')
  })

  it('has Kai state the boundary plainly rather than deflect', () => {
    // The one character whose job is the boundary should not be vague about it.
    const reply = answerCharacter('kai', 'Can anything in here touch my computer?', standaloneSnapshot())

    expect(reply.source).toBe('grounded')
    expect(reply.text).toMatch(/filesystem|shell|model provider/)
  })

  it('exposes every scripted character profile', () => {
    expect(Object.keys(CHARACTER_DIALOGUE)).toEqual(['iris', 'mira', 'kai'])
    expect(CHARACTER_DIALOGUE.mira.role).toBe('Night Market Keeper')
    expect(CHARACTER_DIALOGUE.kai.role).toBe('Plaza Security')
  })

  it('never sources a suggested answer from a model', () => {
    // The security property, not a quality bar: 'fallback' is a legitimate
    // local reply for a question a character has no specific answer to. The
    // guarantee is that no path reaches a provider.
    for (const id of Object.keys(CHARACTER_DIALOGUE) as (keyof typeof CHARACTER_DIALOGUE)[]) {
      for (const question of CHARACTER_DIALOGUE[id].suggestions) {
        const reply = answerCharacter(id, question, standaloneSnapshot())
        expect(reply.source).not.toBe('model')
        expect(reply.text.length).toBeGreaterThan(0)
      }
    }
  })

  it('answers each of Kai every suggested question specifically, not with the catch-all', () => {
    const catchAll = 'I mostly know this plaza'
    for (const question of CHARACTER_DIALOGUE.kai.suggestions) {
      expect(answerCharacter('kai', question, standaloneSnapshot()).text).not.toContain(catchAll)
    }
  })
})
