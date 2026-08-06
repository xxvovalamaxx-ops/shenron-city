import { describe, expect, it } from 'vitest'
import { debugInspectionView } from './dev-view'

describe('development visual inspection', () => {
  it('parses only dev builds', () => {
    expect(debugInspectionView('?spawn=midtown-street', false)).toBeNull()
    expect(debugInspectionView('', true)).toBeNull()
  })

  it('ignores unknown viewpoints', () => {
    expect(debugInspectionView('?spawn=not-a-place', true)).toBeNull()
    expect(debugInspectionView('?spawn=', true)).toBeNull()
  })

  it('provides every fixed regression camera with an explicit look target', () => {
    for (const name of [
      'midtown-street',
      'times-square',
      'central-park',
      'skyline-south',
      'statue-of-liberty',
      'financial',
      'soho',
      'midtown-east',
      'harbor',
      'aerial-midtown',
    ]) {
      const view = debugInspectionView(`?spawn=${name}`, true)
      expect(view, name).not.toBeNull()
      expect(view?.position).not.toEqual(view?.target)
    }
  })

  it('resolves an aerial viewpoint high above the streets', () => {
    const view = debugInspectionView('?spawn=aerial-midtown', true)
    expect(view?.position.y).toBeGreaterThan(100)
  })
})
