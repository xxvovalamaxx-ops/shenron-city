#!/usr/bin/env node
// aggregate.cjs — fold the per-run JSON evidence into PHASE2O_BASELINE.json.
//
// Reads every <tag>.json aggregate written by run.cjs in
// evidence/performance/phase2o-a and emits one canonical table of means plus
// pass variance. Run after each batch of harness runs.

const path = require('node:path')
const fs = require('node:fs')

const REPO = path.resolve(__dirname, '..', '..')
const EVIDENCE = path.join(REPO, 'evidence', 'performance', 'phase2o-a')
const OUT = path.join(REPO, 'docs', 'performance', 'PHASE2O_BASELINE.json')

const files = fs.readdirSync(EVIDENCE)
  .filter((f) => f.endsWith('.json') && !f.includes('-pass'))

const runs = []
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(EVIDENCE, f), 'utf8'))
    if (!j.variance) continue
    runs.push(j)
  } catch { /* not an aggregate */ }
}

runs.sort((a, b) => `${a.app}-${a.location}-${a.scenario}`.localeCompare(`${b.app}-${b.location}-${b.scenario}`))

// pull the first pass's deep metrics for reference (render time, errors,
// integrity, transition, CPU)
function firstPass(tag) {
  const f = path.join(EVIDENCE, `${tag}-pass1.json`)
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null }
}

const rows = runs.map((r) => {
  const tag = `${r.app}-${r.location}-${r.scenario}` +
    (r.app === 'shenron' ? `-${r.quality}` : '')
  const p1 = firstPass(tag)
  return {
    app: r.app,
    location: r.location,
    scenario: r.scenario,
    quality: r.quality ?? null,
    passes: r.passes,
    seconds: r.seconds,
    cameraAsserted: r.notes?.cameraAsserted ?? null,
    manhattanProjection: r.notes?.manhattanProjection ?? null,
    fpsAvg: r.variance.fpsAvg?.mean ?? null,
    fpsP1: r.variance.fpsP1?.mean ?? null,
    fpsP01: r.variance.fpsP01?.mean ?? null,
    spreadPct: r.variance.fpsAvg?.spreadPct ?? null,
    appStats: p1?.appStats ?? null,
    transition: p1?.transition ?? null,
    cpu: p1?.cpu ?? null,
    errors: p1?.errors ?? null,
    integrity: p1?.integrity ?? null,
    soakBuckets: p1?.buckets ?? null,
    loadMs: p1?.loadMs ?? null,
    gpu: p1?.gpu ?? null,
  }
})

const out = {
  schemaVersion: 2,
  generatedAtUtc: new Date().toISOString(),
  harness: {
    url: 'scripts/benchmarks/run.cjs',
    resolution: '1280x720, DPR 1',
    browser: 'headless Chrome (CDP)',
    gpu: rows.find((r) => r.gpu)?.gpu ?? null,
    passesPerRun: 3,
    integrity: 'per-pass sha256 + 4x4 luminance bands + frame diff vs pass 1',
    cpu: 'CDP Performance.getMetrics deltas (noisy on short windows; treat as indicative)',
  },
  count: rows.length,
  runs: rows,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`wrote ${OUT} (${rows.length} runs)`)
