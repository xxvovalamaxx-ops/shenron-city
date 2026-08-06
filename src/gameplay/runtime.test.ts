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
  })

  afterEach(() => {
    setRuntimePaused(true)
    rt.clock.elapsed = 0
  })

  it('clears every latched action on the transition into pause', () => {
    setRuntimePaused(true)

    expect(rt.paused).toBe(true)
    expect(rt.pauseEpoch).toBe(21)
    expect(Object.values(rt.keys).every((pressed) => !pressed)).toBe(true)
  })

  it('increments the pause epoch once per transition rather than once per frame', () => {
    setRuntimePaused(true)
    setRuntimePaused(true)
    expect(rt.pauseEpoch).toBe(21)
  })

  it('does not clear keys or bump the epoch for the resume transition', () => {
    setRuntimePaused(true)
    rt.keys.forward = true
    setRuntimePaused(false)

    expect(rt.paused).toBe(false)
    expect(rt.pauseEpoch).toBe(21)
    expect(rt.keys.forward).toBe(true)
  })
})

describe('runtime clock', () => {
  it('advances while running and freezes while paused', () => {
    rt.paused = false
    rt.clock.elapsed = 5
    expect(advanceRuntimeTime(0.25)).toBe(5.25)
    setRuntimePaused(true)
    expect(advanceRuntimeTime(0.25)).toBe(5.25)
  })

  it('refuses non-finite and non-positive steps', () => {
    rt.paused = false
    rt.clock.elapsed = 1
    expect(advanceRuntimeTime(Number.NaN)).toBe(1)
    expect(advanceRuntimeTime(-1)).toBe(1)
    expect(advanceRuntimeTime(0)).toBe(1)
  })
})

describe('dev state', () => {
  it('starts with the intro closed and normal speed', () => {
    expect(rt.introSeconds).toBeGreaterThanOrEqual(100)
    expect(rt.devSpeed).toBe(1)
    expect(rt.spawns).toEqual([])
  })
})
