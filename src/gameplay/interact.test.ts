import { describe, expect, it } from 'vitest'
import { pickTarget, placeMovingTargets, type Interactable } from './interact'

describe('moving interaction targets', () => {
  const panel = (): Interactable => ({
    id: 'panel',
    kind: 'elevator-panel',
    x: 0,
    y: 1.25,
    z: 0,
    label: 'Use the elevator',
    range: 2.4,
    movingY: 1.25,
  })

  it('moves the elevator panel target with the car', () => {
    const target = panel()

    placeMovingTargets([target], 180)

    expect(target.y).toBe(181.25)
  })

  it('keeps the elevator panel usable on floor 45', () => {
    const target = panel()
    placeMovingTargets([target], 180)

    expect(
      pickTarget([target], {
        px: 0,
        py: 181.25,
        pz: 1,
        fx: 0,
        fz: -1,
      }),
    ).toBe(target)
  })
})
