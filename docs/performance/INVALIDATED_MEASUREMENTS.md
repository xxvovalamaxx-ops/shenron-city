# P2-075 reconciliation — "Times Square" was actually Lincoln Square

Status: **resolved (verified against the geographic registry and the code)**
Phase 2O-A task 2O-A-001 deliverable. Harness: `scripts/benchmarks/`.

## Finding

The benchmark camera historically labelled **"Times Square"** was placed at
world `(-1900, -600)` in the phase-2 Manhattan build. That is **Lincoln
Square**, about 1.8 km up Broadway from the real Times Square.

The mislabel is admitted in the code itself, `Made assets/Manhattan City/apps/
manhattan-threejs/src/main.js` lines 30-36:

> "Where the camera opens... This was labelled 'Times Square' and is not:
> (-1900, -600) is 40.7746 N, -73.9905 W, which is Lincoln Square, about
> 1.8 km up Broadway. Times Square is (-1476, -2433)."

`main.js` is already corrected: `TIMES_SQUARE = { x: -1476, y: -2433 }`,
`START = { x: -1476, y: -2433, alt: 620 }`.

## Verification (independent of the comment)

Projection (local tangent plane, lat0=40.78, lon0=-73.968, x=east, y=north):

| position | lat | lon | projected x_m | projected y_m |
|---|---|---|---|---|
| old START / "Times Square" | 40.7746 | -73.9905 | -1896.6 | -597.1 |
| true Times Square | 40.7580 | -73.9855 | -1475.1 | -2432.6 |
| capture.js `times_square` shot | 40.7580 | -73.9855 | -1475.1 | -2432.6 |

Registry cross-check (`public/models/manhattan/building_manifest.csv`,
nearest buildings):

- Near true Times Square: **Bertelsmann Building, One Astor Place, Lyceum
  Theatre — district "Midtown West / Times Sq"**. Also 4 Times Square
  (x=-1497.7, y=-2652.2) and Times Square Tower (x=-1591.8, y=-2708.0).
- Near the old START: **The Aldyn, The Ashley, Collegiate School, West End
  Towers — district "Upper West Side"** (Lincoln Square area).

The harness's live check agrees: a camera placed at `[40.7580, -73.9855, ...]`
snaps to (-1505.6, 2466.2 world) and `city.nearest` names it
"Midtown-Times Square"; at `[40.7746, -73.9905, ...]` it is
"Upper West Side-Lincoln Square".

## Invalidated measurements

The following historical numbers were reported **as Times Square** but were
measured at the mislabelled Lincoln Square camera. They are **not** the cost
of rendering Times Square; do not compare them with future Times Square runs.

| source | reported | where it was actually measured |
|---|---|---|
| `Made assets/Manhattan City/docs/phase2/BASELINE.md` (P2-044 row) | Times Square 2,523,015 → 939,647 triangles; 284 → 89 draw calls; 0.55 → 0.27 ms | Lincoln Square default camera (-1900,-600) |
| `Made assets/Manhattan City/docs/phase2/HANDOFF.md` line ~184 | "939,647 tris / 89 draws / 0.27 ms" at Times Square | Lincoln Square default camera |
| `Made assets/Manhattan City/evidence/phase2/README.md` times_square row | 0.53 ms/frame, 1,698,206 triangles, 208 draw calls | **valid location** (capture.js shot is true Times Square), but method differs: all 119 tiles resident + `render()`/`gl.finish()` GPU-only timing, not end-to-end frame time |

The phase-2 QA ledger row for P2-044 is likewise affected; the QA worker
should re-baseline against this record (see `docs/deepseek/MERGE_QUEUE.md`).

## What replaces them

Phase 2O-A baseline, measured at the corrected coordinates with the
deterministic harness (`scripts/benchmarks/run.cjs`, Chrome headless, real
RTX 5070 via ANGLE/D3D11, 1280x720 DPR 1, 3 passes × 8 s):

| location | avg fps | p1 fps | draw calls | triangles | tiles resident |
|---|---|---|---|---|---|
| **times-square** (true) | 27.1 | 34.5 | 94 | 972,719 | 19/119 |
| **lincoln-square** (old mislabel) | 49.3 | 62.9 | 65 | 402,109 | — |

Full numbers: `docs/performance/PHASE2O_BASELINE.md` / `.json`;
raw passes and screenshots: `evidence/performance/phase2o-a/`.

## Residual caveats

- capture.js `SHOTS.times_square` was already the true Times Square; only the
  **default camera START** (and anything that used the default spawn) was
  wrong. Screenshots taken via `__capture.shoot('times_square', ...)` are
  location-valid.
- The manifest `x_m/y_m` for 4 Times Square is ~220 m from `main.js`
  `TIMES_SQUARE`; that is the difference between the tower's centre and the
  street-level camera target, both inside the same district.
