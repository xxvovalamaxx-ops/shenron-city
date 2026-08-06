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
| — | ds/2o-baseline | Manhattan | worktree ready | — | pending | no |
| — | ds/qa-integrity | Manhattan | worktree ready | 2o-baseline | pending | no |
| — | ds/vision-bridge | Manhattan | worktree ready | qa-integrity | pending | no |

## Wave 1 definition of done

All five branches produce: clean commit, tests, evidence, exact changed-file list, known limitations, no unrelated changes.

## Blocker for entry — RESOLVED

The handoff (`e6303ba`, `docs/phase2/HANDOFF.md`) was recovered in the nested Manhattan repo. Wave 1 content is now defined by the handoff + task board. Remaining coordination risk: the concurrent session mutating shenron repo branches (main worktree moved to `ds/vision-bridge` at 21:10) — reconcile with that session before any shenron merge.
