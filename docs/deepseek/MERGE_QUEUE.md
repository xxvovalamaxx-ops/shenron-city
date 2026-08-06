# Shenzhen City â€” Merge Queue (Phase 2O)

## Rules

- No merge without: clean branch commit, tests, evidence, changed-file list, no unrelated changes.
- Merge order respects dependencies (catalog before technical; baseline before QA; QA before vision).
- **Merge target = Manhattan repo `phase2/living-city`** for 2o-baseline/qa-integrity/vision-bridge; shenron `main` for asset branches (shenron main tree is frozen dirty â€” 3,608 paths â€” merges only after user decision).
- All merges require explicit user approval. The orchestrator does not merge unilaterally.

## Queue (final, 2026-08-06)

| # | Branch | Repo | Status | Depends on | Approved | Merged |
|---|---|---|---|---|---|---|
| â€” | ds/asset-catalog | shenron | **superseded â€” merged by concurrent session** (`64a3c4689`, `9e1537031`, `46108d31c`) | â€” | âœ… | âœ… |
| â€” | ds/asset-technical | shenron | **MERGED by concurrent session** (`64a3c4689` â€” technical review deliverables, repair queue, preview evidence) | asset-catalog | âœ… | âœ… |
| 1 | ds/2o-baseline | Manhattan | **MERGED â€” `701d0de` (f005768)** | â€” | âœ… 2026-08-06 | âœ… |
| 2 | ds/qa-integrity | Manhattan | **MERGED â€” `b37bd02` (81a4733)** | 2o-baseline | âœ… 2026-08-06 | âœ… |
| 3 | ds/vision-bridge | Manhattan | **MERGED â€” `c78b7ad` (e7b1baa)** | qa-integrity | âœ… 2026-08-06 | âœ… |
| 4 | ds/2o-b-lod | Manhattan | **MERGED â€” `c8cf9f5` (3e753ba)** | 2O-A | âœ… 2026-08-06 | âœ… |
| 5 | ds/2o-b-perf | Manhattan | **MERGED â€” `7968fad` (c84417c)** | 2O-A | âœ… 2026-08-06 | âœ… |
| 6 | ds/2o-b-interiors | Manhattan | **MERGED â€” `9eb7a1b` (29e6a07)** | 2O-A | âœ… 2026-08-06 | âœ… |

Manhattan `phase2/living-city` @ `9eb7a1b`: clean, **50/50 QA tests pass**, 15/15 framecheck shots pass, 0 open defects.

## 2O-B items â€” ALL RESOLVED (2026-08-06)

- **LOD claim "max 0.00 m"**: disputed (real max 22.9 m) â†’ root cause was a 12 m vertical-datum bug (`LAND_LEVEL` omitted in `56_build_lods.py`) + a datum-blind harness convention. Fixed and rebuilt: median 0.000 / p90 0.0006 / **max 0.0051 m** over footprint samples. Claim CONFIRMED with corrected convention. (`docs/qa/2O_B_lod_fix.md`)
- **street-life CPU 0.4 â†’ 0.8 ms**: 2O-A's 0.8 ms was a single-sample artifact; re-measured median **0.4 ms** over 3 runs. Claim CONFIRMED. Subsystem breakdown recorded. (`docs/qa/2O_B_street_life_perf.md`)
- **QA defects (4)**: culled-from-inside 0/18 was a framecheck frame bug (mesh quaternion instead of matrixWorld inverse) + real outward-winding of solid interior walls (backface-culled from inside); lift_cab occlusion was a false positive (enclosure legitimately fills the near field) â†’ new enclosure-relative rule. **0 defects after fix.** (`docs/qa/2O_B_interiors_fix.md`)

## Process hygiene (new)

Repeated interruptions were leaving zombie vite/Chrome/node processes (held ports, burned memory, contributed to sessions appearing stuck). Rules + sweep record in `docs/deepseek/PROCESS_HYGIENE.md`. Blender MCP disabled in opencode config (spawned at startup while Blender was not running).
| â€” | ds/asset-catalog | shenron | exists (locked) | â€” | pending | no |
| â€” | ds/asset-technical | shenron | exists (sparse unfinished) | asset-catalog | pending | no |
| â€” | ds/2o-baseline | Manhattan | **delivered 2026-08-06 in outer repo** (harness, P2-075 reconciliation, baseline docs/tests) â€” see TASK_BOARD 2O-A-001 | â€” | pending | no |
| â€” | ds/qa-integrity | Manhattan | worktree ready | 2o-baseline | pending | no |
| â€” | ds/vision-bridge | Manhattan | worktree ready | qa-integrity | pending | no |

## Note (2026-08-06)

- Worker directive for 2O-A-001 specified the **outer** repo (outputs
  `docs/performance/`, `evidence/performance/phase2o-a/`, `tests/performance/`);
  task board listed the Manhattan repo. Delivered in the outer repo on
  `ds/2o-baseline`. QA worker (2O-A-002) should use
  `docs/performance/CAMERA_LOCATIONS.json` as the camera source and
  `INVALIDATED_MEASUREMENTS.md` for P2-044/P2-075 context.
- A concurrent session committed wholesale to shenron `main` during 2O-A-001
  (swept in mid-development harness scratch files); the 2o-baseline commit
  removes them. `main` also gained the asset-catalog/qa-integrity/vision-bridge
  merges â€” the branch contains them; reconciliation is the merge step.

## Wave 1 definition of done

All five branches produce: clean commit, tests, evidence, exact changed-file list, known limitations, no unrelated changes. â€” Met by all branches (both repos).

## Blocker for entry â€” RESOLVED

The handoff (`e6303ba`, `docs/phase2/HANDOFF.md`) was recovered in the nested Manhattan repo. The shenron worktree farm was completed and merged by the concurrent session (`6041c8eab`); the shenron tree is now clean and committed (asset library 83k files / 60 GB, LFS re-aligned).
