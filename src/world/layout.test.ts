import { describe, expect, it } from 'vitest'
import { collidesAt } from '../gameplay/collision'
import { STREET_LIGHTS, STREET_PROPS, STREET_TREES } from './city-data'
import {
  ENTRANCE_COLUMNS,
  HQ,
  OFFICE,
  OFFICE_SLOTS,
  PLAZA_BOLLARDS,
  PLAZA_PLANTERS,
  hqColliders,
  staticColliders,
} from './layout'

describe('visible world collision parity', () => {
  it('makes every authored street and plaza solid block the player', () => {
    const colliders = staticColliders()
    const centres = [
      ...STREET_PROPS,
      ...PLAZA_PLANTERS,
      ...PLAZA_BOLLARDS,
      ...ENTRANCE_COLUMNS,
      ...STREET_LIGHTS.map((light) => ({ ...light, height: 4.6 })),
      ...STREET_TREES.map((tree) => ({ ...tree, height: 2.5 * tree.scale })),
    ]

    for (const solid of centres) {
      expect(
        collidesAt({ x: solid.x, y: 0, z: solid.z }, colliders),
        `${'id' in solid ? solid.id : `${solid.x}:${solid.z}`} is missing collision`,
      ).toBe(true)
    }
  })

  it('blocks office glass but preserves its central doorway', () => {
    const colliders = hqColliders()

    for (const slot of OFFICE_SLOTS) {
      const frontX = slot.x + (slot.side * OFFICE.w) / 2
      const backX = slot.x - (slot.side * OFFICE.w) / 2
      const panelZ = slot.z + (OFFICE.d / 2 - OFFICE.d / 8)
      expect(Math.abs(frontX), 'office entrance must face the central corridor').toBeLessThan(
        Math.abs(backX),
      )
      expect(collidesAt({ x: frontX, y: HQ.y, z: panelZ }, colliders)).toBe(true)
      expect(collidesAt({ x: frontX, y: HQ.y, z: slot.z }, colliders)).toBe(false)
      expect(collidesAt({ x: backX, y: HQ.y, z: slot.z }, colliders)).toBe(true)
    }
  })
})
