# Shenzhen City source assets

This is the authoring workspace for the Three.js game. It is deliberately
separate from `public/`, which contains only optimized files loaded by the web
build.

## Layout

```text
SourceAssets/
├── Animations/              raw, reviewed, and web-export animation workflow
├── Models/
│   ├── Architecture/        buildings, modular walls, doors, interiors
│   ├── Characters/          rigs, bodies, clothing, character props
│   ├── Environment/         terrain, roads, skyline, set dressing
│   ├── Props/               furniture, signs, street and gameplay props
│   ├── Vehicles/            cars and future drivable vehicle sources
│   └── Vegetation/          trees, shrubs, planters, ground cover
├── Textures/                authoring maps; shipped maps remain in public/
├── Materials/               material recipes and Blender node references
├── Audio/                   source recordings and working mixes
├── PublicLibrary/           downloaded, license-screened public source packs
├── Blender/                 project bootstrap and Blender-side tools
├── Catalogs/                deterministic inventories safe to review in Git
└── References/              art, scale, layout, and licensing references
```

Each model category uses `Raw/`, `Working/`, and `Exports/` locally. Raw and
working binaries are not committed. Approved browser exports go to
`public/models/` only after provenance, scale, collision, animation, and bundle
budget checks pass.

`PublicLibrary/` is a separate tracked intake area for exact source packs whose
licenses permit public redistribution. It is not a runtime directory. See its
README and generated manifest before promoting any file into `public/`.

Run `scripts/restore-animation-library.ps1` to recover the historical FBX
library locally, then `node scripts/catalog-source-assets.mjs` to refresh the
reviewable catalogs.
