import { describe, expect, it } from 'vitest'
import type { Interactable } from './interact'
import {
  RESIDENT_COLLIDER_HEIGHT,
  RESIDENT_COLLIDER_WIDTH,
  residentColliders,
} from './residents'

const target = (kind: Interactable['kind'], x: number, y: number, z: number): Interactable => ({
  id: `${kind}-${x}`,
  kind,
  x,
  y,
  z,
  label: kind,
  range: 3,
})

describe('stationary resident collision', () => {
  it('makes named city characters and office residents solid', () => {
    const boxes = residentColliders([
      target('city-character', 4, 1.45, 8),
      target('agent-office', -6, 181.5, -12),
    ])

    expect(boxes).toHaveLength(2)
    expect(boxes[0].max[0] - boxes[0].min[0]).toBeCloseTo(RESIDENT_COLLIDER_WIDTH)
    expect(boxes[0].max[1] - boxes[0].min[1]).toBeCloseTo(RESIDENT_COLLIDER_HEIGHT)
    expect((boxes[0].min[0] + boxes[0].max[0]) / 2).toBe(4)
    expect((boxes[1].min[2] + boxes[1].max[2]) / 2).toBe(-12)
  })

  it('does not create invisible bodies for prompts or duplicate Iris', () => {
    expect(
      residentColliders([
        target('elevator-panel', 0, 1.2, -28),
        target('secretary', -6.5, 1.5, -13.4),
      ]),
    ).toEqual([])
  })
})
