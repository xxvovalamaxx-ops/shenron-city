# Shenzhen City — Disk Report (Phase 2O Disk Gate)

Captured 2026-08-05, read-only.

## Mounted drives

| Drive | Free | Used | Notes |
|---|---|---|---|
| C: | 552.7 GB | 400 GB | system; temp work dir `C:\Users\xxvov\AppData\Local\Temp\opencode` |
| D: | 85.7 GB | 845.9 GB | **do not target for new asset vault** (under 100 GB free) |
| E: | 262 GB | 184.3 GB | repo drive — `E:\temp projects\shenron-city` |

Disk gate result: **PASS on C: and E:**. D: is below the 100 GB threshold and is excluded from asset-storage proposals.

## 30 largest project directories (MB)

| Directory | MB |
|---|---|
| SourceAssets | 44,634.5 |
| SourceAssets\PublicLibrary | 44,347.2 |
| SourceAssets\PublicLibrary\_Showcases | 15,196.4 |
| SourceAssets\PublicLibrary\Characters | 8,235.1 |
| SourceAssets\PublicLibrary\Buildings | 3,956.8 |
| Made assets (all) | 3,867.3 |
| Made assets\Manhattan City | 3,814.8 |
| PublicLibrary\Buildings\Street_Props | 3,020.9 |
| PublicLibrary\Characters\Humans_Modern | 2,636.1 |
| PublicLibrary\Vehicles | 2,053.5 |
| PublicLibrary\Animals | 1,954.4 |
| PublicLibrary\Interiors | 1,919.1 |
| Made assets\Manhattan City\playblasts | 1,847.3 |
| Made assets\Manhattan City\playblasts\flythrough_frames | 1,814.1 |
| PublicLibrary\Characters\Humans_Fantasy | 1,808.1 |
| PublicLibrary\Props | 1,714.7 |
| PublicLibrary\Vegetation | 1,272.0 |
| PublicLibrary\Textures | 986.4 |
| PublicLibrary\Vehicles\Photorealistic | 803.9 |
| PublicLibrary\Characters\Rigged_Pro | 771.0 |
| PublicLibrary\Interiors\Living_Room | 659.6 |
| Made assets\Manhattan City\blend | 625.7 |
| PublicLibrary\Animals\Cats | 506.2 |
| PublicLibrary\Vegetation\Trees | 473.7 |
| Made assets\Manhattan City\archive\manhattan-geographic-foundation-v1 | 443.8 |
| PublicLibrary\Weapons | 421.7 |
| PublicLibrary\Weapons\Guns | 419.1 |
| PublicLibrary\Interiors\Bedroom | 409.1 |

## Asset vault size

- `SourceAssets/PublicLibrary/`: **44.3 GB** on disk. This is the raw downloaded library (mostly untracked by Git — the untracked list includes ~40 new download batches added since the last commit).
- Vault contains previews/renders (Playblasts 1.8 GB), photogrammetry people, Kenney/Quaternius/Poly Haven/ambientCG packs.

## Git object/database size

| Item | MB |
|---|---|
| `.git/` total | 18,663.7 |
| `.git/lfs` | 17,387.9 |
| `.git/objects` | 1,264.8 |
| packs | 1,260.6 (one .pack) |

- 72,666 tracked files; 70,078 blobs (2,615.9 MB non-LFS)
- 8,017 LFS pointers; materialized content ≈ 8.3 GB

## Worktree materialization estimate

Per full `git worktree add` checkout (shared `.git`, so no pack/LFS-cache duplication):

| Component | Size |
|---|---|
| Non-LFS tracked files | ~2.6 GB |
| LFS files smudged into working tree | ~8.3 GB |
| **Total per full worktree** | **~10.9 GB** |

Remaining worktrees to create: 4 (2o-baseline, qa-integrity, asset-technical, vision-bridge) → **~43.6 GB** at full checkout. With sparse cone checkout (`src`, `scripts`, `docs`, `public`, configs) the per-worktree cost drops to roughly **0.5–1.5 GB** (no SourceAssets LFS materialization), plus small LFS files under `public/models`.

## Temporary space required

| Operation | Estimate |
|---|---|
| Extraction (new packs) | 5–15 GB |
| Blender processing / FBX→GLB | 10–30 GB (texture packs) |
| GLB export | 2–10 GB |
| KTX2 encoding | 5–20 GB (needs compression cache) |
| Previews / contact sheets | 2–5 GB |
| Production build (`dist`) | <1 GB |
| **Total** | **~25–80 GB** on the work drive |

## Verdict and policy

- Working drive **E:** (262 GB free) is sufficient for Phase 2O worktrees and processing **if worktrees use sparse checkout** (recommended) or at most 2 full checkouts.
- If full (non-sparse) worktrees are preferred, they must be created on **C:** (552.7 GB free) or the count must be reduced.
- **D:** is excluded (85.7 GB free < 100 GB gate).
- No deletion, no movement, no truncation of any asset is proposed by this report. The 44.3 GB raw library stays where it is.

See ASSET_STORAGE_PLAN.md for the vault policy.
