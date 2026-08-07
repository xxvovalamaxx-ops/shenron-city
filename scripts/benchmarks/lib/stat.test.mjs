/**
 * Tests for the frame-time statistics.
 *
 * These exist because the low-FPS figures were inverted for the whole of Phase
 * 2O and nothing caught it: `sorted` is ascending frame times, the code took
 * the 1st percentile, and published the fastest 1% of frames as the "1% low".
 * Every assertion below fails against that implementation.
 *
 * The load-bearing one is `a low can never beat the average`. It is a property
 * of the definition, not of any particular capture, so it holds for every
 * distribution — and the inverted statistic violates it on every distribution
 * that is not perfectly flat.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { percentile, meanOfSlowest, summarizeFrames } = require('./stat.cjs')

/** 100 frames at 120 fps (8.33 ms) with `bad` frames at `badMs`. */
function frames(bad = 0, badMs = 100, good = 8.333333, total = 100) {
  return [
    ...Array.from({ length: total - bad }, () => good),
    ...Array.from({ length: bad }, () => badMs),
  ]
}

describe('meanOfSlowest', () => {
  it('averages the slow end of an ascending array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
    expect(meanOfSlowest(sorted, 0.1)).toBe(100)
    expect(meanOfSlowest(sorted, 0.2)).toBe((9 + 100) / 2)
  })

  it('never returns NaN for a fraction that rounds to zero frames', () => {
    // 45 samples x 0.1% = 0.045 frames. Rounding that down would slice nothing
    // and average an empty array; the honest answer is the worst frame seen.
    const sorted = Array.from({ length: 45 }, (_, i) => i + 1)
    expect(meanOfSlowest(sorted, 0.001)).toBe(45)
  })

  it('is empty-safe', () => {
    expect(Number.isNaN(meanOfSlowest([], 0.01))).toBe(true)
  })
})

