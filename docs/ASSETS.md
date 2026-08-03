# Shenzhen City — asset policy

Shenzhen City is a browser game. Every shipped asset must be useful to the
current Three.js build, have recorded provenance, and fit the web performance
budget.

## Current shipped assets

Production Pass 02 ships original Blender GLBs for the hero district,
headquarters lobby, elevator structure and car, Floor 45, automatic-door leaf,
and four unbranded vehicle families. The browser also uses curated 1K Poly
Haven material maps, the optimized Shenzhen City capybara GLB, a pinned CC0
service-android GLB, detailed tree assets, and Quaternius CC0 humanoids and
animations. Legacy Kenney buildings, cars, and citizens remain verified in the
repository for compatibility, but their cartoon citizens and toy vehicle
shells are no longer rendered on the production route.

The authoritative Production Pass 02 manifest is
[`Assets/ASSET_MANIFEST.json`](Assets/ASSET_MANIFEST.json). The historical
acquisition ledger remains
[`Assets/ASSET_MANIFEST.csv`](Assets/ASSET_MANIFEST.csv). Together they record
source, creator, license, destination, and modifications. CI rejects
unreferenced binary files in `public/`, so an unused download cannot silently
inflate the production build.

## Import checklist

Before adding an asset:

1. Confirm that it is required by an implemented feature.
2. Confirm browser-compatible delivery (`.glb` for models; compressed,
   appropriately sized images for textures).
3. Record exact provenance and license data in the manifest.
4. Import only the files referenced by executable source.
5. Test the asset on low and high quality modes.
6. Run `npm run check` and review the production bundle size.

Do not commit downloaded catalogue pages, raw archive dumps, duplicate source
files, Unreal or Unity packages, or unreviewed character/animation bundles.

## Local authoring workspace

`SourceAssets/PublicLibrary/` is the tracked intake area for the current
license-screened Kenney source packs. It contains UI, input prompts, audio,
particle, and skybox candidates with included license files, download receipts,
and per-file SHA-256 manifests. It is intentionally outside `public/` until a
runtime feature uses a reviewed, optimized subset. Verify it with:

```powershell
node scripts/assets/catalog-public-library.mjs
node scripts/assets/verify-public-library.mjs
```

`SourceAssets/` provides the Blender/model/animation/texture folder structure
without adding working binaries to normal Git history. The historical FBX
archive can be restored locally with:

```powershell
.\scripts\restore-animation-library.ps1
node .\scripts\catalog-source-assets.mjs
```

The resulting 2,393 files remain under ignored
`SourceAssets/Animations/Raw/Unverified/`. Their tracked catalog explicitly
marks them for license review; no clip may enter a runtime export until its
provenance, skeleton, duplicate status, and game use are verified.

The current rights decision and the exact evidence needed to promote a clip
are recorded in
[`Assets/ANIMATION_RIGHTS_AUDIT.md`](Assets/ANIMATION_RIGHTS_AUDIT.md).
Provider terms cannot be inferred from filenames, and downloading a generic
license does not retroactively establish the origin of an unknown archive.

## Model pipeline

The capybara is the reference implementation for browser-ready character
assets. Its project-authored input, MIT-licensed TripoSR reconstruction,
Blender source, provenance record, inspection renders, and authoring export
live under `SourceAssets/`; only the verified runtime GLB lives under
`public/models/`.

`npm run verify:assets` rejects a missing or oversized capybara, an unexpected
clip or skeleton contract, Draco-only geometry, extra skin influences, remote
texture references, and embedded textures above the 2K budget.

The same gate pins the service android to its reviewed SHA-256 and checks its
14-clip, two-skin, facial-morph, and no-remote-dependency contract.

The Kenney citizen gate pins the Blender-converted GLB and all six runtime
skins, requires three non-empty skeletal clips and exactly 45 joints, rejects
remote dependencies and Draco, and requires the preserved CC0 source records.

The Quaternius hero gate pins a 4.29 MiB Blender export, requires the exact 29
implemented clip names, proves at least ten transform channels change in every
clip, checks the shared 65-joint skin and all ten skinned primitives, rejects
remote dependencies and Draco, and requires the preserved CC0 source records.
The tracked catalog records all 86 clips in the two free Standard archives;
the unmodified archives stay in ignored verified-source storage.

The curated city gate pins every imported building, nature, vehicle, and local
atlas file, rejects remote texture or Draco dependencies, and keeps the full
selected set below 2.5 MB.

Keep future authoring sources outside `public/`; only optimized runtime results
belong in the shipped asset tree. Model scale, axes, materials, animations,
and license must be verified before merging.

## Layered environment reference

The local Blender meadow is a quality reference and export source, not a
city-sized runtime mesh. It restores 15 exact CC0 Poly Haven assets through
the provider's public API, verifies every source checksum, and records authors,
URLs, byte counts, the 1K Blender model/material variants, and the 2K pure-sky
HDRI in
`SourceAssets/Models/Environment/polyhaven-meadow-receipt.json`.

Its renderer follows the same production constraints as the browser:
compatible biome layers, deterministic clustered scatter, exclusions around
paths and structural props, shared mesh instances, and subtle shared wind. The
web Pocket Park implements those rules with eleven pinned 1K WebP maps and four
geometry-only LOD1 templates. Medium/high quality uses the scanned PBR ground,
path, grass, fern, and weed layers; low keeps a zero-download procedural
fallback. Both modes retain four vegetation draw calls, 240/800/1,600
quality-scaled instances, deterministic exclusions, and no micro-vegetation
collision.

## Approved source categories

- Poly Haven, ambientCG, Kenney, and Quaternius assets may be evaluated when
  the exact item has a compatible license.
- Other marketplaces require item-by-item license review; a site's general
  reputation is not provenance.
- Character and animation sources require explicit redistribution and game-use
  verification before any files enter the repository.

Free does not automatically mean redistributable. The manifest, source link,
and license are mandatory even when attribution is not.

The exact public-repository allow/deny rules, including Fab, Mixamo, and
marketplace boundaries, are recorded in
[`Assets/PUBLIC_ASSET_SOURCE_POLICY.md`](Assets/PUBLIC_ASSET_SOURCE_POLICY.md).
