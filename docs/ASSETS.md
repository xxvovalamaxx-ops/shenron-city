# Shenron City — asset policy

Shenron City is a browser game. Every shipped asset must be useful to the
current Three.js build, have recorded provenance, and fit the web performance
budget.

## Current shipped assets

The city geometry, props, residents, vehicles, and audio are procedural. The
imported runtime files in `public/` are the curated 1K Poly Haven material maps
and the optimized Shenron City capybara GLB.

Every imported asset is recorded in
[`Assets/ASSET_MANIFEST.csv`](Assets/ASSET_MANIFEST.csv), including its source,
creator, license, acquisition date, destination, and modifications. CI rejects
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

## Model pipeline

The capybara is the reference implementation for browser-ready character
assets. Its project-authored input, MIT-licensed TripoSR reconstruction,
Blender source, provenance record, inspection renders, and authoring export
live under `SourceAssets/`; only the verified runtime GLB lives under
`public/models/`.

`npm run verify:assets` rejects a missing or oversized capybara, an unexpected
clip or skeleton contract, Draco-only geometry, extra skin influences, remote
texture references, and embedded textures above the 2K budget.

Keep future authoring sources outside `public/`; only optimized runtime results
belong in the shipped asset tree. Model scale, axes, materials, animations,
and license must be verified before merging.

## Approved source categories

- Poly Haven, ambientCG, Kenney, and Quaternius assets may be evaluated when
  the exact item has a compatible license.
- Other marketplaces require item-by-item license review; a site's general
  reputation is not provenance.
- Character and animation sources require explicit redistribution and game-use
  verification before any files enter the repository.

Free does not automatically mean redistributable. The manifest, source link,
and license are mandatory even when attribution is not.
