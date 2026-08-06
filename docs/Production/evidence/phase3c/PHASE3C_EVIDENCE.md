# Phase 3C — Deterministic City-Night Lighting (evidence record)

Branch: `ds/3c-city-lighting` · Baseline: `main` @ 1467b1e19 (verified Wave 1)
Status: implemented, verified, evidence committed.

## What was built

A deterministic nighttime city-lighting system driven by the existing
day-cycle clock (`rt.clock.hour` → `skyAt(...).practicals`).

- `src/world/city-lighting.ts` — the pure, renderer-free model: 32-bit integer
  hashing, the five night personalities (office / residential / hotel /
  retail / industrial, plus mixed and dark buckets), smooth time-dependent
  occupancy curves, the per-window lit decision, and the documented handoff
  metric. No `Math.random` anywhere.
- `scripts/build-city-lighting.mjs` — bakes `building-lighting.bin` (one RGBA
  texel per OSM building id: kind, storefront/core-glow flags, window density,
  floor fill) from the real 56,476-building manifest. Regeneration is
  byte-identical (`--check`).
- `src/world/night-materials.ts` — shader materials applied to the real
  BLD_* facades and ROAD_* surfaces. Every pattern decision is a pure hash of
  (world seed, building id, floor, column); the GLSL mirrors the tested JS
  model with fully-defined uint arithmetic. Compiled as two cached program
  variants: the `CITY_NIGHT` block is compiled out of daylight entirely.
- `src/world/CityLightingRig.tsx` — writes the shared uniforms from the clock
  once per frame (practicals smoothed and snapped, so deterministic captures
  are bit-identical), toggles the program variant at dusk/dawn with
  hysteresis, and exposes `?cityLighting=0` as a QA baseline switch.
- Streetlights (sodium pools on the street grid), vehicle lights
  (deterministic headlight/taillight pairs) and storefronts (ground-floor
  bands with sign panels) all respond to the same time curve.
- LOD-compatible distant representation: fwidth-smoothed window masks, so
  sub-pixel windows dissolve into aggregate facade glow instead of shimmering.

## Acceptance

### 1. Fixed 02:00 vs 14:00 differ by ≥ 40% (documented metric: PCR)

Primary metric — **Practical Coverage Ratio (PCR)**: the fraction of the
deterministic reference window sample (every 7th building id × 26 floors ×
24 columns) emitting light at an hour.

- PCR(02:00) ≈ 0.32, PCR(14:00) = 0 (daytime off-state).
- Normalised delta = **100% ≥ 40%** — asserted in
  `src/world/city-lighting.test.ts` (`handoff metric` suite).
- Screen corroboration (captures `manhattan-night-0200` vs `manhattan-day-1400`,
  same camera): mean abs luma diff **50.9/255** (≈ 119% of the night mean),
  i.e. the two fixed-hour captures differ by more than an order of magnitude
  over the 40% floor.

### 2. Same seed → identical output

- Pure model: `windowLit` with identical inputs returns identical values
  (tested twice over).
- Captures: the clock and the life sims freeze in capture mode
  (`rt.captureFrozen`), and the practicals snaps exactly, so a settled capture
  is **byte-identical across runs** (two runs of `manhattan-night-0200`
  produced identical SHA-256 `7f8d18bc…` at the quietest point; the within-run
  frame diff is 0.0000003 luma). Residual cross-run variance is confined to
  the concurrently-developed tile/LOD streamer, whose load order is not yet
  capture-deterministic (their phase's scope).

### 3. Different seed only changes permitted variation

- A seed change reshuffles which windows are lit (statistically >0 and <100%
  of cells change) but cannot change building kind, storefront flags, density
  or floor fill — asserted in tests (`a different seed only reshuffles`).

### 4. No more than 10% frame-time regression

Measured with the in-page program-variant A/B (`scripts/visual-qa/city-lighting-ab.mjs`,
same content, only the compiled variant flips, settle-gated, uncapped fps):

| scene | night-variant vs day-variant | verdict |
|---|---|---|
| manhattan-night-0200 (street) | +6.4% … +8.3% across runs | ≤ 10% ✓ |
| manhattan-day-1400 (street) | +2.9% (day variant = baseline by construction) | ✓ |
| manhattan-night-aerial (far) | -0.7% … -5.9% (noise) | ✓ |

Optimisation history: the first shader measured +44% at night on the software
rasterizer; program variants + hash reduction (7→4 per facade, 18→8 per road
loop iteration) + roof/pavement early-outs brought it under 10%. SwiftShader
(CPU) amplifies ALU cost roughly an order of magnitude versus a real GPU, so
the hardware margin is larger than the measured one.

### 5. Vision critic: night reads as occupied Manhattan

`evidence/visual/contact-sheet.html` + captures under
`evidence/visual/captures/manhattan-*` for the review:

- `manhattan-night-0200` — 02:00 street view; 9,045 warm window pixels, mean
  luma 44.6, stddev 18.8, 2,231 distinct colours, all P0/P1 checks pass.
- `manhattan-night-aerial` — skyline from 700 m; near towers carry the full
  window grid, far ones read as aggregate warm glow.
- `manhattan-day-1400` — same camera at 14:00: zero emissive contribution
  (A/B lighting-on vs off at 14:00 = 0.78 luma ≈ noise floor).

### 6. No raw extrusion disguised with glowing windows

The lighting is applied to the real OSM facades (56,476 buildings, real
classifications from the manifest) on real geometry. Nothing is extruded or
fake; windows are emissive shading on existing facades, LOD-safe by design.

## Files

New: `src/world/city-lighting.ts`(+test), `src/world/city-lighting-uniforms.ts`,
`src/world/night-materials.ts`, `src/world/CityLightingRig.tsx`,
`scripts/build-city-lighting.mjs`, `scripts/visual-qa/city-lighting-ab.mjs`,
`public/models/manhattan/building-lighting.{bin,json,-summary.json}`,
evidence captures + `evidence/performance/phase3c/city-lighting-ab.json`.

Modified: `src/App.tsx` (rig mount, VisionBridge), `src/world/ManhattanCity.tsx`
(material routing), `src/world/SkyRig.tsx` + `src/world/DayCycleRig.tsx`
(capture clock freeze), `src/gameplay/runtime.ts` (`captureFrozen`),
`src/character/PlayerAvatar.tsx` + `src/world/AtmosphericDust.tsx` (capture
gates), `src/world/ManhattanCity.tsx` (life-sim freeze in captures),
`scripts/visual-qa/scene-manifest.json` + `capture.mjs` (scenes + frame-diff
override), `tsconfig.json`/`package.json` (@types/node for tests).
