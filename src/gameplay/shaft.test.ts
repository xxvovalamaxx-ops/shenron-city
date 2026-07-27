import { describe, expect, it } from 'vitest'
import { isLandingOpen, shaftGuards } from './shaft'
import { FLOORS } from './elevator'
import { collidesAt } from './collision'
import { SHAFT } from '../world/layout'

/** Standing in the shaft doorway on a given floor. */
const inDoorway = (floorY: number) => ({ x: 0, y: floorY, z: SHAFT.doorZ })

describe('shaft landing safety', () => {
  it('blocks a floor when the car is elsewhere', () => {
    // Car parked in the lobby; the player is on 45 walking at the opening.
    const guards = shaftGuards(FLOORS.lobby.y, 1)
    expect(collidesAt(inDoorway(FLOORS.hq.y), guards)).toBe(true)
  })

  it('blocks every floor while the car is in transit', () => {
    const guards = shaftGuards(90, 0)
    expect(collidesAt(inDoorway(FLOORS.lobby.y), guards)).toBe(true)
    expect(collidesAt(inDoorway(FLOORS.hq.y), guards)).toBe(true)
  })

  it('blocks the floor the car is at while its doors are shut', () => {
    const guards = shaftGuards(FLOORS.lobby.y, 0)
    expect(collidesAt(inDoorway(FLOORS.lobby.y), guards)).toBe(true)
  })

  it('blocks while the doors are only part way open', () => {
    const guards = shaftGuards(FLOORS.lobby.y, 0.5)
    expect(collidesAt(inDoorway(FLOORS.lobby.y), guards)).toBe(true)
  })

  it('opens only when the car is aligned and the doors are open', () => {
    const guards = shaftGuards(FLOORS.hq.y, 1)
    expect(collidesAt(inDoorway(FLOORS.hq.y), guards)).toBe(false)
    // ...and the other floor stays sealed.
    expect(collidesAt(inDoorway(FLOORS.lobby.y), guards)).toBe(true)
  })

  it('treats a car stopped just short of the floor as not arrived', () => {
    expect(isLandingOpen('hq', FLOORS.hq.y - 2, 1)).toBe(false)
    expect(isLandingOpen('hq', FLOORS.hq.y - 0.1, 1)).toBe(true)
  })

  it('never leaves both floors open at once', () => {
    for (let y = 0; y <= FLOORS.hq.y; y += 0.25) {
      for (const openness of [0, 0.5, 0.8, 1]) {
        const open = (['lobby', 'hq'] as const).filter((f) => isLandingOpen(f, y, openness))
        expect(open.length).toBeLessThanOrEqual(1)
      }
    }
  })
})
