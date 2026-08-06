# PHASE 2O-A — Honest Performance Baseline

Task 2O-A-001. Harness: `scripts/benchmarks/run.cjs` (zero-dependency CDP
driver, Chrome headless). Evidence: `evidence/performance/phase2o-a/`
(per-pass JSON + screenshots). Machine renderer: **NVIDIA GeForce RTX 5070**
via ANGLE/D3D11 (verified from the live WebGL context, not assumed).

## Rule

> A number you can diff is worth more than a picture.

Every claim below comes from 3 passes per run at the same camera, same
resolution, same settings. No optimization claim may be made against this
baseline unless it is measured the same way (see "Comparing later" below).

## Method

- **Resolution**: 1280x720, device scale factor 1 (pinned by CDP
  `Emulation.setDeviceMetricsOverride`; window size 1280x720).
- **Browser**: headless Chrome, `--headless=new`, remote debugging, synthetic
  key input for walk/sprint scenarios.
- **Metric**: rAF inter-frame deltas in the page (`performance.now()`),
  sampled for 8 s per pass, 3 passes per run. avg/median/1%-low/0.1%-low in
  fps and ms; frames > 1000 ms counted as stalls and reported (`deadFrames`).
- **Manhattan app extra**: `renderer.info` (draw calls, triangles,
  geometries, textures), streamer tile counts, traffic/crowd/weather stats,
  `city.nearest` district proof for every camera (the "where is the camera
  really" check).
- **Determinism**: street/walk graphs are fetched and awaited before placing
  the camera (first attempt measured a ~40 m camera jitter between passes;
  fixed). Shenron waits 8 s for asset streaming/shaders and re-samples if a
  pass contains a > 1 s stall (a ~4.5 s postprocessing compile was measured
  in the warmup window).
- **Variance**: pass-to-pass spread % reported per run. Wide spread marks
  runs that are not trustworthy for small deltas (e.g. midtown-dense 10.2%).

## Results (means across 3 passes × 8 s)

### Manhattan (phase-2 city app, real addresses, high preset, weather default)

| location | scenario | avg fps | 1% low | 0.1% low | draw calls | triangles | tiles res | spread % |
|---|---|---|---|---|---|---|---|---|
| times-square | stand | **27.1** | 34.5 | 35.5 | 94 | 972,719 | 19/119 | 3.0 |
| times-square | rain | **25.9** | 34.7 | 34.9 | 98 | 1,026,279 | 19/119 | 0.5 |
| times-square | night | **28.1** | 34.1 | 34.6 | 94 | 972,619 | 19/119 | 1.3 |
| times-square | zone (Harlem cold) | **23.6** | 29.1 | 29.4 | 94 | 889,313 | — | 3.0 |
| lincoln-square | stand | **49.3** | 62.9 | 66.5 | 65 | 402,380 | — | 13.7 |
| midtown-dense | stand | **26.7** | 33.4 | 33.5 | 109 | 926,689 | — | 10.2 |
| lower-manhattan | stand | **41.7** | 51.5 | 52.0 | 93 | 796,883 | — | 4.0 |
| manhattan-aerial | stand | **100.0** | 108.3 | 108.3* | 100 | 907,431 | — | 0.1 |

\* aerial sits at the headless 100 fps cap; 0.1% low includes a settle hiccup
(see raw passes).

Reading the numbers: Times Square is the heaviest street scene (~27 avg fps
in headless at 1280x720), midtown-dense is comparable with more draw calls
(109). Rain costs ~1.2 fps over stand at Times Square and adds ~54k triangles
(drops). Lincoln Square — where the old P2-044 numbers were actually
measured — is far cheaper (49.3 fps, 65 draws, 402k tris): the invalidated
"939,647 tris / 89 draws / 0.27 ms at Times Square" claim did not describe
Times Square at all.

### Shenron (production game, dev-view cameras)

| location | scenario | preset | avg fps | 1% low | 0.1% low | spread % |
|---|---|---|---|---|---|---|
| hero-corridor-exterior | stand | high | **82.2** | 122.0 | 134.9 | 11.4 |
| hero-corridor-exterior | walk | high | **86.8** | 123.6 | 137.3 | 9.4 |
| hero-corridor-exterior | sprint | high | **89.0** | 128.4 | 145.2 | 14.7 |
| hero-corridor-exterior | stand | medium | **94.5** | 133.3 | 146.4 | 11.3 |
| hero-corridor-exterior | stand | low | **92.4** | 131.1 | 147.5 | 4.6 |
| hq-plaza | stand | high | **99.5** | 145.7 | 165.0 | 0.1 |
| hq-lobby | stand | high | **99.6** | 144.3 | 197.5 | 0.4 |
| elevator-interior | stand | high | **99.9** | 159.4 | 260.4 | 0.2 |
| floor45-arrival | stand | high | **100.0** | 130.0 | 250.0* | 0.2 |

\* p0.1 is inflated by a single >200 ms frame in the headless compositor; see
raw passes.

Reading the numbers: the hero corridor (city + traffic + crowd visible) is
the only Shenron scene that drops below the 100 fps headless cap. The low
preset does **not** beat medium here (92.4 vs 94.5 avg) within noise — a
claim that low is faster needs the same camera under the same spread before
it is repeated. Interiors sit at the cap with ~0.2% spread: any future
"lobby is faster/slower" claim within ±1 fps is noise, not a change.

## Comparison targets (from the existing budget docs)

- `docs/Production/PERFORMANCE_BUDGETS.md` target: 60 fps avg / 45 fps 1% low
  at 2560x1080 on RTX 5070. **Not comparable directly**: this baseline is
  1280x720, headless, dev server (not the production build). The prior
  production-pass-02 evidence (`docs/Production/evidence/production-pass-02/
  performance.json`) measured 5–46 fps at 2560x889 in a **headed** browser —
  also not comparable 1:1, and its numbers predate the P2-075 correction.
- A proper production-build comparison is a follow-up run of the same harness
  against `vite preview` at 2560x1080 with the identical camera registry.

## Invalidated historical measurements

See `docs/performance/INVALIDATED_MEASUREMENTS.md` (P2-075). In short: all
"Times Square" figures measured from the default camera (-1900,-600) were
Lincoln Square figures and are invalid as Times Square evidence; this
baseline re-measures the true coordinates.

## Reproduce

```
node scripts/benchmarks/run.cjs --app manhattan --location times-square --passes 3 --seconds 8
node scripts/benchmarks/run.cjs --app shenron --location hero-corridor-exterior --scenario walk
node scripts/benchmarks/aggregate.cjs   # regenerates docs/performance/PHASE2O_BASELINE.json
```

Dev servers are started and stopped by the harness (ports 5176/9132, pinned
IPv4, `--strictPort`). Screenshots land in `evidence/performance/phase2o-a/`
(git-ignored; JSON is the source of truth).

## Comparing later

A claim like "X made Times Square faster" must, at minimum:

1. re-run `--app manhattan --location times-square --passes 3 --seconds 8`
   before and after the change on the same machine;
2. report avg **and** 1%/0.1% lows **and** spread % for both runs;
3. show the diff is larger than the baseline spread (3.0% for times-square);
4. attach the screenshot diff / hash to prove the camera did not move;
5. keep the same resolution, DPR, browser, and preset.
