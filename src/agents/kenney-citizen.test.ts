import { describe, expect, it } from 'vitest'
import {
  KENNEY_CITIZEN_CLIPS,
  KENNEY_CITIZEN_SKINS,
  KENNEY_CITIZEN_URL,
} from './kenney-citizen'

describe('Kenney citizen asset contract', () => {
  it('exposes the three verified authored motions', () => {
    expect(KENNEY_CITIZEN_CLIPS).toEqual(['Idle', 'Jump', 'Run'])
  })

  it('keeps six distinct local skins for the city cast', () => {
    const skins = Object.values(KENNEY_CITIZEN_SKINS)
    expect(skins).toHaveLength(6)
    expect(new Set(skins).size).toBe(6)
    expect(skins.every((path) => path.startsWith('/models/characters/kenney-citizen/'))).toBe(true)
  })

  it('loads the reviewed local GLB instead of a remote model', () => {
    expect(KENNEY_CITIZEN_URL).toBe(
      '/models/characters/kenney-citizen/kenney-citizen.glb',
    )
  })
})
