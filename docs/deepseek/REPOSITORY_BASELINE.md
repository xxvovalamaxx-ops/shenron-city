# Shenzhen City — Repository Baseline (Phase 2O)

Captured 2026-08-05 without modifying any code or files during collection.

## Identity

| Field | Value |
|---|---|
| Branch | `main` |
| HEAD | `d1e5c2ce0` — "fix: lint - add .cjs scripts to eslint node globals and ignore sketchfab-download.cjs" |
| Protocol handoff commit `e6303ba` | **NOT in this repo — recovered in nested Manhattan repo** (see below) |
| `docs/phase2/HANDOFF.md` | **NOT in this repo — recovered in nested Manhattan repo** (see below) |
| Remote | `origin/main` present; local == origin HEAD at capture time |
| Node / npm | v24.18.0 / 11.16.0 |
| Package | shenron-city 0.1.0, UNLICENSED, npm 11.16.0 lockfile |

## Handoff recovery (2026-08-05, after baseline capture)

The Phase 2O handoff lives in a **separate nested git repository**:

`E:\temp projects\shenron-city\Made assets\Manhattan City\`

- Branch `phase2/living-city`, HEAD `4de0874` — "Handoff: sequence the roadmap past 2O"
- Parent commit `e6303ba` — "Handoff: roadmap for continuing without a vision model" (the orchestrator-prompt commit)
- `docs/phase2/HANDOFF.md` (361 lines, read in full), `docs/phase2/LICENSING.md` (242 lines, read in full), `docs/qa/PHASE2_BUG_LEDGER.csv` (76+ rows)
- 133 tracked files, clean tree, app: `apps/manhattan-threejs/` (Vite + three 0.169.0), pipeline: `scripts/phase2/*.py`, evidence JSONs in `docs/phase2/`
- This repo is **gitignored by the outer repo** — it does not appear in outer `git status`

**This nested repo is the real Phase 2O target.** The outer shenron-city repo remains the asset/production repo (SourceAssets, GLB pipeline, LFS). Wave 1 worker branches (2o-baseline, qa-integrity, vision-bridge) run in Manhattan worktrees; asset branches (asset-catalog, asset-technical) run in the outer repo.

## Checks

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | PASS (0 errors) |
| Lint (tracked code only) | `npx eslint` over 172 tracked ts/tsx/mjs/cjs files | PASS (0 errors; 1 ignored-file notice for scripts/sketchfab-download.cjs) |
| Lint (full) | `npm run lint` | **FAIL — 291 errors, 0 warnings, 100% untracked scratch files** |
| Tests | `npm test` | PASS — 45 files, 374 tests, 0 failures (1.64 s) |
| Build | `npm run build` | PASS (920 ms). Chunk warning: `Tree` 4,000 kB (gzip 2,987 kB) — matches KNOWN_ISSUES.md |
| Dist | fresh `dist/` produced; main chunk 1,039 kB (gzip 302 kB) |

Full `npm run lint` failures are caused exclusively by ~110 untracked scratch files:
- `scripts/sketchfab-*.cjs` (14 files), `scripts/download-*.cjs` (17 files), `check-sketchfab-login.cjs`, `download-vehicles-robust.cjs`
- `scripts/tmp7wre6qyq.py`, `scripts/tmpfg7q49ic.py`, `scripts/ifbx_patched_txcegevy.py`, `scripts/patched_fbx_dgc0sv85.py`
- `ds/asset-catalog/SourceAssets/PublicLibrary/Kenney/kenney-1-bit-pack/Tilemap/tileset_colored.tsx` (asset pack file parsed as TS)

No committed code contributes a lint error.

## Working tree state (capture time)

| Stat | Count |
|---|---|
| Total changed paths | 3,608 |
| Deletions | 2,084 |
| Modifications | 1,408 |
| Untracked | 116 |

Deletions concentrate in `SourceAssets/PublicLibrary/`: Renderpeople `posed_plus`/`rigged` (FBX+textures), 38 Sketchfab character GLBs, Kenney foliage-sprites, Kenney particle-pack. These are working-tree deletions already present at capture time — **not made by this session, not committed, not reverted without approval**.

Modifications: `SourceAssets/PublicLibrary/README.md`, `download-receipts.json`.

Untracked includes new download batches (Buildings, Vehicles, Animals, Interiors, Props, Vegetation, Weapons, Characters, Nature, Textures, Roads, UI, VFX, HDRIs, Vehicles subfamilies, `SourceAssets/Models/Architecture/Manhattan_Buildings/`, `SourceAssets/Models/Vehicles/Supercars/`), debug scripts, and `scripts/.cookies.txt` (see security note).

## Security note

`scripts/.cookies.txt` exists, 952 bytes, **untracked**. Contents not inspected or printed.
**Resolution (2026-08-05): `.gitignore` updated** — `scripts/.cookies.txt`, `check-sketchfab-login.cjs`, `scripts/download-*.cjs`, `scripts/sketchfab-*.cjs`, tmp/patched `.py` scripts, and `scripts/debug-page.png` are now ignored (verified via `git check-ignore`). File left on disk.
Other credential-adjacent risk: `scripts/sketchfab-api-cookies.cjs` reads cookie strings (no secrets committed in tracked files at capture time).

## Phase 2O findings

### P2-075 (Times Square benchmark camera)
**RESOLVED (2026-08-05) — reconciled against the recovered Manhattan handoff.**
- Ledger row 76 (P2-075) records the fix: START camera moved to real Times Square
- `apps/manhattan-threejs/src/main.js`: `TIMES_SQUARE = { x: -1476, y: -2433 }`, `START = { x: -1476, y: -2433, alt: 620 }`, `camera.position.set(START.x, START.alt, -START.y)` — world is y-down, so this is a 620 m top-down view of the actual intersection
- `capture.js` SHOTS already include `times_square: [40.7580, -73.9855, EYE, 0.30, 0.14, 'walk']` (real lat/lon)
- **Still open per handoff: all performance claims are "optimistic and unverified"** — re-measuring them at the real locations IS the 2O-A benchmark-harness task (worker: ds/2o-baseline)
- The earlier "camera located in Lincoln Square" concern does not apply — that predates the P2-075 fix recorded in the ledger

### Phase interpretation
- 2O-A (honest baseline + harness): benchmark harness does not exist yet → must be built (worker: ds/2o-baseline, Manhattan repo); this document is the outer-repo baseline
- 2O-B (evidence-based structural optimization): not started — blocked on 2O-A
- 2O-C (final optimization after Phase 3): future

## Known issues carried from docs/Production/KNOWN_ISSUES.md
- No production facial rig / viseme / hair-card / 4-level character LOD
- No embedded `MSFT_lod` hierarchy in production GLBs; distant skyline uses runtime LOD
- No steering pivots / suspension / wear sets / explicit LOD for vehicle families
- 4 MB Tree code chunk
- High-preset 60 FPS / 45 FPS 1%-low not proven; no full gameplay recording or LUFS/true-peak capture
- Only Lobby and Floor 45 elevator destinations

## Git LFS
- 8,017 LFS pointers; materialized content ≈ 8.3 GB; `.git/lfs` on disk 17.4 GB
- Non-LFS tracked blobs: 2,615.9 MB across 70,078 blobs; 72,666 tracked files
