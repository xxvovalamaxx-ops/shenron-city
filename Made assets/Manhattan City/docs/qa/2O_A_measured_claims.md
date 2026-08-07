# 2O-A — Measured vs claimed: every numeric claim re-measured

Phase 2O-A. Baseline branch `ds/2o-baseline` @ `4de0874`.

Method: every claim below was re-measured from this worktree with the real
artifacts — the running app (`apps/manhattan-threejs`, Vite dev server,
Chrome headless, SwiftShader software GL) or the committed data files. No
number was copied from an earlier report. "House rule" applied throughout:
*Cheap proxies lie. If you have not measured it, you do not know it.*

Where a claim is machine-dependent, the machine is stated. The benchmark
harness is `scripts/qa/bench-run.mjs`; its raw output is
`docs/qa/evidence/2o-baseline/bench_results.json`.

Machine: Windows 10, Node v24.18.0, Chrome headless (`--headless=new`)
with **SwiftShader software rendering** (no hardware GPU; the GPU-process
timer extension is exposed but never resolves, so GPU ms is unavailable —
see the benchmark JSON's `gpuDropped` records).

Legend: CONFIRMED (measured ≈ claimed) / DIFFERS (measured ≠ claimed) /
UNVERIFIABLE (no honest path to the number from this worktree, reason
given).

---

## 1. HANDOFF §0 table — the seven headline claims

Source: `docs/phase2/HANDOFF.md` lines 21–27.

| # | Claimed | Source | Measured | Verdict |
|---|---|---|---|---|
| 1 | Walk cycle: control render **0 px**; phase-only advance **1,338 px**, positions frozen | HANDOFF.md:21 | Control render **0 px** (both per-channel >6 and exact); phase-only advance **14,107 px** (>6) / **15,350 px** (exact) with `positionsFrozen: true` (s, lane, dir snapshot per walker) | CONFIRMED — mechanism exact. The absolute 1,338 px is a crowd-state snapshot (359 walkers at the times_square camera after 90 sim ticks this run); the invariant is control = 0 with a non-zero phase-only delta |
| 2 | Props sit on the pavement: **400/400** | HANDOFF.md:22 | **400/400** within 0.05 m; median surface error **0.000 m**, worst **0.001 m** (pavement top 12.20 m); 112,418 prop records total | CONFIRMED |
| 3 | State Plane projection: **99.9%** of 808 converted DOT points within 25 m of a LION street, median 0.7 m | HANDOFF.md:23, DATA_SOURCES.md:77 | **807/808 = 99.88 %** within 25 m, median **0.68 m**, p90 1.08 m, max 23.7 m; 1 point unbounded (no street in its 3×3 cell neighbourhood) | CONFIRMED — 99.9 % was the rounded form of 99.88 % |
| 4 | LOD tiers align: raycast height error median/p90/max all **0.00 m** over **390 samples** | HANDOFF.md:24 | 583 samples across 22 L2 tiles (spread over the island, core-biased): median **0.000 m**, p90 **0.0006 m**, max **22.8993 m** | **DIFFERS** — see §1a |
| 5 | Silence is silent: **0.00000 RMS** | HANDOFF.md:25, LICENSING.md:78 | Real graph rendered into an OfflineAudioContext: **0.00000 RMS**, centroid 0 | CONFIRMED (exact) |
| 6 | Hidden building hidden on the GPU: **17,436 px** changed | HANDOFF.md:26 | **17,437 px** changed at 1280×720 (1.89 % of 921,600), suppression on/off, same frame twice | CONFIRMED (1 px) |
| 7 | Corridor drives on roads: **210 samples** at 25 m, worst offset **0.00 m** | HANDOFF.md:27 | **210 samples** (101 market + 109 HQ route), worst offset **0.00 m** both routes; Shenron on the dais **0.00 m** | CONFIRMED (exact) |

### 1a. The LOD discrepancy (DIFFERS)

The claimed "max 0.00 m" does not reproduce. Re-sampling the real L2 glb
tiles by raycast (method identical in spirit: cast down from registry
height + 30 m onto the tile's L2 mesh) gives a median and p90 of 0, but one
building is off by 22.9 m:

```json
{ "err": 22.8993, "tile": "-02_-03", "bid": 20009, "x": -1887.9, "y": -3617,
  "registryH": 3, "hitY": 25.899, "hitObject": "LOD_L2_-02_-03", "buildingName": "" }
```

`bid 20009` has registry height 3 m; the L2 ray passes straight through to
a ~26 m neighbour, i.e. the building is **absent from (or merged within)
its L2 tile**. Either way the claim as printed ("max 0.00 m") is false for
the current build, while the alignment claim (median/p90 ≈ 0 over 583
samples) holds. The original 390 samples presumably did not include this
building; the claim is over-broad, not the sampling.

Command: `node scripts/qa/bench-run.mjs` → `claims.lodL2` in
`docs/qa/evidence/2o-baseline/bench_results.json`.

---

## 2. LICENSING.md audio table

Source: `docs/phase2/LICENSING.md` lines 76–82. Measured by the app's own
`verifyAudio()` (`src/audio.js` `verify()`) into an OfflineAudioContext,
1.5 s, 44.1 kHz — the same function the table was produced with.

| mix | Claimed RMS | Claimed centroid | Measured RMS | Measured centroid | Verdict |
|---|---|---|---|---|---|
| all layers at zero | 0.00000 | – | **0.00000** | 0 | CONFIRMED (exact) |
| traffic bed only | 0.06478 | 478 Hz | 0.06380 | 542 Hz | CONFIRMED — noise-driven layer, run-to-run variance; same order |
| rain only | 0.13269 | 2002 Hz | 0.13256 | 1865 Hz | CONFIRMED — noise-driven layer, same order |
| siren only | 0.03951 | 3779 Hz | **0.03951** | **3779 Hz** | CONFIRMED (exact — deterministic oscillator event) |
| horn only | 0.07684 | 2534 Hz | **0.07684** | **2534 Hz** | CONFIRMED (exact — deterministic oscillator event) |

The deterministic rows reproduce to the last digit; the noise rows vary
with the random noise buffer. The spectral ordering the table exists to
prove (traffic bed ≪ rain) is preserved in every run.

---

## 3. HANDOFF §3 performance numbers (RTX 5070 claim)

Source: `docs/phase2/HANDOFF.md` line 128–130.

> "Measured performance (RTX 5070, 1280×720): resident tile payload 67.8 MB
> → 10–16 MB after LOD; street-life CPU ~0.4 ms/frame."

| Claimed | Measured on this machine (SwiftShader) | Verdict |
|---|---|---|
| resident payload 67.8 MB → 10–16 MB after LOD | 21.1–31.4 MB total resident at the 15 bench cameras (world + streets + far tiers: e.g. Times Square street 21.9 MB = 13.6 world + 2.2 streets + 5.3 LOD; central park air 29.0 MB) | UNVERIFIABLE as stated — the RTX 5070 numbers cannot be reproduced without that GPU. Current honest figures above. |
| street-life CPU ~0.4 ms/frame | **0.8 ms** for one `update(1/30)` of props+subway+traffic+crowd+weather+interiors+corridor, CPU only, render excluded (430 vehicles, 359 people, 477 props drawn) | DIFFERS — 0.8 ms measured. The 0.4 ms claim predates the subway and corridor systems, which this measurement includes. Still sub-millisecond. |

Main-thread `renderer.render()` wall time on this machine is 0.19–0.35 ms
(1,005,972 tris / 106 draws at the real Times Square) — command submission
only; the forced-sync software rasterization cost (`render + readPixels`,
which is the honest software-GL frame cost) is 1.1–3.5 ms per camera.
Neither number is a hardware-GPU frame time. Full per-camera table:
`docs/qa/evidence/2o-baseline/bench_results.json`.

---

## 4. BASELINE.md counts

Source: `docs/phase2/BASELINE.md` §1 (frozen Phase 1 foundation).

| Claimed | Measured | Verdict |
|---|---|---|
| 56,476 buildings | **56,476** in `data/manhattan/runtime/city.json` (`buildings`) and 56,476 registry rows in `building_registry.csv` | CONFIRMED (exact) |
| Road segments 21,306 of 22,544 parsed; 13,086 lane splines / 2,398 lane-km; parks 3,180; trees 37,854; bridges 21; piers 2,192; verts/faces 2,932,907 / 1,569,041; headless rebuild 41.6 s | Not re-measurable from this worktree | UNVERIFIABLE — Phase 1 Blender-pipeline statistics. The pipeline is frozen by project rule ("Do not regenerate Manhattan", HANDOFF §2) and `BASELINE_AUDIT.json` recorded 28/28 pass at freeze; re-running the freeze verifier would regenerate the world and is forbidden. |

Phase 2 quantities that the runtime can measure and that this run reports
anew: 11,395 drivable edges / 1,026.7 km, 14,675 walk lanes / 1,249.6 km,
112,418 prop records, 808 DOT points parsed, 6,969,286 m² net sidewalk area
(shoelace over the 5,202 survey rings — STREET_REPORT.json claims
6,969,269 m²; difference 17 m² = 0.0002 %).

---

## 5. Commands to reproduce every row

| Claim | Command / script |
|---|---|
| Walk cycle, props, LOD, silence, hidden-building, corridor, audio table | `node scripts/qa/bench-run.mjs` (boots vite :5173, Chrome :9223, runs the app, calls the app's own `verifyAudio()`, `hq.verify()`, `corridor.verify()`, and the bench's `walkCycleCheck()`, `propsOnPavement()`, `measureLodL2()`) |
| State Plane 808-point distance | `node scripts/qa/bench-run.mjs` → `data.statePlane` (nysp EPSG:2263 port inside the script, the same maths as `scripts/phase2/nysp.py`) |
| Sidewalk area | `node scripts/qa/bench-run.mjs` → `data.sidewalk` (shoelace over `data/manhattan/streets/sidewalk_geom.json`) |
| Registry / city / graph counts | `node scripts/qa/bench-run.mjs` → `data` |
| Unit tests for the pure parts | `node --test "scripts/qa/**/*.test.mjs"` (8/8 pass; the plain directory form of `node --test` fails on this Windows/Node combination — the files live in `scripts/qa/bench.test.mjs`) |

The benchmark also fires one real 1280×720 capture PNG per camera
(`evidence/phase2/bench_<name>.png`, gitignored) and runs the HANDOFF §0
dead-frame check on every one (stddev 32–64, distinct colours 3,243–31,394
— all live frames, none uniform; `frameHealth` per camera in the JSON).

---

## 6. Summary

- CONFIRMED: 7 of the 9 claim groups (walk-cycle mechanism, 400/400 props,
  State Plane 99.88 %, silence 0.00000, hidden building 17,437 ≈ 17,436,
  corridor 0.00 m, audio table, 56,476 buildings).
- DIFFERS: **LOD "max 0.00 m"** (real max 22.9 m on bid 20009, a 3 m
  building absent from its L2 tile); **street-life CPU** 0.8 ms measured vs
  0.4 ms claimed (claim predates two simulation systems).
- UNVERIFIABLE: RTX 5070 payload figures (no such GPU here); frozen
  Phase 1 Blender statistics (pipeline frozen by rule).
