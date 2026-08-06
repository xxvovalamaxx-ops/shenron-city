# Phase 2O-A evidence (evidence/performance/phase2o-a/)

Regenerate everything with the harness; the JSON files here are the source of
truth (screenshots are git-ignored but regenerable — keep the JSON, not the
PNGs, in history).

## Layout

- `<app>-<location>-<scenario>[-<quality>]-passN.json` — one pass: frame-time
  stats, CPU counters, render() timing, scene stats, screenshot integrity
  (sha256, 4x4 luminance bands, diff vs pass 1), error buckets, long tasks,
  heap samples, transition data (elevator ride), soak minute-buckets.
- `<app>-<location>-<scenario>[-<quality>].json` — aggregate: pass-to-pass
  variance across N passes.
- `docs/performance/PHASE2O_BASELINE.json` — the folded table
  (`scripts/benchmarks/aggregate.cjs`).

## Camera registry

`docs/performance/CAMERA_LOCATIONS.json` — every camera keyed to documented
world coordinates; P2-075 context in
`docs/performance/INVALIDATED_MEASUREMENTS.md`.

## Regenerate

```
node scripts/benchmarks/run.cjs --app manhattan --location times-square --passes 3 --seconds 8
node scripts/benchmarks/run.cjs --app manhattan --location times-square --scenario elevator
node scripts/benchmarks/run.cjs --app manhattan --location times-square --scenario soak
node scripts/benchmarks/run.cjs --app shenron --location hero-corridor-exterior --scenario walk
node scripts/benchmarks/aggregate.cjs
```

Environment: RTX 5070 via ANGLE/D3D11, 1280x720 DPR 1, headless Chrome,
ports 5176 (Manhattan app) and 9132 (shenron game), both started and stopped
by the harness.
