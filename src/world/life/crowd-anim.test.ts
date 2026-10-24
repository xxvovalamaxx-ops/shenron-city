import { describe, expect, it } from 'vitest'
import {
  animRows, cycleRate, framesFor, layoutClips, nearestRow, newAnimState, playClip, sampleRows, stepAnim,
  strideFromFoot, FADE_SECONDS,
} from './crowd-anim'

describe('crowd clip layout', () => {
  it('stacks clips into consecutive rows at 30 fps', () => {
    const l = layoutClips([
      { name: 'Walk', duration: 1.0 },
      { name: 'Idle', duration: 2.5 },
      { name: 'Wave', duration: 0.5, loop: false },
    ])
    expect(l.clips.Walk).toMatchObject({ start: 0, frames: 30, loop: true })
    expect(l.clips.Idle).toMatchObject({ start: 30, frames: 75 })
    // a one-shot keeps its final frame
    expect(l.clips.Wave).toMatchObject({ start: 105, frames: 16, loop: false })
    expect(l.rows).toBe(121)
  })

  it('never produces a zero-length clip', () => {
    expect(framesFor(0.001, true)).toBe(1)
    expect(framesFor(0.001, false)).toBe(2)
  })
})

describe('sampling rows', () => {
  const walk = { name: 'Walk', start: 40, frames: 30, duration: 1, loop: true }

  it('brackets the phase with neighbouring frames', () => {
    const s = sampleRows(walk, 0.5)
    expect(s.a).toBe(55)
    expect(s.b).toBe(56)
    expect(s.w).toBeCloseTo(0, 6)
    const t = sampleRows(walk, 0.51)
    expect(t.a).toBe(55)
    expect(t.w).toBeCloseTo(0.3, 5)
  })

  it('wraps a loop back to its first row, never past its last', () => {
    const s = sampleRows(walk, 0.99)
    expect(s.a).toBe(69)
    expect(s.b).toBe(40)
    const next = sampleRows(walk, 3.25)
    expect(next.a).toBe(47)
    const neg = sampleRows(walk, -0.25)
    expect(neg.a).toBe(62)
  })

  it('clamps a one-shot at its ends', () => {
    const wave = { name: 'Wave', start: 0, frames: 16, duration: 0.5, loop: false }
    expect(sampleRows(wave, 2).a).toBe(15)
    expect(sampleRows(wave, 2).b).toBe(15)
    expect(sampleRows(wave, -1).a).toBe(0)
    expect(nearestRow(wave, 0.99)).toBe(15)
  })
})

describe('animation state', () => {
  const clips = layoutClips([{ name: 'Walk', duration: 1 }, { name: 'Idle', duration: 2 }]).clips

  it('advances by rate and crossfades on a clip change', () => {
    const s = newAnimState('Walk', 0)
    stepAnim(s, 0.5, 1)
    expect(s.phase).toBeCloseTo(0.5)
    playClip(s, 'Idle')
    expect(s.prev).toBe('Walk')
    expect(s.fade).toBe(1)
    const r = animRows(s, clips)
    // start of the fade: all old clip
    expect(r.a).toBe(15)
    expect(r.b).toBe(30)
    expect(r.w).toBeCloseTo(0)
    stepAnim(s, FADE_SECONDS / 2, 0.5)
    expect(animRows(s, clips).w).toBeCloseTo(0.5)
    stepAnim(s, FADE_SECONDS, 0.5)
    expect(s.fade).toBe(0)
    expect(s.prev).toBeNull()
    const settled = animRows(s, clips)
    expect(settled.a).toBeGreaterThanOrEqual(30)
  })

  it('ignores a switch to the clip already playing', () => {
    const s = newAnimState('Idle', 0.3)
    playClip(s, 'Idle', 0.9)
    expect(s.phase).toBe(0.3)
    expect(s.fade).toBe(0)
  })

  it('returns row 0 for an unknown clip rather than throwing', () => {
    expect(animRows(newAnimState('Nope'), clips)).toEqual({ a: 0, b: 0, w: 0 })
  })
})

describe('gait speed', () => {
  it('scales cadence with speed and inversely with body size', () => {
    expect(cycleRate(1.4, 1.4)).toBeCloseTo(1)
    expect(cycleRate(2.8, 1.4)).toBeCloseTo(2)
    // a smaller person takes more cycles to cover the same ground
    expect(cycleRate(1.4, 1.4, 0.8)).toBeGreaterThan(cycleRate(1.4, 1.4, 1))
    expect(cycleRate(-1, 1.4)).toBe(0)
  })

  it('measures stride from the planted foot drifting back', () => {
    // 30 frames: 18 planted frames moving back 0.04 m each, 12 swinging forward
    const z: number[] = []
    let p = 0.36
    for (let i = 0; i < 18; i++) z.push((p -= 0.04))
    for (let i = 0; i < 12; i++) z.push((p += 0.06))
    // body speed = 0.04 m/frame, over 30 frames = 1.2 m per cycle
    expect(strideFromFoot(z)).toBeCloseTo(1.2, 5)
    expect(strideFromFoot([1, 1])).toBe(0)
  })
})
