import { describe, expect, it } from 'vitest'
import {
  CAPYBARA_CYCLE_SECONDS,
  CAPYBARA_EXPECTED_CLIPS,
  CAPYBARA_ROUTE,
  capybaraCollider,
  capybaraPose,
} from './capybara'
import { hqColliders, staticColliders } from '../world/layout'

describe('capybara route contract', () => {
  it('loops without a position or heading discontinuity', () => {
    const beforeWrap = capybaraPose(CAPYBARA_CYCLE_SECONDS - 0.001)
    const afterWrap = capybaraPose(CAPYBARA_CYCLE_SECONDS + 0.001)

    expect(Math.hypot(beforeWrap.x - afterWrap.x, beforeWrap.z - afterWrap.z)).toBeLessThan(0.01)
    expect(afterWrap).toMatchObject({
      ...CAPYBARA_ROUTE[0],
      clip: 'capybara_idle_breathe',
      moving: false,
    })
  })

  it('uses a walk clip only while position is advancing', () => {
    for (let time = 0; time < CAPYBARA_CYCLE_SECONDS; time += 0.1) {
      const pose = capybaraPose(time)
      expect(pose.moving).toBe(pose.clip === 'capybara_walk')
    }
  })

  it('exposes the complete exported animation contract', () => {
    expect(CAPYBARA_EXPECTED_CLIPS).toHaveLength(21)
    expect(new Set(CAPYBARA_EXPECTED_CLIPS).size).toBe(21)
  })

  it('rotates its conservative collision footprint with the animal', () => {
    const forward = capybaraCollider({ ...capybaraPose(0), heading: 0 })
    const sideways = capybaraCollider({ ...capybaraPose(0), heading: Math.PI / 2 })
    const diagonal = capybaraCollider({ ...capybaraPose(0), heading: Math.PI / 4 })

    const forwardWidth = forward.max[0] - forward.min[0]
    const forwardDepth = forward.max[2] - forward.min[2]
    const sidewaysWidth = sideways.max[0] - sideways.min[0]
    const sidewaysDepth = sideways.max[2] - sideways.min[2]
    const diagonalWidth = diagonal.max[0] - diagonal.min[0]

    expect(forwardDepth).toBeGreaterThan(forwardWidth)
    expect(sidewaysWidth).toBeCloseTo(forwardDepth)
    expect(sidewaysDepth).toBeCloseTo(forwardWidth)
    expect(diagonalWidth).toBeGreaterThan(forwardWidth)
  })

  it('keeps the complete moving footprint clear of authored world solids', () => {
    const solids = [...staticColliders(), ...hqColliders()]

    for (let time = 0; time < CAPYBARA_CYCLE_SECONDS; time += 0.05) {
      const moving = capybaraCollider(capybaraPose(time))
      const overlaps = solids.filter(
        (solid) =>
          moving.min[0] < solid.max[0] &&
          moving.max[0] > solid.min[0] &&
          moving.min[1] < solid.max[1] &&
          moving.max[1] > solid.min[1] &&
          moving.min[2] < solid.max[2] &&
          moving.max[2] > solid.min[2],
      )
      expect(overlaps, `route overlaps world geometry at t=${time.toFixed(2)}s`).toEqual([])
    }
  })
})
