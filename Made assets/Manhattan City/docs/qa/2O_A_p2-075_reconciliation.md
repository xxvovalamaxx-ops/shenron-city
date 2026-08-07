# 2O-A — P2-075 reconciliation: "Times Square" is finally Times Square

Bug: P2-075 (see `docs/qa/PHASE2_BUG_LEDGER.csv`). Through Phases 2C–2N the
performance figures published as "Times Square" ("939,647 tris / 89 draws /
0.27 ms") were measured at a camera position labelled Times Square that was
actually **Lincoln Square**, ~1.8 km up Broadway and materially less dense.
The coordinate constant was fixed; nothing had been re-measured.

This document reconciles the code and the numbers at the real location,
measured headlessly on this machine. Raw output:
`docs/qa/evidence/2o-baseline/bench_results.json`.

## 1. START == TIMES_SQUARE in code — confirmed

`apps/manhattan-threejs/src/main.js` lines 35–36:

```js
const TIMES_SQUARE = { x: -1476, y: -2433 }
const START = { x: TIMES_SQUARE.x, y: TIMES_SQUARE.y, alt: 620 }
```

and line 54:

```js
camera.position.set(START.x, START.alt, -START.y)   // (-1476, 620, 2433)
```

So the camera boots directly over Times Square. Independent cross-check —
the `SHOTS.times_square` capture spec `[40.7580, -73.9855, EYE, …]`
(`src/capture.js` line 28) projects with the app's own constants
(`LAT0=40.78, LON0=-73.968, M_LAT=110574, M_LON=111320·cos(LAT0)`):

```
x = (−73.9855 − (−73.968)) · 84335 = −1475.9   → −1476
y = ( 40.7580 −   40.78  ) · 110574 = −2432.6  → −2433
```

Both the constant and the street-level shot land on the same point, which
is also the world origin the pipeline reported for the real Times Square
(40.7580 N, −73.9855 W). The street-level capture snaps onto the walk graph
at (−1505.6, −2466.2) world (the pavement along Broadway/7th), eye at
13.9 m altitude (12.2 m pavement + 1.7 m eye).

## 2. Honest numbers at the real location

Measured at 1280×720, SwiftShader software GL, on this machine
(`scripts/qa/bench-run.mjs`; `cpuMs` = main-thread command submission,
`rasterMs` = forced-sync software rasterization).

| Camera | tris | draws | cpuMs | rasterMs | resident MB |
|---|---|---|---|---|---|
| **START / Times Square, 620 m top-down** (x −1476, y −2433, alt 620, straight down) | 887,915 | 82 | 0.20 | 1.3 | 21.1 |
| **Times Square street level** (SHOTS.times_square) | 1,005,972 | 106 | 0.32 | 1.8 | 21.9 |
| Lincoln Square, 620 m top-down (the old mislabelled START) | 858,547 | 84 | 0.27 | 1.7 | 23.2 |
| Old published "Times Square" claim (2C–2N) | 939,647 | 89 | 0.27 | – | – |

### What the numbers say

- The old claim sits between the two Lincoln Square measurements, which is
  consistent with P2-075's diagnosis: it was a Lincoln Square number. Its
  tris/draws are closest to the Lincoln Square top-down view of this run.
- The real Times Square is **~6 % heavier in triangles and ~19 % heavier in
  draw calls** than the old claim at street level, and 3.4 % heavier than
  Lincoln Square at the same 620 m altitude. The mislabelled location made
  every published figure optimistic, as the bug says.
- At 620 m the real location is *not* the densest camera in the set:
  central_park_air measures 1,133,730 tris / 128 draws (central park is
  ~2 km² of foliage meshes), and the densest street view is times_square at
  1,005,972 / 106.

## 3. Caveats, stated

- **Software GL.** All frame times are software-rendered (SwiftShader in
  the Chrome GPU process). They are not hardware-GPU numbers. `cpuMs` is
  command-submission wall time; `rasterMs` forces the rasterizer to finish
  and includes the 3.7 MB readback. GPU time via
  `EXT_disjoint_timer_query_webgl2` is unavailable here (the extension is
  exposed but never resolves its queries — recorded per camera as
  `gpuDropped` in the JSON).
- Resident MB counts the app's own accounting (`streamer.stats.bytes`,
  `streets.stats.bytes`, LOD manifest bytes for resident tiles) and varies
  with streaming history; it is the honest resident payload, not a cap.
- Every evidence PNG (`evidence/phase2/bench_*.png`) passed the HANDOFF §0
  dead-frame check (`frameHealth` in the JSON: stddev 32–64, 3,243–31,394
  distinct colours — none uniform). The check exists because the first full
  run of this harness produced three byte-identical uniform clear-colour
  PNGs (a lost-frame episode in the SwiftShader GPU process under the old
  19.5 s-per-camera timer-query busy-poll); the harness now polls fail-fast,
  checks every capture, and re-shoots once if a frame is dead.

## 4. Baseline status

These numbers are the **committed Phase 2O baseline** (branch
`ds/2o-baseline`, commit 2O-A). Any future optimization lands against
`docs/qa/evidence/2o-baseline/bench_results.json`; HANDOFF §3.0's
definition of done for 2O is now satisfied for the "commit the baseline"
half.
