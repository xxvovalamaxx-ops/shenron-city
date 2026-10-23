import { describe, expect, it } from 'vitest'
import { createHeli, HELI_ORBIT_HEIGHT, HELI_ORBIT_RADIUS, heliSees, stepHeli } from './helicopter'

const player = { x: 100, z: -50 }

function run(stars: number, seconds: number, s = createHeli()) {
  for (let t = 0; t < seconds; t += 0.05) stepHeli(s, { stars, player, groundY: 12, dt: 0.05 })
  return s
}

describe('police helicopter', () => {
  it('stays away below three stars', () => {
    expect(run(2, 10).active).toBe(false)
  })

  it('flies in and circles the suspect at three stars', () => {
    const s = run(3, 60)
    expect(s.active).toBe(true)
    const r = Math.hypot(s.x - player.x, s.z - player.z)
    expect(r).toBeGreaterThan(HELI_ORBIT_RADIUS * 0.6)
    expect(r).toBeLessThan(HELI_ORBIT_RADIUS * 1.6)
    expect(s.y).toBeGreaterThan(12 + HELI_ORBIT_HEIGHT * 0.7)
    expect(Math.hypot(s.light.x - player.x, s.light.z - player.z)).toBeLessThan(3)
    expect(heliSees(s, player)).toBe(true)
  })

  it('leaves and despawns when the heat drops', () => {
    const s = run(3, 40)
    run(1, 2, s)
    expect(s.leaving).toBe(true)
    expect(heliSees(s, player)).toBe(false)
    run(1, 60, s)
    expect(s.active).toBe(false)
  })

  it('never exceeds its top speed', () => {
    const s = createHeli()
    for (let t = 0; t < 30; t += 0.05) {
      stepHeli(s, { stars: 4, player, groundY: 12, dt: 0.05 })
      expect(Math.hypot(s.vx, s.vz)).toBeLessThanOrEqual(32.01)
    }
  })
})
