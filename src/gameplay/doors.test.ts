import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOOR,
  initialDoor,
  isPassable,
  leafInnerEdge,
  leafOffset,
  stepDoor,
  type DoorState,
} from './doors'
import { slidingDoorColliders } from '../world/layout'
import { collidesAt } from './collision'

const dt = 1 / 60

function hold(state: DoorState, dx: number, dz: number, seconds: number): DoorState {
  let s = state
  for (let t = 0; t < seconds; t += dt) s = stepDoor(s, { dx, dz, dt })
  return s
}

describe('automatic doors', () => {
  it('opens fully when the player approaches', () => {
    const s = hold(initialDoor(), 0, 2, DEFAULT_DOOR.travelTime + 0.2)
    expect(s.openness).toBe(1)
    expect(isPassable(s)).toBe(true)
  })

  it('is fully open before a walking player reaches the threshold', () => {
    // The failure this guards: a sensor too shallow for the door speed means
    // you walk into a door that is still opening.
    const WALK_SPEED = 4.3
    let s = initialDoor()
    let z = DEFAULT_DOOR.triggerHalfDepth // first moment the sensor sees us
    while (z > 0) {
      s = stepDoor(s, { dx: 0, dz: z, dt })
      z -= WALK_SPEED * dt
    }
    expect(isPassable(s)).toBe(true)
    expect(s.openness).toBe(1)
  })

  it('stays shut when the player is nowhere near', () => {
    const s = hold(initialDoor(), 40, 40, 2)
    expect(s.openness).toBe(0)
  })

  it('never closes while the player stands in the doorway', () => {
    let s = hold(initialDoor(), 0, 0, DEFAULT_DOOR.travelTime + 0.2)
    // Loiter well past the dwell time.
    for (let t = 0; t < 30; t += dt) {
      s = stepDoor(s, { dx: 0, dz: 0, dt })
      expect(s.openness).toBe(1)
    }
  })

  it('closes only after the player leaves and the dwell expires', () => {
    let s = hold(initialDoor(), 0, 0, DEFAULT_DOOR.travelTime + 0.2)
    const away = 99
    s = hold(s, away, away, DEFAULT_DOOR.dwellTime * 0.5)
    expect(s.openness).toBe(1) // still dwelling

    s = hold(s, away, away, DEFAULT_DOOR.dwellTime + DEFAULT_DOOR.travelTime + 0.3)
    expect(s.openness).toBe(0)
  })

  it('leaves meet at the centre when shut and clear the opening when open', () => {
    const hw = 3.4
    // Regression: this shipped inverted. The leaves parted while shut and slid
    // across the doorway as they opened.
    expect(leafInnerEdge(hw, 0)).toBeCloseTo(0, 6)
    expect(leafInnerEdge(hw, 1)).toBeCloseTo(hw, 6)
    // And it is monotonic, so the animation never reverses mid-travel.
    let prev = -Infinity
    for (let o = 0; o <= 1.0001; o += 0.05) {
      const edge = leafInnerEdge(hw, o)
      expect(edge).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = edge
    }
  })

  it('leaf position agrees with the collider at every openness', () => {
    // The bug that hid the inversion: collision said "open" while the mesh
    // said "closed". They must derive from the same number.
    const hw = 3.4
    for (const o of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
      const gapHalfWidth = leafInnerEdge(hw, o)
      const colliders = slidingDoorColliders(0, 0, 0, hw, 4.4, o)
      // Just inside the visual gap must be walkable...
      const inGap = { x: Math.max(0, gapHalfWidth - 0.5), y: 0, z: 0 }
      if (gapHalfWidth > 0.6) {
        expect(collidesAt(inGap, colliders)).toBe(false)
      }
      // ...and a point the leaf visually covers must block.
      if (o < 0.9) {
        const underLeaf = { x: -(hw - 0.15), y: 0, z: 0 }
        expect(collidesAt(underLeaf, colliders)).toBe(true)
      }
    }
  })

  it('offset is symmetric about the doorway centre', () => {
    expect(leafOffset(3.4, 0.4)).toBeGreaterThan(0)
    expect(leafOffset(3.4, 0)).toBeCloseTo(1.7, 6)
  })

  it('does not chatter when the player sits on the trigger boundary', () => {
    // Exactly on the open-trigger edge. Hysteresis should hold it open rather
    // than toggling every frame.
    const edge = DEFAULT_DOOR.triggerHalfDepth
    let s = hold(initialDoor(), 0, edge - 0.01, DEFAULT_DOOR.travelTime + 0.2)
    expect(s.openness).toBe(1)

    let transitions = 0
    let prev = s.openness
    for (let t = 0; t < 5; t += dt) {
      s = stepDoor(s, { dx: 0, dz: edge + 0.01, dt })
      if ((s.openness === 1) !== (prev === 1)) transitions += 1
      prev = s.openness
    }
    expect(transitions).toBe(0)
  })
})