describe('summarizeFrames — lows measure the slow end', () => {
  it('a mean-of-slowest low can never exceed the average, on any distribution', () => {
    // The load-bearing invariant. The slowest k frames always contain the
    // worst frame, so their mean frame time is >= the overall mean, so their
    // FPS is <= the average FPS. No distribution escapes it.
    //
    // The inverted implementation fails here on every case with bad > 0:
    // taking the FASTEST 1% gives a frame time below the mean, and therefore
    // an FPS above the average FPS.
    for (const bad of [0, 1, 5, 20, 50, 99]) {
      const s = summarizeFrames(frames(bad))
      expect(s.fps.low1).toBeLessThanOrEqual(s.fps.avg + 1e-9)
      expect(s.fps.low01).toBeLessThanOrEqual(s.fps.avg + 1e-9)
    }
  })

  it('the percentile convention may exceed the average, and that is not a bug', () => {
    // Nearest-rank p99 of exactly 100 samples is the 99th smallest — the
    // single worst frame is excluded by construction. One frame bad enough to
    // drag the mean can therefore leave low1P99 above the average FPS.
    //
    // Pinned deliberately. It is the reason mean-of-slowest is the primary
    // field, and someone who "fixes" this by shifting the rank would quietly
    // change what every p99 in the repo means.
    const s = summarizeFrames(frames(1, 100))
    expect(s.fps.low1P99).toBeGreaterThan(s.fps.avg)
    expect(s.frameMs.low1P99).toBeCloseTo(8.333333, 6)
    // The primary low is not fooled by the same sample.
    expect(s.fps.low1).toBeCloseTo(10, 6)
  })

  it('the 0.1% low is never kinder than the 1% low', () => {
    const s = summarizeFrames(frames(5))
    expect(s.fps.low01).toBeLessThanOrEqual(s.fps.low1 + 1e-9)
    expect(s.frameMs.low01).toBeGreaterThanOrEqual(s.frameMs.low1 - 1e-9)
  })

  it('reads the actual slow frames, not merely some number below the average', () => {
    // 99 frames at 8.333 ms and one at 100 ms. The slowest 1% is exactly that
    // one frame, so the 1% low is 10 fps — not 120, and not the ~118 fps
    // average either. A test that only asserted low <= avg would pass on an
    // implementation that returned the median.
    const s = summarizeFrames(frames(1, 100))
    expect(s.frameMs.low1).toBeCloseTo(100, 6)
    expect(s.fps.low1).toBeCloseTo(10, 6)
    expect(s.fps.avg).toBeGreaterThan(100)
  })

  it('gets worse when the capture gets worse', () => {
    // The direction that matters. Under the inverted statistic a run with MORE
    // stutter reports a HIGHER "low": extra slow frames never reach the fast
    // tail it was sampling, so the number is unmoved or improves.
    //
    // 1000 frames so the slowest 1% is a 10-frame slice whose composition can
    // actually change. At 5 bad frames the slice is half good; at 20 it is all
    // bad. (With 100 frames the slice is one frame and both runs report the
    // same low — correctly, which is why that phrasing of the test was wrong.)
    const calm = summarizeFrames(frames(5, 100, 8.333333, 1000))
    const choppy = summarizeFrames(frames(20, 100, 8.333333, 1000))
    expect(choppy.fps.low1).toBeLessThan(calm.fps.low1)
    expect(choppy.frameMs.low1).toBeCloseTo(100, 6)

    // And deeper stutter at the same frequency also reads worse.
    const deeper = summarizeFrames(frames(5, 300, 8.333333, 1000))
    expect(deeper.fps.low1).toBeLessThan(calm.fps.low1)
  })

  it('is stable under the percentile convention too', () => {
    const s = summarizeFrames(frames(5, 50))
    // 5 of 100 frames are slow, so the 99th percentile lands among them.
    expect(s.frameMs.low1P99).toBeCloseTo(50, 6)
  })

  it('min fps comes from the worst frame and max from the best', () => {
    const s = summarizeFrames(frames(3, 250))
    expect(s.fps.min).toBeCloseTo(1000 / 250, 6)
    expect(s.fps.max).toBeCloseTo(1000 / 8.333333, 6)
    expect(s.fps.min).toBeLessThanOrEqual(s.fps.low01)
  })

  it('keeps dead frames in the distribution and counts them', () => {
    const s = summarizeFrames([...frames(0), 2000])
    expect(s.deadFrames).toBe(1)
    expect(s.frameMs.max).toBe(2000)
    // A 2 s stall must drag the low down; excluding it would flatter the run.
    expect(s.fps.low01).toBeCloseTo(0.5, 6)
  })

  it('publishes which convention produced the lows', () => {
    const s = summarizeFrames(frames(2))
    expect(s.lows.method).toMatch(/mean-of-slowest/)
    // The inverted fields must be gone, not merely corrected in place: a
    // consumer reading `fps.p1` should break loudly rather than read a number
    // whose meaning silently changed.
    expect(s.fps).not.toHaveProperty('p1')
    expect(s.fps).not.toHaveProperty('p01')
    expect(s.frameMs).not.toHaveProperty('p1')
    expect(s.lows.supersedes).toContain('fps.p1')
  })

  it('survives an empty or all-invalid sample without inventing numbers', () => {
    const s = summarizeFrames([0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    expect(s.frames).toBe(0)
    expect(Number.isNaN(s.fps.low1)).toBe(true)
  })
})

describe('percentile', () => {
  it('is nearest-rank and clamps at both ends', () => {
    const sorted = [10, 20, 30, 40, 50]
    expect(percentile(sorted, 0)).toBe(10)
    expect(percentile(sorted, 0.5)).toBe(30)
    expect(percentile(sorted, 1)).toBe(50)
    expect(percentile(sorted, 2)).toBe(50)
    expect(Number.isNaN(percentile([], 0.5))).toBe(true)
  })
})
