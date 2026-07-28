import { describe, expect, it } from 'vitest'
import {
  QUATERNIUS_HERO_CLIPS,
  QUATERNIUS_HERO_URL,
} from './quaternius-hero'

describe('Quaternius hero asset contract', () => {
  it('publishes the 29 implemented city motions', () => {
    expect(QUATERNIUS_HERO_CLIPS).toHaveLength(29)
    expect(new Set(QUATERNIUS_HERO_CLIPS).size).toBe(29)
    expect(QUATERNIUS_HERO_CLIPS).toContain('Walk_Loop')
    expect(QUATERNIUS_HERO_CLIPS).toContain('Idle_Talking_Loop')
    expect(QUATERNIUS_HERO_CLIPS).toContain('Fixing_Kneeling')
  })

  it('uses the pinned local browser asset', () => {
    expect(QUATERNIUS_HERO_URL).toBe(
      '/models/characters/quaternius-hero/quaternius-hero.glb?v=b542c36d',
    )
  })
})
