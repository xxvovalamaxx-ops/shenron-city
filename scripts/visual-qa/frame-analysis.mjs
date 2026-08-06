/**
 * Numerical frame checks for the visual QA bridge.
 *
 * Pure, dependency-free ESM so the exact same code runs under the Node capture
 * runner and under vitest (node environment). Operates on raw RGBA buffers,
 * never on the DOM, three.js, or canvas — everything here is plain math.
 *
 * A capture produces two frames (A and B) from a fixed camera. Because the
 * camera never moves, any large difference between A and B is either dynamic
 * content (traffic, crowd, rain — expected and bounded) or a rendering
 * regression (flicker, unloaded tiles, post-processing instability).
 */

const LUMA = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Downsample a full RGBA buffer into a fixed grid of mean luma. */
export function lumaGrid(data, width, height, cols, rows) {
  const out = new Float64Array(cols * rows)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx / cols) * width)
      const x1 = Math.floor(((cx + 1) / cols) * width)
      const y0 = Math.floor((cy / rows) * height)
      const y1 = Math.floor(((cy + 1) / rows) * height)
      let sum = 0
      let count = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4
          sum += LUMA(data[i], data[i + 1], data[i + 2])
          count++
        }
      }
      out[cy * cols + cx] = count > 0 ? sum / count : 0
    }
  }
  return out
}

/** Sample every nth pixel to bound cost on 1080p buffers. */
function sampledData(data, width, height, step) {
  const out = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      out.push(data[i], data[i + 1], data[i + 2])
    }
  }
  return out
}

export function analyzeFrame({ data, width, height }) {
  if (!data || width <= 0 || height <= 0) {
    throw new Error('analyzeFrame requires a non-empty RGBA buffer')
  }

  const samples = sampledData(data, width, height, 4)
  let sum = 0
  let sumSq = 0
  let min = 255
  let max = 0
  let nearBlack = 0
  let overexposed = 0
  let brightSatSum = 0
  let brightSatCount = 0
  const seen = new Set()

  for (let i = 0; i < samples.length; i += 3) {
    const r = samples[i]
    const g = samples[i + 1]
    const b = samples[i + 2]
    const luma = LUMA(r, g, b)
    sum += luma
    sumSq += luma * luma
    if (luma < min) min = luma
    if (luma > max) max = luma
    if (luma < 8) nearBlack++
    if (luma > 250) overexposed++
    if (luma > 200) {
      const maxCh = Math.max(r, g, b)
      const minCh = Math.min(r, g, b)
      brightSatSum += maxCh > 0 ? (maxCh - minCh) / maxCh : 0
      brightSatCount++
    }
    seen.add((r << 16) | (g << 8) | b)
  }

  const n = samples.length / 3
  const mean = sum / n
  const variance = Math.max(0, sumSq / n - mean * mean)

  const grid = lumaGrid(data, width, height, 3, 3)
  const bandMinimum = Math.min(...grid)
  const bandMaximum = Math.max(...grid)
  const bandStddev = standardDeviation(grid)

  return {
    width,
    height,
    meanLuma: mean,
    lumaStddev: Math.sqrt(variance),
    minLuma: min,
    maxLuma: max,
    nearBlackFraction: nearBlack / n,
    overexposedFraction: overexposed / n,
    distinctColors: seen.size,
    colorfulness: brightSatCount > 0 ? brightSatSum / brightSatCount : 0,
    bands: Array.from(grid),
    bandMinimum,
    bandMaximum,
    bandStddev,
    // Edge fraction over the luma grid: how many band-to-band transitions
    // exceed a strong step. Silhouettes and depth read as edges.
    edgeFraction: edgeFraction(grid, 3, 3),
    bottomBandMean: grid[6 + 2] || grid[grid.length - 1],
    bottomBandStddev: standardDeviation(grid.slice(grid.length - 3)),
  }
}

function standardDeviation(values) {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function edgeFraction(grid, cols, rows) {
  let edges = 0
  let total = 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x
      if (x + 1 < cols) {
        total++
        if (Math.abs(grid[i] - grid[i + 1]) > 24) edges++
      }
      if (y + 1 < rows) {
        total++
        if (Math.abs(grid[i] - grid[i + cols]) > 24) edges++
      }
    }
  }
  return total > 0 ? edges / total : 0
}

