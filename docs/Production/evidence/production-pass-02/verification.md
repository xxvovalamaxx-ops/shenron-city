# Production Pass 02 verification record

Date: 2026-07-29 (Asia/Jerusalem)

## Automated gates

- `npm run check`
- `npm run inspect:production-assets`

The 2026-07-29 release gate passed with 40 Vitest files / 311 tests,
13 verified production assets, 504,928 unique production triangles, a clean
standalone-network boundary, a successful Vite build, and zero npm
vulnerabilities. The scene audit still reports the documented warning that
legacy production GLBs do not embed `MSFT_lod`.

The skyline-specific glTF inspection verified:

- LOD0: 5,801,960 bytes, 82,168 triangles, 7 material batches
- LOD1: 3,470,572 bytes, 49,120 triangles, 7 material batches
- LOD2: 1,283,320 bytes, 18,124 triangles, 7 material batches
- Bounds: 161 m wide, 54.2 m deep, and 123.94-124.64 m high
- Zero missing asset IDs or missing material assignments

## Real-browser checks

- Served the current `dist` with `vite preview` on `127.0.0.1:4173`.
- Loaded the title screen in Chromium at 2560 x 889 CSS pixels.
- Entered the city with the `no-pointer-lock=1` automation validation switch.
- Confirmed the new skyline in the production launch and fixed
  `hero-boulevard` development camera.
- Confirmed no current application console errors in the supported validation
  route. The only remaining message is Three.js's upstream `THREE.Clock`
  deprecation warning.
- Confirmed the Web Audio context was running at 48 kHz.
- Collected 20 non-zero stereo analyser samples.
- Captured the title, launch frame, and all twelve fixed regression cameras.
- Filtered current-preview console output to the local application origin.

## Skyline evidence

- `skyline-hero-boulevard.png`
- Editable source:
  `SourceAssets/Models/Environment/Working/Shenzhen_City_Production_Pass_02.blend`
- Reproducible exporter: `scripts/assets/export_production_skyline.py`
- Runtime switch: five distant cluster placements using near/middle/far
  Three.js LOD thresholds at 0 m, 175 m, and 315 m

## Fixed regression cameras

- city-entry
- hero-boulevard
- night-market-wide
- night-market-close
- kai-conversation
- hq-exterior
- hq-entrance
- hq-lobby
- secretary-close
- elevator-interior
- floor45-arrival
- agent-workstation

## Gates not completed

- Normal focused pointer-lock traversal through the complete route
- Repeated door and elevator interaction
- Every quality preset traversed end to end
- Stable target-machine frame benchmark
- Texture-memory byte measurement
- Full gameplay video recording
- Recorded-file LUFS and true-peak measurement
- Direct visual comparison to `20260728-2122-08.8564544.mp4` because that file was not
  present locally
