# 2O-B — street-life CPU claim: attribution and verdict

Phase 2O-B. Branch `ds/2o-b-perf` @ `c78b7ad`.

Claim under dispute: HANDOFF §1 — *"street-life CPU ~0.4 ms/frame"* (RTX 5070,
1280×720). Phase 2O-A re-measured it at the real Times Square street level and
recorded **DIFFERS**: 0.8 ms in the 2O-A claim table, 0.6 ms in the committed
evidence JSON — both single-sample `streetLifeMs()` calls
(`docs/qa/evidence/2o-baseline/bench_results.json` → `claims.streetLifeMs`,
which calls `bench.streetLifeMs()` once).

This note re-measures the same number with 20 samples per run, three
independent runs, and attributes the time per subsystem. House rule applied
throughout: *cheap proxies lie; if you have not measured it, you do not know
it* — and a one-shot timer is the cheapest proxy of all.

Evidence: `docs/qa/evidence/2o-b-perf/street_life_breakdown.json`.
Harness: `apps/manhattan-threejs/src/perfbreak.js` (measurement module, not
imported by `main.js`) driven by `scripts/qa/2o-b-perf-run.mjs` (vite :5176,
Chrome headless CDP :9226, `--headless=new --enable-unsafe-swiftshader`,
unique user-data-dir). Run it with `node scripts/qa/2o-b-perf-run.mjs`.

Machine: Windows 10, Node v24.18.0, Chrome headless (SwiftShader software GL).
The qa-integrity framecheck suite (vite 5174, CDP 9224) was running on this
machine during the 2O-A baseline and during these runs, so the comparison is
not idle-vs-idle.

---

## 1. The claim reproduces

`streetLifeSamples(20)` runs the exact `bench.streetLifeMs()` sequence
(`props.update(force=true)` → `subway` → `traffic` → `crowd` → `weather` →
`interiors` → `corridor`, one `update(1/30)` each, render excluded) at the
times_square street-level shot after the same 90-tick warm-up the 2O-A bench
uses.

| Run | Median ms | p95 ms | Observed range ms |
|---|---|---|---|
| 1 | 0.4 | 0.52 | 0.3 – 0.9 (one outlier) |
| 2 | 0.35 | — | 0.3 – 0.5 |
| 3 | 0.35 | 0.5 | 0.3 – 0.5 |

Combined median **0.35 ms**, p95 ≈ 0.5 ms, max 0.9 ms over 60 samples.

The claimed **~0.4 ms is the current honest number** at the real Times Square
street level, with the full Phase 2 sim set (430 vehicles, 359 people, 477
props drawn — the same counts 2O-A recorded). The 2O-A "0.8 ms" verdict was a
single draw from this distribution: its p95 is 0.52 and the tail reaches
0.9 ms on a spawn-heavy frame. A one-shot measurement landing at 0.6–0.8 is
not a regression; it is noise.

## 2. The 0.8 ms, attributed

Per-subsystem breakdown over 60 frames at the disputed camera (medians):

| Subsystem | Median ms | p95 ms | What it does per frame |
|---|---|---|---|
| props (forced rebuild) | 0.1 | 0.2 | 477 instances written; **0 ms in the real loop** (35 m early-out, static camera) |
| subway | 0.0 | 0.0 | early-out: camera has moved < 20 m |
| traffic | 0.1–0.2 | 0.2–0.3 | 430 vehicles, 680 lanes in scope: car-following + instance write-out |
| crowd | 0.1 | 0.2–0.3 | 359 people: advance + 5 attribute write-outs |
| weather | 0.0 | 0.1 | no rain at this camera; clouds drift |
| interiors | 0.0 | 0.0 | 4 rooms, distance tests only |
| corridor | 0.0 | 0.0 | inactive early-out |
| audio | 0.0 | 0.0 | AudioContext not running headless; earshot scan ~0 |
| render (context only) | 0.2–0.3 | 0.4–0.5 | `renderer.render()` submission — **not part of the claim** (street-life block excludes render) |
| **whole sim block** | **0.3** | 0.5 | streetLifeMs pattern, timed whole |

