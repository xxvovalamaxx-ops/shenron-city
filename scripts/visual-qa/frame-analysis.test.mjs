import { describe, expect, it } from 'vitest'
import {
  analyzeFrame,
  frameDiff,
  runChecks,
  runFrameDiffCheck,
} from './frame-analysis.mjs'

/** Build a synthetic RGBA buffer from a per-pixel luma function. */
function makeFrame(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const [r, g, b] = pixel(x, y)
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

const solidBlack = () => makeFrame(256, 144, () => [0, 0, 0])
const solidGray = () => makeFrame(256, 144, () => [128, 128, 128])
const gradient = () =>
  makeFrame(256, 144, (x, y) => {
    const v = Math.floor(255 * (x / 256) + 30 * (y / 144))
    return [v, v, v]
  })
const skyline = () =>
  makeFrame(256, 144, (x, y) => {
    // Bright sky band, mid buildings with dark windows, bright textured ground.
    if (y < 48) return [190 + ((x * 7 + y * 13) % 64), 200, 210]
    if (y > 104) return [90 + Math.floor(x / 85) * 40 + ((x * 5 + y * 3) % 60), 80 + Math.floor(x / 85) * 30 + ((x * 11 + y * 7) % 50), 70 + Math.floor(x / 85) * 20 + ((x * 3 + y * 17) % 60)]
    if ((x * 3) % 11 < 2 || (y * 7) % 13 < 2) return [12, 14, 18]
    const v = 30 + ((x * 7 + y * 13) % 24) * 6
    return [v, v + 2, v + 6]
  })
const nightFrame = () =>
  makeFrame(256, 144, (x, y) => {
    if (y > 104) return [8 + (x % 5), 7, 6]
    if ((x * 3) % 11 < 2) return [24, 8, 6]
    return [1, 1, 3]
  })

describe('analyzeFrame', () => {
  it('detects a solid black frame as near-black with zero variance', () => {
    const m = analyzeFrame(solidBlack())
    expect(m.meanLuma).toBeCloseTo(0, 1)
    expect(m.lumaStddev).toBe(0)
    expect(m.nearBlackFraction).toBe(1)
    expect(m.distinctColors).toBe(1)
  })

  it('computes luma statistics for a gradient', () => {
    const m = analyzeFrame(gradient())
    expect(m.meanLuma).toBeGreaterThan(100)
    expect(m.lumaStddev).toBeGreaterThan(40)
    expect(m.minLuma).toBeLessThan(5)
    expect(m.maxLuma).toBeGreaterThan(200)
    expect(m.overexposedFraction).toBeLessThan(0.5)
  })

  it('rejects empty buffers', () => {
    expect(() => analyzeFrame({ data: null, width: 10, height: 10 })).toThrow()
  })

  it('reports a 3x3 band grid with a visible skyline', () => {
    const m = analyzeFrame(skyline())
    expect(m.bands).toHaveLength(9)
    expect(m.bandMaximum - m.bandMinimum).toBeGreaterThan(5)
    expect(m.edgeFraction).toBeGreaterThan(0.05)
  })
})

describe('frameDiff', () => {
  it('is zero for identical frames', () => {
    expect(frameDiff(skyline(), skyline())).toBe(0)
  })

  it('is positive for different frames', () => {
    const diff = frameDiff(solidGray(), skyline())
    expect(diff).toBeGreaterThan(0)
  })

  it('rejects mismatched sizes', () => {
    expect(() => frameDiff(solidGray(), makeFrame(32, 36, () => [0, 0, 0]))).toThrow()
  })
})

describe('runChecks', () => {
  it('fails every check on a solid black frame', () => {
    const { metrics, results } = runChecks(solidBlack())
    expect(metrics.nearBlackFraction).toBe(1)
    expect(results['frame-not-black'].pass).toBe(false)
    expect(results['frame-not-flat'].pass).toBe(false)
    expect(results['no-void'].pass).toBe(false)
  })

  it('passes the scene checks on a skyline-like frame', () => {
    const { results } = runChecks(skyline())
    for (const [id, result] of Object.entries(results)) {
      expect(result.pass, `check ${id}`).toBe(true)
    }
  })

  it('allows per-scene threshold overrides for night scenes', () => {
    const defaultRun = runChecks(nightFrame())
    expect(defaultRun.results['near-black-budget'].pass).toBe(false)
    const nightRun = runChecks(nightFrame(), { thresholds: { 'near-black-budget': 0.97 } })
    expect(nightRun.results['near-black-budget'].pass).toBe(true)
  })
})

describe('runFrameDiffCheck', () => {
  it('passes a fixed camera with small dynamic changes', () => {
    const a = skyline()
    const b = makeFrame(256, 144, (x, y) => {
      if (y < 48) return [190 + ((x * 7 + y * 13) % 64), 200, 210]
    if (y > 104) return [90 + Math.floor(x / 85) * 40 + ((x * 5 + y * 3) % 60), 80 + Math.floor(x / 85) * 30 + ((x * 11 + y * 7) % 50), 70 + Math.floor(x / 85) * 20 + ((x * 3 + y * 17) % 60)]
      if (x > 120 && y > 60) return [200, 40, 40] // small moving region
      if ((x * 3) % 11 < 2 || (y * 7) % 13 < 2) return [12, 14, 18]
      const v = 30 + ((x * 7 + y * 13) % 24) * 6
      return [v, v + 2, v + 6]
    })
    const result = runFrameDiffCheck(a, b)
    expect(result.diff).toBeGreaterThan(0)
    expect(result.pass).toBe(true)
  })

  it('fails when the whole frame changes (camera moved)', () => {
    const result = runFrameDiffCheck(solidGray(), skyline())
    expect(result.pass).toBe(false)
  })
})
