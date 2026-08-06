# PHASE 2O-A — Honest Performance Baseline

Task 2O-A-001. Harness: `scripts/benchmarks/run.cjs` (zero-dependency CDP
driver, Chrome headless). Evidence: `evidence/performance/phase2o-a/`
(per-pass JSON + screenshots, 3 passes per run unless noted). Machine
renderer: **NVIDIA GeForce RTX 5070** via ANGLE/D3D11 (verified from the live
WebGL context, not assumed).

## Rule

> A number you can diff is worth more than a picture.

Every claim below comes from repeated passes at the same camera, same
resolution, same settings, with pass-to-pass spread reported. No optimization
claim may be made against this baseline unless it is measured the same way
(see "Comparing later").

## Method

- **Resolution**: 1280x720, device scale factor 1 (pinned by CDP).
- **Browser**: headless Chrome, `--headless=new`, remote debugging, synthetic
  key input for walk/sprint scenarios.
- **Frame metric**: rAF inter-frame deltas in the page, 8 s per pass, 3
  passes per run. avg/median/1%-low/0.1%-low in fps and ms; frames > 1 s
  counted as stalls (`deadFrames`). Cold passes (asset streaming + shader
  compile) are discarded and re-sampled so every pass measures steady state.
- **CPU**: CDP `Performance.getMetrics` deltas over the sample window
  (task/script/layout ms per second). Noisy on short windows — treat as
  indicative, not precise.
- **Render time**: `renderer.render()` wall time accumulated in-page (CPU
  submit cost; GPU time is not directly readable from the app — the 
  `render()+gl.finish()` method in the phase-2 evidence is a GPU stall proxy
  with all tiles resident, a different methodology).
- **Errors**: per-pass console errors, uncaught exceptions, and failed
  network loads, collected from CDP events (includes page load).
- **Manhattan app extra**: `renderer.info` (draw calls, triangles,
  geometries, textures), streamer tile counts, traffic/crowd/weather stats,
  scene actor counts (skinned/morph-target meshes), `city.nearest` district
  proof for every camera.
- **Integrity**: every screenshot is sha256-hashed with 4x4 luminance bands;
  passes 2+ are pixel-diffed against pass 1 (`meanAbsDiff`,
  `pctPixelsChanged`, `maxBandLuminanceDrift`). A "same camera" claim needs a
  small diff (dynamic content — cars, people — moves anyway; drift is
  reported, not hidden).
- **Determinism**: street/walk graphs fetched before placing the camera
  (without this, the camera jittered ~40 m between passes); stalls
  re-sampled; lift/drive corridor legs auto-complete while room legs are
  advanced with the game's own C key.
- **Environment caveat**: the first measurement batch ran while another
  session's QA process competed for CPU (hero-corridor measured 82 fps).
  The final numbers below were taken on an idle machine. Any comparison
  across batches must re-run both sides on the same machine state.

## Results (means across 3 passes x 8 s unless noted)

### Manhattan (phase-2 city app, real addresses, high preset)

| location | scenario | avg fps | 1% low | 0.1% low | draws | triangles | render ms | spread % |
|---|---|---|---|---|---|---|---|---|
| times-square | stand | **31.7** | 36.2 | 36.5 | 94 | 972,867 | 0.63 | 7.1 |
| times-square | rain | **31.8** | 36.5 | 37.0 | 98 | 1,025,319 | 0.60 | 3.8 |
| times-square | night | **31.5** | 36.3 | 36.6 | 94 | 972,446 | 0.64 | 6.7 |
| times-square | maxpeds | **30.7** | 36.0 | 36.2 | 94 | 972,388 | 0.67 | 0.9 |
| times-square | maxtraffic | **30.8** | 37.3 | 37.4 | 94 | 1,012,871 | 0.73 | 12.3 |
| times-square | zone (Harlem cold) | **23.6** | 29.1 | 29.4 | 94 | 889,206 | — | 3.0 |
| times-square | elevator ride | **44.4** | 166.6 | 327.6 | 140 | 1,138,065 | 0.66 | 12.4 |
| times-square | **soak 10 min** | **33.1** | 36.4 | 37.6 | 94 | 971,799 | 0.45 | — |
| lincoln-square | stand | **58.5** | 71.3 | 71.8 | 65 | 402,157 | 0.54 | 7.3 |
| midtown-dense | stand | **27.7** | 34.6 | 34.7 | 109 | 926,612 | 0.89 | 4.4 |
| lower-manhattan | stand | **42.8** | 52.9 | 53.4 | 93 | 796,586 | 0.74 | 5.3 |
| manhattan-aerial | stand | **100.0** | 108.3 | 123.0 | 100 | 908,105 | 0.64 | 0.0 |

