# Benchmark baseline — 2026-08-09

Five locations, `stand` scenario, `high` quality, 3 passes × 10 s each, written
by `scripts/benchmarks/run.cjs` to `evidence/performance/phase2o-a/`.

This is the first baseline since the one-Manhattan consolidation. The previous
one (2026-08-06) is stale in two ways that make it uncomparable rather than
merely old, so it has not been overwritten — see *The previous baseline* below.

## Numbers

FPS, mean across 3 passes. `1% low` and `0.1% low` are the conventional
mean-of-slowest-frames statistics (CapFrameX convention), not nearest-rank
percentiles — see `scripts/benchmarks/lib/stat.cjs` for why the nearest-rank
form was retired in 0A.

| Location | dev-view | avg | 1% low | 0.1% low | 1% low spread |
|---|---|---|---|---|---|
| skyline-south | `skyline-south` | 100.0 | 79.9 | 71.3 | 4.2% |
| financial-canyon | `financial` | 100.0 | 78.8 | 70.3 | 0.3% |
| midtown-street | `midtown-street` | 100.0 | 77.4 | 68.8 | 4.5% |
| times-square-plaza | `times-square` | 100.0 | 76.9 | 70.6 | 3.0% |
| central-park-open | `central-park` | 100.0 | 76.1 | 63.9 | 2.9% |

Pass-to-pass spread on the 1% low stays under 5% everywhere, so these are
repeatable enough to regress against. A regression threshold tighter than about
5% on the 1% low would fire on noise.

`central-park-open` has the lowest 0.1% low by ~5 fps while its 1% low sits mid
-pack, so its worst frames are worse than its typical bad frames elsewhere —
worth watching, not currently worth chasing. `financial-canyon` is by far the
most repeatable at 0.3%, which makes it the best location to regress against
when a change is expected to be small.

## What this baseline does and does not say

**Does:** the game holds a 100 fps average at every hero location on this
machine, and the frame-time tail is consistent across repeated captures.

**Does not:**

- **100.0 fps is a ceiling, not a measurement.** Every location reports the
  same average to one decimal place, which is a display refresh cap rather than
  a coincidence. Headroom above the cap is invisible here, so this baseline can
  only detect a regression that drops the average *below* 100 — a change that
  halves the real headroom would show as no change at all. The lows are the
  informative half of this table.
- **One machine, one GPU, headless Chrome with SwiftShader available as a
  fallback.** These are not the brief's target-hardware numbers.
- **Draw calls and triangle counts are `n/a`.** The per-frame render stats the
  runner reports came from the deleted reference app's instrumentation; the
  game exposes no equivalent yet. So this measures frame pacing, not what the
  frame is made of.
- **`stand` only.** `walk`, `sprint` and `soak` are supported by the runner and
  were not captured for this baseline.

## The previous baseline

`evidence/performance/phase2o-a/shenron-*-stand-high.json` dated 2026-08-06 is
kept and must not be read as comparable:

1. **Different cameras.** Those runs name `hero-boulevard`, `hq-lobby`,
   `floor45-arrival` — viewpoints from the retired HQ build. The names survived
   the consolidation while the cameras behind them changed to unrelated parts of
   the city; that is what 0A.4 fixed.
2. **Different statistic.** They carry the nearest-rank `p1`/`p01` numbers
   retired in 0A, which were blind to the stutter this project cares about — a
   flat 120 fps capture with half its frames at 10 fps scored clean under them.
   The summariser reports `?` for their lows because the fields no longer exist.

New runs are filed under the new canonical location names, so both sets coexist
and neither is silently overwritten.

## Reproducing

```bash
node scripts/benchmarks/run.cjs --location midtown-street --passes 3 --seconds 10
```

Runnable locations: `midtown-street`, `times-square-plaza`, `financial-canyon`,
`central-park-open`, `skyline-south`. The five `manhattan` locations are retired
with the reference app and refuse to run, naming why.
