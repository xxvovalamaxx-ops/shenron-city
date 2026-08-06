# Shenzhen City — Worktree Ownership (Phase 2O)

State as of 2026-08-05. Two repos: **Manhattan** (`E:\temp projects\shenron-city\Made assets\Manhattan City`, the Phase 2O build target) and **shenron** (outer repo, assets/production/LFS). A concurrent session is building the shenron worktree farm — do not mutate shenron branches without checking `git worktree list` first.

## Manhattan repo (Phase 2O build target)

| Branch / worktree | Owner | Scope | Allowed files | Forbidden files |
|---|---|---|---|---|
| `ds/2o-baseline` (`ds/2o-baseline/`) | baseline worker | Benchmark harness: programmatic fixed cameras at documented world coords, honest re-measurement of every claim in HANDOFF/BASELINE/ledger, P2-075 reconciliation | `scripts/qa/**`, `docs/qa/**`, `apps/manhattan-threejs/src/bench*` (new files only), tests | `docs/phase2/**` claims (report alongside, never edit), gameplay logic changes, `data/` regenerated outputs |
| `ds/qa-integrity` (`ds/qa-integrity/`) | QA worker | Visual-evidence pipeline: framecheck suite (stddev, distinct colors, luminance bands, occlusion, winding, raycasts, frame diff), audio RMS/asymmetry, missing-asset detection, JSON defect records | `scripts/qa/**`, `apps/manhattan-threejs/src/framecheck*` (new files only), tests | changing `main.js`/`capture.js` behavior (hooks only), `docs/phase2/**` |
| `ds/vision-bridge` (`ds/vision-bridge/`) | vision worker | Contact-sheet generation, JSON defect schema for external vision critic, defect→test conversion helpers | `scripts/vision/**`, `docs/qa/**`, tests | `src/**` runtime files |

Main worktree stays on `phase2/living-city` @ `4de0874` — never modified by worker branches.

## shenron repo (assets/production)

| Branch / worktree | Owner | Scope | Notes |
|---|---|---|---|
| `ds/asset-catalog` (exists, locked) | asset worker | Catalog PublicLibrary families, license classes, receipts | created by earlier session; do not touch without checking worktree list |
| `ds/asset-technical` (exists) | asset-technical worker | Technical validation, quarantine list | sparse-cone setup unfinished (cone mode rejects file paths like index.html) |
| `ds/vision-bridge`, `ds/2o-baseline`, `ds/qa-integrity` | — | NOT created here (shenron) | reserved by concurrent session; Manhattan versions are the active ones |
| `main` worktree | orchestrator/concurrent | now on `ds/vision-bridge` branch as of 21:10 capture | frozen dirty tree (3,608 paths) — never commit |

## Rules

- One worker owns a file/subsystem at a time. Cross-ownership changes require reassignment request.
- `docs/deepseek/` is shared (coordination contract): workers may append their branch's evidence files only.
- `docs/Production/KNOWN_ISSUES.md` (shenron) may only be edited by the orchestrator.
- No branch touches `SourceAssets/` deletions or the 3,608-path dirty state on `main` — that tree is frozen pending user decision.
- Manhattan `docs/phase2/*.md` (HANDOFF, BASELINE, LICENSING, *_REPORT.json) are branch-of-record artifacts of `phase2/living-city` — workers report corrections in `docs/qa/`, they do not rewrite history.

## Dependencies

- `ds/2o-baseline` ← `ds/qa-integrity` (harness first; QA consumes cameras)
- `ds/asset-catalog` independent (shenron)
- `ds/asset-technical` ← `ds/asset-catalog` (catalog gates technical review)
- `ds/vision-bridge` ← `ds/qa-integrity` (contact sheets feed vision)

## Required evidence per branch (Wave 1 acceptance)

1. Clean commit on the branch
2. Tests passing (node:test, `node --test`)
3. Evidence (JSON artifacts under `docs/qa/evidence/<branch>/` in Manhattan, `docs/deepseek/evidence/<branch>/` in shenron)
4. Exact changed-file list in the commit message
5. Known limitations statement
6. No unrelated changes (verified against `git diff phase2/living-city...branch`)