/** Mean absolute luma difference between two same-sized frames, 0..255. */
export function frameDiff(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) {
    throw new Error('frameDiff requires two identically sized frames')
  }
  const aSamples = sampledData(a.data, a.width, a.height, 2)
  const bSamples = sampledData(b.data, b.width, b.height, 2)
  let total = 0
  let count = 0
  for (let i = 0; i < aSamples.length; i += 3) {
    const lA = LUMA(aSamples[i], aSamples[i + 1], aSamples[i + 2])
    const lB = LUMA(bSamples[i], bSamples[i + 1], bSamples[i + 2])
    total += Math.abs(lA - lB)
    count++
  }
  return count > 0 ? total / count : 0
}

export const CHECKS = {
  'frame-not-black': (m) => ({
    pass: m.meanLuma > 6,
    metric: m.meanLuma,
    threshold: '> 6 mean luma',
    severity: 'P0',
  }),
  'frame-not-flat': (m) => ({
    pass: m.lumaStddev > 2 && m.distinctColors > 400,
    metric: { lumaStddev: m.lumaStddev, distinctColors: m.distinctColors },
    threshold: 'lumaStddev > 2 and > 400 distinct colours',
    severity: 'P0',
  }),
  'aspect-ratio': (m) => ({
    pass: Math.abs(m.width / m.height - 16 / 9) < 0.01,
    metric: m.width / m.height,
    threshold: '16:9 within 0.01',
    severity: 'P1',
  }),
  'no-full-black-corner': (m) => ({
    pass: m.bandMinimum > 1,
    metric: m.bandMinimum,
    threshold: 'all 9 bands > 1 mean luma',
    severity: 'P1',
  }),
  'no-void': (m) => ({
    pass: m.bandMaximum - m.bandMinimum > 4,
    metric: m.bandMaximum - m.bandMinimum,
    threshold: 'band spread > 4 (not a solid fill)',
    severity: 'P0',
  }),
  'overexposure-budget': (m) => ({
    pass: m.overexposedFraction < 0.15,
    metric: m.overexposedFraction,
    threshold: '< 0.15 pixels above luma 250',
    severity: 'P2',
  }),
  'near-black-budget': (m) => ({
    pass: m.nearBlackFraction < 0.85,
    metric: m.nearBlackFraction,
    threshold: '< 0.85 pixels below luma 8 (night scenes loosen)',
    severity: 'P2',
  }),
  'band-uniformity': (m) => ({
    pass: m.bandStddev > 1,
    metric: m.bandStddev,
    threshold: 'band luma stddev > 1 (varied framing)',
    severity: 'P2',
  }),
  'silhouette-coverage': (m) => ({
    pass: m.edgeFraction > 0.05,
    metric: m.edgeFraction,
    threshold: '> 0.05 grid edges (geometry present, not fog wall)',
    severity: 'P1',
  }),
  'ground-present': (m) => ({
    pass: m.bottomBandMean > 3 && m.bottomBandStddev > 0.5,
    metric: { mean: m.bottomBandMean, stddev: m.bottomBandStddev },
    threshold: 'bottom band non-black with texture variance',
    severity: 'P2',
  }),
  'color-palette-present': (m) => ({
    pass: m.colorfulness > 0.01,
    metric: m.colorfulness,
    threshold: 'bright-pixel saturation > 0.01',
    severity: 'P2',
  }),
}

/**
 * Run every numerical check against one frame. Night scenes legitimately fail
 * 'near-black-budget' at the default threshold, so per-scene overrides can
 * widen it via opts.thresholds.
 */
export function runChecks(frame, { thresholds = {} } = {}) {
  const metrics = analyzeFrame(frame)
  const results = {}
  for (const [id, check] of Object.entries(CHECKS)) {
    const result = check(metrics)
    const override = thresholds[id]
    if (override !== undefined) {
      const custom = { ...result, pass: overridePass(result, override), threshold: String(override) }
      results[id] = custom
    } else {
      results[id] = result
    }
  }
  return { metrics, results }
}

function overridePass(result, override) {
  if (override === null || override === true || override === false) {
    return override !== false ? result.pass : false
  }
  if (typeof override === 'number') {
    const metric = result.metric
    return typeof metric === 'number' ? metric < override : result.pass
  }
  return result.pass
}

/** Dynamic-content sanity: fixed camera, so diff must be tiny but non-zero. */
export function runFrameDiffCheck(a, b, { max = 12, min = 0.05 } = {}) {
  const diff = frameDiff(a, b)
  return {
    diff,
    pass: diff >= min && diff <= max,
    threshold: `0.05 <= diff <= ${max}`,
  }
}
