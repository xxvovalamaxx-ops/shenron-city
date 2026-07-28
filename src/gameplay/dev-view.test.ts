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

  it('provides every fixed production regression camera with an explicit look target', () => {
    for (const name of [
      'city-entry',
      'hero-boulevard',
      'night-market-wide',
      'night-market-close',
      'kai-conversation',
      'hq-exterior',
      'hq-entrance',
      'hq-lobby',
      'secretary-close',
      'elevator-interior',
      'floor45-arrival',
      'agent-workstation',
    ]) {
      const view = debugInspectionView(`?spawn=${name}`, true)
      expect(view, name).not.toBeNull()
      expect(view?.position).not.toEqual(view?.target)
    }

    const floor = debugInspectionView('?spawn=floor45-arrival', true)
    const aegis = debugInspectionView('?spawn=agent-workstation', true)
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
