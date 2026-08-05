// stat.cjs — honest summary statistics for frame-time samples.
//
// The project rule is "a number you can diff is worth more than a picture":
// every run reports avg/median/p1/p0.1 as ms-per-frame AND fps, plus variance
// across passes, so a claim of "faster" must survive the same camera, same
// route, same settings, same resolution.

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]
}

/** Summarise frame deltas (ms). Deltas > 1000 ms are dead frames, reported separately. */
function summarizeFrames(deltas) {
  const valid = deltas.filter((d) => Number.isFinite(d) && d > 0)
  const dead = deltas.length - valid.length
  const sorted = [...valid].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  const avg = sum / Math.max(1, sorted.length)
  const median = percentile(sorted, 0.5)
  const p1 = percentile(sorted, 0.01)
  const p01 = percentile(sorted, 0.001)
  // fps from the frame that includes the 1% low: the slowest 1% of frames
  const fps = (f) => 1000 / f
  return {
    frames: valid.length,
    deadFrames: dead,
    frameMs: { avg, median, p1, p01, min: sorted[0], max: sorted[sorted.length - 1] },
    fps: {
      avg: fps(avg),
      median: fps(median),
      p1: fps(p1),
      p01: fps(p01),
      min: fps(sorted[sorted.length - 1]),
    },
  }
}

/** Pass-to-pass spread (max-min)/mean in percent, and per-stat stdev. */
function varianceAcrossPasses(passes) {
  const keys = Object.keys(passes[0]?.stats ?? {})
  const out = {}
  for (const k of keys) {
    const vals = passes.map((p) => p.stats[k])
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, vals.length - 1))
    out[k] = {
      values: vals,
      mean,
      stdev: sd,
      spreadPct: mean === 0 ? 0 : ((Math.max(...vals) - Math.min(...vals)) / mean) * 100,
    }
  }
  return out
}

module.exports = { percentile, summarizeFrames, varianceAcrossPasses }
