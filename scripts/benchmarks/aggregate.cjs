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
  .filter((f) => !['vite-manh.log'].includes(f))

const runs = []
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(EVIDENCE, f), 'utf8'))
    if (!j.variance) continue
    runs.push(j)
  } catch { /* not an aggregate */ }
}

runs.sort((a, b) => `${a.app}-${a.location}-${a.scenario}`.localeCompare(`${b.app}-${b.location}-${b.scenario}`))

const rows = runs.map((r) => ({
  app: r.app,
  location: r.location,
  scenario: r.scenario,
  quality: r.quality ?? null,
  passes: r.passes,
  cameraAsserted: r.notes?.cameraAsserted ?? null,
  manhattanProjection: r.notes?.manhattanProjection ?? null,
  fpsAvg: r.variance.fpsAvg?.mean ?? null,
  fpsP1: r.variance.fpsP1?.mean ?? null,
  fpsP01: r.variance.fpsP01?.mean ?? null,
  spreadPct: r.variance.fpsAvg?.spreadPct ?? null,
  appStats: r.variance.appStats ?? null,
}))

const out = {
  schemaVersion: 1,
  generatedAtUtc: new Date().toISOString(),
  harness: {
    url: 'scripts/benchmarks/run.cjs',
    sampleSeconds: runs[0]?.seconds ?? null,
    resolution: '1280x720, DPR 1',
    browser: 'headless Chrome (CDP), ANGLE/D3D11 GPU',
    passesPerRun: 3,
  },
  count: rows.length,
  runs: rows,
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`wrote ${OUT} (${rows.length} runs)`)
