import { beforeEach, describe, expect, it } from 'vitest'
import { clearFigures, streetFigures } from '../../world/life/street-figures'
import {
  ARREST_TIME,
  clearFootPolice,
  createFootPolice,
  OFFICER_RUN_SPEED,
  stepFootPolice,
  type CruiserView,
  type FootPoliceStep,
} from './foot-police'

const free: FootPoliceStep['move'] = (x, _y, z, dx, dz) => ({ x: x + dx, z: z + dz })
const flat: FootPoliceStep['ground'] = () => 12

function step(over: Partial<FootPoliceStep>): FootPoliceStep {
  return { stars: 2, onFoot: true, player: { x: 0, z: 0 }, cruisers: [], dt: 0.05, move: free, ground: flat, ...over }
}

const parked: CruiserView = { id: 7, x: 0, y: 12, z: 20, heading: 0, speed: 0 }

describe('foot police', () => {
  beforeEach(() => clearFigures())

  it('lets the crew out of a stopped cruiser near a suspect on foot', () => {
    const s = createFootPolice()
    stepFootPolice(s, step({ cruisers: [parked] }))
    expect(streetFigures.list.filter((f) => f.role === 'officer')).toHaveLength(2)
  })

  it('sends only the driver at one star', () => {
    const s = createFootPolice()
    stepFootPolice(s, step({ stars: 1, cruisers: [parked] }))
    expect(streetFigures.list).toHaveLength(1)
  })

  it('stays in a moving cruiser and when the player is driving', () => {
    const s = createFootPolice()
    stepFootPolice(s, step({ cruisers: [{ ...parked, speed: 9 }] }))
    stepFootPolice(s, step({ onFoot: false, cruisers: [parked] }))
    expect(streetFigures.list).toHaveLength(0)
  })

  it('runs at the suspect and busts them after holding on', () => {
    const s = createFootPolice()
    let busted = false
    for (let i = 0; i < 400 && !busted; i++) busted = stepFootPolice(s, step({ cruisers: [parked] })).busted
    expect(busted).toBe(true)
    // ~19 m at run speed, plus the hold
    const officer = streetFigures.list.find((f) => f.role === 'officer')!
    expect(Math.hypot(officer.x, officer.z)).toBeLessThan(2)
    expect(OFFICER_RUN_SPEED).toBeLessThan(7.1)
    expect(ARREST_TIME).toBeGreaterThan(0.5)
  })

  it('cannot catch a player who keeps sprinting away', () => {
    const s = createFootPolice()
    let busted = false
    const player = { x: 0, z: 0 }
    for (let i = 0; i < 400; i++) {
      player.z -= 7.1 * 0.05
      busted = busted || stepFootPolice(s, step({ cruisers: [parked], player })).busted
    }
    expect(busted).toBe(false)
  })

  it('walks back and boards when the player gets in a car', () => {
    const s = createFootPolice()
    for (let i = 0; i < 20; i++) stepFootPolice(s, step({ cruisers: [parked] }))
    expect(streetFigures.list.length).toBeGreaterThan(0)
    for (let i = 0; i < 400; i++) stepFootPolice(s, step({ onFoot: false, cruisers: [parked] }))
    expect(streetFigures.list.filter((f) => !f.done)).toHaveLength(0)
  })

  it('clears everyone on a reset', () => {
    const s = createFootPolice()
    stepFootPolice(s, step({ cruisers: [parked] }))
    clearFootPolice(s)
    expect(streetFigures.list.every((f) => f.done)).toBe(true)
    expect(s.deployed.size).toBe(0)
  })
})
