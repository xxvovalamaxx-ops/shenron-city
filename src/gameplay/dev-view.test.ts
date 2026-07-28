import { describe, expect, it } from 'vitest'
import { MARKET_KEEPER } from '../world/city-data'
import { HQ } from '../world/layout'
import { debugInspectionView, debugSpawnPosition, isDevInspection } from './dev-view'

describe('development visual inspection', () => {
  it('accepts only named anchors in development', () => {
    expect(debugSpawnPosition('?spawn=market', true)).toMatchObject({
      x: MARKET_KEEPER.x,
      z: MARKET_KEEPER.z + 2.7,
    })
    expect(debugSpawnPosition('?spawn=hq', true)?.y).toBeGreaterThan(HQ.y)
    expect(debugSpawnPosition('?spawn=12,34', true)).toBeNull()
  })

  it('provides all seven production review viewpoints with explicit look targets', () => {
    for (const name of [
      'city-boulevard',
      'night-market',
      'hq-exterior',
      'hq-lobby',
      'elevator',
      'floor-45',
      'aegis-office',
    ]) {
      const view = debugInspectionView(`?spawn=${name}`, true)
      expect(view, name).not.toBeNull()
      expect(view?.position).not.toEqual(view?.target)
    }

    const floor = debugInspectionView('?spawn=floor-45', true)
    const aegis = debugInspectionView('?spawn=aegis-office', true)
    expect(floor?.position.y).toBeGreaterThan(HQ.y)
    expect(aegis?.target.x).toBeGreaterThan(aegis?.position.x ?? 0)
  })

  it('is inert in production and without the explicit inspection flag', () => {
    expect(debugSpawnPosition('?spawn=market', false)).toBeNull()
    expect(debugInspectionView('?spawn=aegis-office', false)).toBeNull()
    expect(isDevInspection('?inspect=1', true)).toBe(true)
    expect(isDevInspection('?inspect=1', false)).toBe(false)
    expect(isDevInspection('', true)).toBe(false)
  })
})
