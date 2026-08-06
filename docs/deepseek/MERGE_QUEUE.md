# Shenzhen City — Merge Queue (Phase 2O)

## Rules

- No merge without: clean branch commit, tests, evidence, changed-file list, no unrelated changes.
- Merge order respects dependencies (catalog before technical; baseline before QA; QA before vision).
- **Merge target = Manhattan repo `phase2/living-city`** for 2o-baseline/qa-integrity/vision-bridge; shenron `main` for asset branches (shenron main tree is frozen dirty — 3,608 paths — merges only after user decision).
- All merges require explicit user approval. The orchestrator does not merge unilaterally.

## Queue (as of 2026-08-05, after handoff recovery)

| # | Branch | Repo | Status | Depends on | Approved | Merged |
|---|---|---|---|---|---|---|
| — | ds/asset-catalog | shenron | exists (locked) | — | pending | no |
| — | ds/asset-technical | shenron | exists (sparse unfinished) | asset-catalog | pending | no |
| — | ds/2o-baseline | Manhattan | **delivered 2026-08-06 in outer repo** (harness, P2-075 reconciliation, baseline docs/tests) — see TASK_BOARD 2O-A-001 | — | pending | no |
| — | ds/qa-integrity | Manhattan | worktree ready | 2o-baseline | pending | no |
| — | ds/vision-bridge | Manhattan | worktree ready | qa-integrity | pending | no |

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
  merges — the branch contains them; reconciliation is the merge step.

## Wave 1 definition of done

All five branches produce: clean commit, tests, evidence, exact changed-file list, known limitations, no unrelated changes.

## Blocker for entry — RESOLVED

The handoff (`e6303ba`, `docs/phase2/HANDOFF.md`) was recovered in the nested Manhattan repo. Wave 1 content is now defined by the handoff + task board. Remaining coordination risk: the concurrent session mutating shenron repo branches (main worktree moved to `ds/vision-bridge` at 21:10) — reconcile with that session before any shenron merge.
