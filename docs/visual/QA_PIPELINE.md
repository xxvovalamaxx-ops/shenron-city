# Shenron City — Visual QA Pipeline

Deterministic, evidence-first capture bridge for the 17-scene visual review
brief. Captures are reproducible screenshots from a fixed camera, analysed
with pure numerical checks and (optionally) reviewed by a vision model
against a strict JSON schema. The bridge records evidence; it never fixes
art. Art defects land in the ledger for the art track.

## Repository layout

| Path | Purpose |
|---|---|
| `scripts/visual-qa/scene-manifest.json` | The 17 scenes: poses, time, rain, resolution, asset IDs. Single source of truth for both runner and review. |
| `scripts/visual-qa/frame-analysis.mjs` | Pure, dependency-free frame checks (luma stats, 3×3 band grid, edges, distinct colours, frame diff). Runs identically under Node and vitest. |
| `scripts/visual-qa/png-decode.mjs` | Minimal dependency-free PNG decoder (8-bit RGB/RGBA, all four filter types) used by the runner. |
| `scripts/visual-qa/capture.mjs` | Headless-Chromium capture runner (puppeteer-core) against the fixed dev server. |
| `scripts/visual-qa/contact-sheet.mjs` | Emits `evidence/visual/contact-sheet.html` from a capture run. |
| `src/gameplay/vision-capture.ts` | Opt-in URL parsing (`?visionCapture=1&...`). Byte-identical game behaviour without the flag. |
| `evidence/visual/captures/` | Runner output: `frame-a.png`, `frame-b.png`, `metadata.json` per scene, plus `run-summary.json`. |
| `docs/visual/VISION_REVIEW_SCHEMA.json` | Strict JSON Schema for vision-model review verdicts. |
| `docs/visual/VISUAL_DEFECT_LEDGER.json` | Defect ledger. P0 content gaps are pre-seeded; art defects are appended from reviews. |

## Capture contract

The runner opens `http://127.0.0.1:9122/?visionCapture=1&visionX=...&visionY=...&visionZ=...&visionTX=...&visionTY=...&visionTZ=...&visionFov=...&visionTime=...&visionRain=...&visionSeed=...`.

- `visionTime` is hours (0..24); `visionRain` is 0 (dry) to 1 (downpour, pre-saturated road).
- The game mounts a fixed camera (never follows the player), writes the pose
  back to `documentElement.dataset.visionCamera`, and sets
  `documentElement.dataset.visionReady = "1"`.
- Simulation keeps running (traffic, crowd, weather) — required for the
  frame-diff check to see bounded dynamic content.
- Malformed numbers refuse the capture request; FOV is clamped 40..100,
  pose is validated to be inside the playable volume.

Runner behaviour per scene:
1. Wait for `visionReady=1`.
2. Settle wait: poll a coarse 8×8 luma grid until two consecutive samples
   agree (drift < 1.5) — streaming GLBs/tiles show up as large-scale drift
   while moving traffic does not, so settle and dynamism don't fight.
3. Sample FPS via a rAF counter.
4. Capture frame A, wait `--diff-wait-ms` (default 3000), capture frame B.
5. Run `runChecks` on A and `runFrameDiffCheck(A, B)`; collect console
   errors/warnings, page errors, and failed requests.
6. Write `evidence/visual/captures/<scene_id>/{frame-a.png, frame-b.png, metadata.json}`
   including `git_rev` provenance.

Exit code is 1 if any captured scene fails a P0 check (black frame, flat
frame, void, or camera-moved diff), so the bridge itself can gate CI while
P1/P2 defects remain evidence for review.

## Numerical checks (frame-analysis.mjs)

| Check | Pass threshold | Severity |
|---|---|---|
| `frame-not-black` | mean luma > 6 | P0 |
| `frame-not-flat` | lumaStddev > 2 and > 400 distinct colours | P0 |
| `aspect-ratio` | width/height within 0.01 of 16:9 | P1 |
| `no-full-black-corner` | all 9 bands > 1 mean luma | P1 |
| `no-void` | band spread > 4 (not a solid fill) | P0 |
| `overexposure-budget` | < 0.15 pixels above luma 250 | P2 |
| `near-black-budget` | < 0.85 pixels below luma 8 (night loosens via per-scene override) | P2 |
| `band-uniformity` | band luma stddev > 1 | P2 |
| `silhouette-coverage` | > 0.05 grid edges (geometry present, not a fog wall) | P1 |
| `ground-present` | bottom band non-black with texture variance | P2 |
| `color-palette-present` | bright-pixel saturation > 0.01 | P2 |
| `frame-diff` (pair) | 0.05 <= mean luma diff <= 12 | P1 |

## Scene manifest notes

- Coordinate system: metres, +Y up, HQ entrance at z=0; camera positions are
  eye-level (y = floor + 1.66). HQ floor 45 sits at y=180, so poses there are
  181.71.
- `hero-street-night` and `hero-street-rain` are weather variants of
  `hero-street` (same pose, different time/rain).
- Four scenes are `status: "not-built"` — `penthouse-bedroom`,
  `penthouse-living-room`, `residential-lobby`, `hero-vehicle-interior`. The
  runner skips them and the ledger records them as P0 content gaps. The
  bridge does not fabricate evidence for content that does not exist.

## Running it

```sh
# Dev server must be running on 127.0.0.1:9122 (npm run dev).
node scripts/visual-qa/capture.mjs                     # all ready scenes
node scripts/visual-qa/capture.mjs --scenes hero-street,market
node scripts/visual-qa/capture.mjs --headed            # debug a single scene
node scripts/visual-qa/contact-sheet.mjs               # rebuild the HTML sheet
```

`PUPPETEER_EXECUTABLE_PATH` selects the browser binary (defaults to Edge or
Chrome on Windows, chromium on Linux).

## Vision-model review

After a capture run, send each scene's frame-a.png with its `metadata.json`
to the vision model. The reviewer must return a verdict object matching
`docs/visual/VISION_REVIEW_SCHEMA.json` exactly, with:

- `verdict`: `pass` | `fail` | `uncertain`
- `reference_match_confidence`: how strongly the frame matches the manifest
  description of the scene (0..1)
- `commercial_game_credibility`: whether the frame would pass a commercial
  game screenshot review (0..1)
- `blocking_defects[]`: every visible defect, each with a unique `id`,
  severity P0..P2, category, `location_normalized` (0..1 relative to frame
  corners), `visible_evidence` (frame-a/b + crop coordinates), and
  `recommended_owner`
- `scores`: geometry, materials, lighting, character_realism,
  vehicle_realism, animation, world_density, technical_cleanliness, overall
  (0..1 each)

Rule: any scene with a P0 or P1 blocking defect, or a score below 0.6, must
be marked `fail`. Hero scenes (hero-vehicle-exterior, hero-street, market,
hq-exterior, hq-entrance) require **two independent reviews**; if the two
reviews disagree on the verdict, an external human reviews the frame pair.

Accepted reviews are appended to `docs/visual/VISUAL_DEFECT_LEDGER.json`
under `reviews`; unique defect ids are added to `defects`. The ledger is
seeded with the four P0 content gaps.
