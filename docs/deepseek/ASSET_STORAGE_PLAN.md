# Shenzhen City — Asset Storage Plan (Phase 2O)

## Current reality (measured, not assumed)

- Raw library: `SourceAssets/PublicLibrary/` ≈ 44.3 GB on disk, mostly **untracked** by Git.
- Git already tracks 8,017 LFS pointers (≈ 8.3 GB materialized) — the curated production inputs.
- Working tree holds 3,608 changed paths (2,084 deletions, 1,408 modifications, 116 untracked) — the untracked bulk is new download batches added since the last commit.
- Git status shows no evidence of a committed 25 GB vault; the vault is a **working-directory library**, which matches the existing `.gitignore` policy (`SourceAssets` bulk folders excluded).

## Policy decisions (proposed)

1. **Do not commit the raw library.** The repo keeps manifests, receipts, source links, low-res previews, conversion scripts, and curated runtime outputs only. This matches `docs/Assets/ASSET_MANIFEST.*` and `download-receipts.json` already present.
2. **Keep the vault in place on E:** (`SourceAssets/PublicLibrary/`). Moving 44 GB is risky, unnecessary for Phase 2O, and D: is excluded by the disk gate. E: has 262 GB free.
3. **Catalog before integrate.** Every asset family gets an entry: provenance → license → redistribution rights → technical validation → style suitability → runtime suitability → visual review → integration review. No asset enters `public/` from the vault without passing all eight gates (per section 7 of the orchestrator brief).
4. **License classes recorded per family** (quarantine marks allowed):
   - allowed for local evaluation
   - allowed for use in a game
   - allowed in a public GitHub repository
   - redistributable in source form
   - redistributable only transformed (runtime form)
   - attribution required / share-alike obligations
   - unknown → quarantine
5. **Preview policy:** contact sheets and low-res previews (≤ 1–2 MB each) are safe to track under `docs/Assets/Previews/`; raw renders (e.g. the 137 MB multilayer EXR) stay untracked or LFS.

## Vault hygiene (current risk, no action taken without approval)

- 116 untracked entries include ~40 new download batches and ~30 scratch scripts (`sketchfab-*.cjs`, `download-*.cjs`, tmp `.py`).
- `scripts/.cookies.txt` (952 B, untracked) — credential-adjacent. Proposed `.gitignore` addition:
  ```
  scripts/.cookies.txt
  ```
  No deletion. File stays on disk.
- Scratch download/debug scripts failing lint (291 errors) — proposed ignore rule or move under `scripts/scratch/` with an eslint ignore, on approval.

## Recoverability

- Nothing in this plan deletes, moves, or truncates any file.
- Any future relocation of the vault would be copy → verify (size/hash) → switch the working directory → delete only after verified copy, with explicit approval.

## Storage budget for Phase 2O

| Item | Where | Budget |
|---|---|---|
| 4 sparse worktrees | E: | ~2–6 GB |
| Processing temp (extract/convert/KTX2) | E:\temp (or C: temp) | 25–80 GB |
| Preview/contact sheets | `docs/Assets/Previews/` (tracked, small) | <1 GB |
| Build output | `dist/` (ignored) | <1 GB |
