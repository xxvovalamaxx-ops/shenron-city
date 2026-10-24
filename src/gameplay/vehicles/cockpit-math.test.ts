import { describe, expect, it } from 'vitest'
import { gaugeAngle, timeSinceWipe, WIPER_SWEEP, wiperAngle, wiperPeriod } from './cockpit-math'

describe('cockpit wipers', () => {
  it('rest at zero and reach the top half way through', () => {
    const T = wiperPeriod(0.5)
    expect(wiperAngle(0, T)).toBeCloseTo(0)
    expect(wiperAngle(T / 2, T)).toBeCloseTo(WIPER_SWEEP)
  })

  it('wipe faster in heavier rain', () => {
    expect(wiperPeriod(1)).toBeLessThan(wiperPeriod(0.1))
  })

  it('reports zero just as the blade passes a point', () => {
    const T = 1.4
    for (const p of [0.1, 0.3, 0.6, 0.9, 1.2]) {
      const phi = wiperAngle(p, T)
      expect(timeSinceWipe(phi, p, T)).toBeLessThan(1e-6 + 1e-9 * p)
    }
  })

  it('counts up between passes and never exceeds a period', () => {
    const T = 1.4
    const phi = 1.0
    let last = timeSinceWipe(phi, 0, T)
    for (let p = 0.01; p < T * 3; p += 0.01) {
      const s = timeSinceWipe(phi, p, T)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(T)
      if (s > last) expect(s - last).toBeCloseTo(0.01, 5)
      last = s
    }
  })
})

describe('gauges', () => {
  it('maps and clamps', () => {
    expect(gaugeAngle(0, 240, -2, 2)).toBe(-2)
    expect(gaugeAngle(120, 240, -2, 2)).toBe(0)
    expect(gaugeAngle(999, 240, -2, 2)).toBe(2)
  })
})
