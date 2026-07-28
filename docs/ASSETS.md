# Shenron City — asset policy

Shenron City is a browser game. Every shipped asset must be useful to the
current Three.js build, have recorded provenance, and fit the web performance
budget.

## Current shipped assets

The city geometry, props, characters, vehicles, and audio are procedural. The
only imported files in `public/` are the curated 1K Poly Haven texture maps
used by the current material pass.

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

## Model pipeline

No external GLB model currently ships with the game. When the first approved
model is needed, introduce the smallest audited optimization toolchain in a
focused change. Do not install a global converter or restore the removed
glTF-Transform dependencies until the dependency audit is clean.

Keep authoring sources outside `public/`; only the optimized runtime result
belongs in the shipped asset tree. Model scale, axes, materials, animations,
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
