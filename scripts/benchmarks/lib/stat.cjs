// stat.cjs — honest summary statistics for frame-time samples.
//
// The project rule is "a number you can diff is worth more than a picture":
// every run reports avg/median and conventional lows as ms-per-frame AND fps,
// plus variance across passes, so a claim of "faster" must survive the same
// camera, same route, same settings, same resolution.
//
// ---------------------------------------------------------------------------
// The lows used to measure the wrong end of the distribution.
//
// `sorted` is frame times in ASCENDING order, so a small value is a fast frame.
// The old code took percentile(sorted, 0.01) and published it as the "1% low
// FPS". That is the 1st percentile of frame time — the fastest 1% of frames —
// and converting it to FPS produced a number *higher* than the average, which
// is impossible for any real 1% low. Every "1% low" and "0.1% low" in a
// benchmark JSON generated before this fix is that inverted statistic, not a
// measure of stutter, and the two things move in opposite directions: a run
// that got choppier could report a better "low".
//
// A 1% low is drawn from the SLOWEST frames. Two conventions are in use and
// this file publishes both, because they answer different questions:
//
//   avgOfWorst  the mean frame time of the slowest 1% (or 0.1%) of frames.
//               This is what CapFrameX, GamersNexus and most reviewers mean by
//               "1% low", and it is the primary field here. It is sensitive to
//               how bad the bad frames are, which is the thing a player feels.
//
//   percentile  the 99th (or 99.9th) percentile frame time. A single order
//               statistic — cheaper to reason about, immune to one catastrophic
//               outlier, and the right choice for a pass/fail gate.
//
// Both are reported under `lows`, with an explicit `method` label, so no reader
// has to guess which definition a number came from.
// ---------------------------------------------------------------------------

/**
 * The value at fraction `p` of an ascending array, by nearest-rank.
 *
 * p = 0.99 is the 99th percentile: the value 99% of samples are at or below.
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]
}

/**
 * Mean of the slowest `fraction` of an ascending array of frame times.
 *
 * Always averages at least one frame: at 45 samples the slowest 0.1% rounds to
 * zero frames, and a low computed from an empty slice would be NaN rather than
 * "the worst frame we saw".
 */
function meanOfSlowest(sorted, fraction) {
  if (sorted.length === 0) return NaN
  const n = Math.max(1, Math.round(sorted.length * fraction))
  const slice = sorted.slice(sorted.length - n)
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

/**
 * Summarise frame deltas (ms).
 *
 * Deltas > 1000 ms are stall/dead frames, reported separately but kept in the
 * distribution — dropping them would flatter exactly the runs that deserve it
 * least.
 */
function summarizeFrames(deltas) {
  const valid = deltas.filter((d) => Number.isFinite(d) && d > 0)
  const dead = valid.filter((d) => d > 1000).length
  const sorted = [...valid].sort((a, b) => a - b)
  const sum = sorted.reduce((a, b) => a + b, 0)
  const avg = sum / Math.max(1, sorted.length)
  const median = percentile(sorted, 0.5)

  // Slowest 1% / 0.1%, both conventions.
  const low1Mean = meanOfSlowest(sorted, 0.01)
  const low01Mean = meanOfSlowest(sorted, 0.001)
  const low1Pct = percentile(sorted, 0.99)
  const low01Pct = percentile(sorted, 0.999)

  const fps = (f) => 1000 / f

  return {
    frames: valid.length,
    deadFrames: dead,
    frameMs: {
      avg,
      median,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      // Frame time rises as performance falls, so these are the LARGEST values.
      low1: low1Mean,
      low01: low01Mean,
      low1P99: low1Pct,
      low01P999: low01Pct,
    },
    fps: {
      avg: fps(avg),
      median: fps(median),
      min: fps(sorted[sorted.length - 1]),
      max: fps(sorted[0]),
      /** Conventional 1% low: mean FPS across the slowest 1% of frames. */
      low1: fps(low1Mean),
      /** Conventional 0.1% low. */
      low01: fps(low01Mean),
      /** 99th-percentile-frame-time FPS, for a stable pass/fail gate. */
      low1P99: fps(low1Pct),
      low01P999: fps(low01Pct),
    },
    lows: {
      method: 'mean-of-slowest (primary); nearest-rank percentile (secondary)',
      // Named so a reader of an old JSON cannot mistake these for the fields
      // that used to sit here. See the header: p1/p01 were inverted.
      supersedes: ['fps.p1', 'fps.p01', 'frameMs.p1', 'frameMs.p01'],
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

module.exports = { percentile, meanOfSlowest, summarizeFrames, varianceAcrossPasses }