The sim block is ~0.3 ms and no subsystem dominates: traffic and crowd are
the two real costs (~0.2 ms together), everything else is an early-out or
near-zero. Render submission (~0.25 ms) is what the frame-loop's remaining
street-level CPU is, and it is outside the disputed claim's scope.

The one variable cost in the block — traffic's spawn top-up (the `withDist`
sort over ~680 lanes + occupancy Map, `traffic.js:282-326`) — only runs while
the population is below target. Measured worst case (street drained, top-up
forced every frame): median 0.1 ms, p95 0.4 ms. It is bounded by the
`SIM_RADIUS` scope and the vehicle cap, not by city size.

## 3. What the 0.4 ms claim era contained

Git history of the runtime sims:

| Commit | Added |
|---|---|
| b6602ad | traffic (`src/traffic.js`) — 2F/2G |
| 6c6e3c4 | crowd + props (`pedestrians.js`, `props.js`) — 2H |
| 3397533 | demand — 2I |
| 057be60 | weather + audio — 2J |
| c07faad | interiors — 2K |
| 37802cb | HQ — 2L |
| c461aa4 | corridor (`src/corridor.js`) — 2M |
| 0c660b7 | subway (`src/subway.js`) — 2N |
| e6303ba | the 0.4 ms claim text enters HANDOFF §1 |

The claim text entered the doc **after** 2M/2N were in the tree, so the
"claim predates the subway and corridor systems" reading in the 2O-A doc is
not supported by git history for the *number itself* being re-measured here.
What the history does show: the street-life measurement as 2O-A defined it
(`streetLifeMs()`) includes exactly the subsystems that the claim-era number
cannot be reconstructed for (no per-subsystem timing survives from the RTX
5070 session). It is therefore not possible to say the 0.4 ms number excluded
subway and corridor — and it does not matter: at the disputed camera both
cost **0.0 ms** because subway early-outs on a static camera and corridor
early-outs when inactive. There is no measurable "new work" in this number.

## 4. Verdict: CONFIRMED — no optimization

**Claim status: CONFIRMED (the honest number is 0.35–0.4 ms median, matching
the claimed ~0.4 ms).** The 2O-A DIFFERS verdict was a one-shot sampling
artifact, not a stale claim and not a regression.

No code change was made to any simulation. Decision rationale:

- Nothing to fix: the block is sub-millisecond and **no subsystem dominates**;
  there is no O(n²) hot loop, no per-frame recompute of camera-invariant data
  in a hot path, and no allocation churn that matters at 430 vehicles / 359
  people.
- The only candidate (traffic spawn top-up) is bounded by scope and already
  measures 0.1 ms median even in its worst case. Rebuilding it would touch
  `traffic.js:282-326`, which mixes `Math.random()` draw order with spawn
  rejection and occupancy checks — exactly the determinism the framecheck
  suite and capture pipeline depend on. A stale-but-honest claim beats a
  risky rewrite, and here the claim is not even stale.
- Sub-millisecond sims against a 16.7 ms frame budget (0.35 ms ≈ 2.1 %) are
  not where this frame goes; render submission and rasterisation are, and
  both are outside this dispute.

## 5. Verification and limitations

- `node --test "scripts/qa/**/*.test.mjs"`: **45/45 pass** (bench.test.mjs
  includes the pure helpers `perfbreak.js` imports: `median`, `pctl`).
- Framecheck suite re-run: **not run** — the framecheck runner's ports
  (vite 5174, CDP 9224) are held by the qa-integrity worker for the whole
  session. Nothing in `src/perfbreak.js` or the runner touches `main.js`'s
  frame loop, so the frame-level sim output is untouched; the bench numbers
  and unit tests above are the verification. The new files are imported only
  by the dev runner, exactly like `bench.js`/`bench-run.mjs`.
- Nothing in `src/capture.js`, `src/audio.js`, `vite.config.js` or
  `scripts/phase2/` was touched.
- 0.4 ms was measured on this machine (SwiftShader, JS only); the RTX 5070
  figure cannot be reproduced without that GPU. The claim as printed is a
  CPU-JS number, which is machine-independent in kind, and it holds here.
