/**
 * The avatar became visible when third person landed, and a single looping
 * clip is the most obvious way for it to look broken. Thresholds come from
 * GameLoop's own WALK_SPEED and SPRINT_SPEED, so these pin that relationship.
 */
import { describe, expect, it } from 'vitest'
import {
  CLIP_REFERENCE_SPEED,
  IDLE_SPEED,
  playerAnimationRate,
  playerMotionFor,
  SPRINT_SPEED,
  WALK_SPEED,
} from './player-locomotion'

const grounded = (speed: number) => playerMotionFor({ speed, grounded: true })

describe('playerMotionFor', () => {
  it('stands still when stopped', () => {
    expect(grounded(0)).toBe('Idle_Loop')
    expect(grounded(IDLE_SPEED - 0.01)).toBe('Idle_Loop')
  })

  it('distinguishes the two speeds the player can actually move at', () => {
    // The whole point: walking and sprinting must not look the same.
    expect(grounded(WALK_SPEED)).not.toBe(grounded(SPRINT_SPEED))
  })

  it('runs rather than strolls at the walk key speed', () => {
    // 4.3 m/s is a jog in reality, whatever the key is called.
    expect(grounded(WALK_SPEED)).toBe('Jog_Fwd_Loop')
  })

  it('sprints at the sprint key speed', () => {
    expect(grounded(SPRINT_SPEED)).toBe('Sprint_Loop')
  })

  it('strolls at a genuinely slow speed', () => {
    expect(grounded(1.2)).toBe('Walk_Loop')
  })

  it('lets airborne win over any ground speed', () => {
    for (const speed of [0, 1.2, WALK_SPEED, SPRINT_SPEED, 99]) {
      expect(playerMotionFor({ speed, grounded: false })).toBe('Jump_Loop')
    }
  })

  it('treats a non-finite speed as standing rather than picking a random clip', () => {
    for (const bad of [NaN, Infinity, -Infinity, -3]) {
      expect(grounded(bad)).toBe('Idle_Loop')
    }
  })

  it('never skips a band as speed rises', () => {
    const seen: string[] = []
    for (let s = 0; s <= 9; s += 0.05) {
      const m = grounded(s)
      if (seen[seen.length - 1] !== m) seen.push(m)
    }
    expect(seen).toEqual(['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'])
  })
})

describe('playerAnimationRate', () => {
  it('plays each locomotion clip near 1 at its authored speed', () => {
    for (const motion of ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'] as const) {
      expect(playerAnimationRate(motion, CLIP_REFERENCE_SPEED[motion])).toBeCloseTo(1, 6)
    }
  })

  it('speeds up and slows down with ground speed', () => {
    expect(playerAnimationRate('Walk_Loop', 2.9)).toBeGreaterThan(1)
    expect(playerAnimationRate('Walk_Loop', 0.8)).toBeLessThan(1)
  })

  it('leaves clips with no forward motion at their authored rate', () => {
    // Otherwise a standing character breathes faster the harder they had run.
    for (const motion of ['Idle_Loop', 'Jump_Loop'] as const) {
      for (const speed of [0, 2, 7]) {
        expect(playerAnimationRate(motion, speed)).toBe(1)
      }
    }
  })

  it('clamps rather than blurring or freezing', () => {
    expect(playerAnimationRate('Walk_Loop', 500)).toBeLessThanOrEqual(1.8)
    expect(playerAnimationRate('Sprint_Loop', 0.01)).toBeGreaterThanOrEqual(0.4)
  })

  it('never returns a non-finite rate', () => {
    for (const bad of [NaN, Infinity, -1]) {
      expect(Number.isFinite(playerAnimationRate('Jog_Fwd_Loop', bad))).toBe(true)
    }
  })
})
