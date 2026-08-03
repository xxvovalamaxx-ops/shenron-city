# Shenzhen City public asset library

This folder contains downloaded, license-screened source packs that may be
redistributed with this public GitHub repository. It is an intake library, not
the web runtime asset tree. A file belongs in `public/` only after a feature
references it, the file is optimized for the browser, and the production
manifest is updated.

## Current contents

All current packs were downloaded from official Kenney asset pages on
2026-08-03. The pages and the included `License.txt` files identify the packs
as CC0 1.0. The voice pack also retains its included `Credits.txt` file.

- `UI/kenney-ui-pack/`: buttons, panels, icons, and interface graphics.
- `UI/InputPrompts/kenney-input-prompts/`: keyboard, mouse, touch, and
  controller prompt graphics.
- `Audio/UI/`: UI and interface sound effects.
- `Audio/Foley/`: impact, footstep, and interaction-oriented sounds.
- `Audio/World/`: digital and science-fiction sounds for doors, lifts, and
  futuristic city systems.
- `Audio/Music/`: short music jingles and stingers.
- `Audio/Voice/`: placeholder male and female voiceover lines.
- `VFX/kenney-particle-pack/`: 2D particle and effect textures.
- `Environment/Skyboxes/`: skybox source textures.
- `Characters/Animated/`: Kenney animated, blocky, and mini character packs.
- `Vehicles/Cars/`: Kenney car kit and racing kit.

The archives themselves are not committed. The exact archive SHA-256 values
are in `download-receipts.json`, and the extracted file hashes are in
`ASSET_MANIFEST.json` and `ASSET_MANIFEST.csv`.

## Verification

Run these commands from the repository root after a fresh clone:

```powershell
node scripts/assets/catalog-public-library.mjs
node scripts/assets/verify-public-library.mjs
```

Catalog generation is deterministic for the checked-in files. Verification
rejects missing or changed files, missing included licenses, disallowed
catalogue/engine extras, and manifest drift.

## Rights boundary

"Free" is not enough by itself. Only the exact packs listed in
`SOURCES.md` are screened here. Do not add files from a search result, a mirror,
Fab, Mixamo, an unknown marketplace, or a bulk archive without recording the
exact item license and redistribution terms first. See
`docs/Assets/PUBLIC_ASSET_SOURCE_POLICY.md` for the repository-wide policy.

Kenney credit is not mandatory under CC0, but the project keeps the creator and
included license records for provenance. The current library is not yet
integrated into the game, so it does not affect the standalone browser build.
