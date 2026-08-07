# Shenzhen City — Opus takeover, current state

Branch: `opus/hero-corridor-v1`, cut from `main` at `9d5c74b27`.
Last updated: 2026-08-08.

This file is the resumable truth. It records what is *measured*, not what is
intended. If a claim here has no number or no evidence path behind it, it is a
plan, and it is labelled as one.

## What the game is today

One streamed Manhattan world, React + Three.js Fiber, served from the repo root
on port 5173. 56,476 buildings from OSM, 119 building tiles, LION traffic,
sidewalk crowd, subway kiosks, weather, a day/night clock, a first-person and
third-person player, a fly mode, and dev tools on F2.

Four buildings have real cut doorways with walk-in interiors (Phase 3B, ported
into the game and re-measured against its own collider at 4/4 —
`evidence/doors/doorcheck.json`). The other ~56,472 are solid shells.

The Manhattan reference app was removed in `3460f5cf1`. There is one game.

## Honest visual assessment

Frames pulled from `evidence/visual/qa-walkthrough/qa-walkthrough.mp4` at
6-second intervals. At street level the build reads as a **stylised blockout**,
not as the photoreal reference the brief targets:

- Buildings are flat extrusions. Windows are painted-on rectangles with no
  reveal, no depth, no frames. No entrances, no storefronts, no ground-floor
  logic, no roof equipment.
- Street trees are low-poly cones.
- Road surface is untextured grey with a painted centre line. No kerbs,
  gutters, drains, crossings, signals, hydrants or clutter.
- No parked vehicles, no scaffolding, no signage.

The gap between this and the attached reference images (photoreal archviz
penthouse, lobby, plaza, highway) is the entire Stage 1–4 programme. Nothing in
this file should be read as claiming otherwise.

## Stage 0 — repair before art

| Item | State | Evidence |
|---|---|---|
| A. Benchmark percentile bug | **done** | `evidence/opus/performance/percentile-bug-proof.json` |
| A. Baseline regenerated from HEAD | **not done** | old baseline invalidated in place, not yet re-run |
| A. Retired-app scenarios archived | **partial** | manhattan arm of `run.cjs` throws; 12 stale runs flagged in the baseline |
| B. One simulation authority | **not started** | two loops still advance life independently |
| C. One facade/lighting/weather authority | **not started** | not yet audited |
| D. Runtime resource defects | **not started** | `VehicleRig.tsx` not yet audited |
| E. Audits cover the real runtime | **partial** | texture dependencies now gated; tile/LOD/URL coverage still open |
| F. CI green | **partial** | typecheck, lint, 335 tests, asset verify and build pass locally |

### A — the 1% low measured the fastest frames

`summarizeFrames` sorted frame times ascending and took `percentile(0.01)`.
On an ascending array that is the *smallest* frame time, i.e. the *fastest*
frame. Published as "1% low".

Synthetic proof, 100 frames at 120 fps with N stalled to 10 fps:

| stalls | avg fps | retired "1% low" | fixed 1% low |
|---|---|---|---|
| 1 | 108.1 | 120.0 | 10.0 |
| 5 | 77.4 | 120.0 | 10.0 |
| 20 | 37.5 | 120.0 | 10.0 |
| 50 | 18.5 | 120.0 | 10.0 |

It never moved, and over 1000-frame runs it moved the *wrong way*. All 22 runs
in `docs/performance/PHASE2O_BASELINE.json` report a 1% low above their own
average — impossible — with the elevator run claiming 327.6 fps against a
44.4 fps average.

Fixed as `fps.low1`/`low01` (mean of the slowest 1%/0.1%, primary) and
`fps.low1P99`/`low01P999` (nearest-rank, for gates). Old fields renamed to
`RETIRED_*_INVALID` in both code and baseline so nothing can read them by
accident. 14 tests, `scripts/benchmarks/lib/stat.test.mjs`.

### E — five models could not find their own textures

Kenney kits reference `Textures/colormap.png` relative to the model; the
directory was never copied into `public/`. Five 404s per run, on a build whose
asset verification was green. Each GLB now embeds its own atlas.
`scripts/assets/verify-runtime-textures.mjs` walks `public/` rather than a
list — 442 models, 0 unresolvable — and returns exit 1 on a rebuilt pre-fix
model.

## Known open defects

See `docs/opus/OPEN_DEFECTS.json`.

## Not yet started

Stages 1–4 in full: hero-cell override architecture, the hero vehicle,
near-field characters, all thirteen hero environments, route-level Manhattan
detail, atmosphere presets and spatial audio, Mission Control screen states,
and the continuous route. No work has begun on any of them and no evidence
exists for any of them.
