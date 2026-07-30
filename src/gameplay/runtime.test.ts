import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { advanceRuntimeTime, rt, setRuntimePaused } from './runtime'

describe('authoritative runtime pause', () => {
  beforeEach(() => {
    rt.paused = false
    rt.pauseEpoch = 20
    rt.clock.elapsed = 12
    Object.assign(rt.keys, {
      forward: true,
      back: true,
      left: true,
      right: true,
      sprint: true,
      jump: true,
    })
    rt.player.firing = true
    rt.player.aimPoint = { x: 1, y: 2, z: 3 }
    rt.player.heat = 47
    rt.player.overheated = true
    rt.target = {
      id: 'test-target',
      kind: 'secretary',
      x: 0,
      y: 0,
      z: 0,
      label: 'Test',
      range: 1,
    }
  })

  afterEach(() => {
    setRuntimePaused(true)
    rt.clock.elapsed = 0
    rt.player.heat = 0
    rt.player.overheated = false
  })

  it('clears every latched action on the transition into pause', () => {
    setRuntimePaused(true)

    expect(rt.paused).toBe(true)
    expect(rt.pauseEpoch).toBe(21)
    expect(Object.values(rt.keys).every((pressed) => !pressed)).toBe(true)
    expect(rt.player.firing).toBe(false)
    expect(rt.player.aimPoint).toBeNull()
    expect(rt.target).toBeNull()
    expect(rt.player.heat).toBe(47)
    expect(rt.player.overheated).toBe(true)
  })

  it('increments the pause epoch once per transition rather than once per frame', () => {
    setRuntimePaused(true)
    setRuntimePaused(true)
    expect(rt.pauseEpoch).toBe(21)

    setRuntimePaused(false)
    setRuntimePaused(true)
    expect(rt.pauseEpoch).toBe(22)
  })

  it('advances only during active simulation and never catches up paused time', () => {
    expect(advanceRuntimeTime(0.25)).toBe(12.25)

    setRuntimePaused(true)
    expect(advanceRuntimeTime(60)).toBe(12.25)

    setRuntimePaused(false)
    expect(advanceRuntimeTime(0.5)).toBe(12.75)
    expect(advanceRuntimeTime(Number.POSITIVE_INFINITY)).toBe(12.75)
  })
})