**Elevator transition (corridor ascend, HQ lobby → Floor 45)**: **8,456 ms**
per ride (3 rides: 8,456 / 8,473 / 8,469 — 0.2% spread). Full corridor leg
timeline in evidence: Penthouse → Lift → Lobby → Street → Driving → Corner
market → Driving → HQ lobby → Lift → Mission Control.

**Soak (10 min, 1-minute buckets)**: 32.8 → 33.4 avg fps across all ten
minutes (flat), heap 224 → 209 MB (no growth), 0 long tasks, 1 console error
(a 404 during page load — favicon).

**Max presets**: pinning pedestrian demand to its ceiling costs ~1.0 fps
over stand (30.7 vs 31.7); pinning every lane's traffic weight near-max adds
~40k triangles and costs ~0.9 fps (30.8). Both are within the stand spread —
crowd/traffic caps are not the render bottleneck at Times Square; the tile
streamer working set is.

### Shenron (production game, dev-view cameras)

| location | scenario | preset | avg fps | 1% low | 0.1% low | spread % |
|---|---|---|---|---|---|---|
| hero-corridor-exterior | stand | high | **98.5** | 128.8 | 138.9 | 0.5 |
| hero-corridor-exterior | walk | high | **95.4** | 127.2 | 137.5 | 7.6 |
| hero-corridor-exterior | sprint | high | **96.9** | 127.2 | 157.1 | 1.3 |
| hero-corridor-exterior | stand | medium | **99.4** | 131.1 | 145.2 | 0.2 |
| hero-corridor-exterior | stand | low | **98.9** | 133.9 | 154.0 | 0.5 |
| hero-corridor-exterior | **soak 10 min** | high | **98.5** | 129.9 | 144.9 | — |
| hq-plaza | stand | high | **99.8** | 151.6 | 193.7 | 0.0 |
| hq-lobby | stand | high | **99.8** | 148.7 | 189.9 | 0.2 |
| elevator-interior | stand | high | **99.9** | 142.9 | 240.6 | 0.1 |
| floor45-arrival | stand | high | **99.9** | 135.3 | 319.7 | 0.2 |

**Soak (10 min, 1-minute buckets)**: 98.2 → 98.9 avg fps across all ten
minutes (flat), heap 480 → 453 MB (no growth), 0 long tasks.

Reading the numbers: every Shenron scene sits at the headless 100 fps cap
with <1% spread (the first batch measured hero-corridor at 82 fps while a
concurrent QA process competed for CPU — environmental, not a code change).
At the cap, preset differences (low 98.9 vs medium 99.4 vs high 98.5) are
within noise: **no preset claim may be made from these**. Interiors at
±0.2% spread: any interior "optimization" within ±1 fps is noise.

Manhattan render cost per frame is 0.45–0.89 ms CPU-side (submit); frame
time is dominated by the renderer's own pacing and the streamer, not the
submitted draw work.

## P2-075 / invalidated historical measurements

See `docs/performance/INVALIDATED_MEASUREMENTS.md`. All "Times Square"
figures measured from the old default camera (-1900,-600) were **Lincoln
Square** figures (P2-044 and HANDOFF line ~184: 939,647 tris / 89 draws /
0.27 ms). Re-measured at the true coordinates: **Times Square = 94 draws /
972,867 tris / ~0.63 ms render**; **Lincoln Square = 65 draws / 402,157
tris / ~0.54 ms** — the two are different scenes and were never comparable.

## Reproduce

```
node scripts/benchmarks/run.cjs --app manhattan --location times-square --passes 3 --seconds 8
node scripts/benchmarks/run.cjs --app manhattan --location times-square --scenario elevator
node scripts/benchmarks/run.cjs --app manhattan --location times-square --scenario soak
node scripts/benchmarks/run.cjs --app shenron --location hero-corridor-exterior --scenario walk
node scripts/benchmarks/aggregate.cjs   # regenerates docs/performance/PHASE2O_BASELINE.json
```

Dev servers are started/stopped by the harness (ports 5176/9132, pinned
IPv4, `--strictPort`). Screenshots land in `evidence/performance/phase2o-a/`
(git-ignored; JSON is the source of truth, including per-frame PNG hashes).

## Comparing later

A claim like "X made Times Square faster" must, at minimum:

1. re-run `--app manhattan --location times-square --passes 3 --seconds 8`
   before and after the change on the same machine state (no concurrent
   benchmark/QA processes);
2. report avg **and** 1%/0.1% lows **and** spread % for both runs;
3. show the diff is larger than the baseline spread (7.1% for times-square;
   note several scenarios spread >10% — e.g. maxtraffic 12.3%);
4. attach the screenshot hashes/diff to prove the camera did not move;
5. keep the same resolution, DPR, browser, and preset.
