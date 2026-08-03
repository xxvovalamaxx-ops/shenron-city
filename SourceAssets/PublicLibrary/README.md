# Shenzhen City public asset library

This folder contains downloaded, license-screened source packs that may be
redistributed with this public GitHub repository. It is an intake library, not
the web runtime asset tree. A file belongs in `public/` only after a feature
references it, the file is optimized for the browser, and the production
manifest is updated.

## Current contents

All current packs were downloaded from official Kenney, ambientCG, Poly Haven,
Google Fonts, game-icons.net, Quaternius, and cgbookcase pages on 2026-08-03.
The pages and the included license files identify the packs as CC0 1.0 (Kenney,
ambientCG, Poly Haven, Quaternius, cgbookcase), OFL-1.1 (Google Fonts), or
CC-BY-3.0 (game-icons.net, with `Credits.txt` for the required attribution).
The voice pack also retains its included `Credits.txt` file.

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
- `VFX/kenney-light-masks/`: light cone, mask, and glow textures.
- `VFX/kenney-smoke-particles/`: smoke puff and cloud sprites.
- `VFX/kenney-splat-pack/`: paint and stain overlay textures.
- `VFX/kenney-foliage-sprites/`: vegetation sprite sheets.
- `Environment/Skyboxes/`: skybox source textures.
- `Environment/Nature/kenney-nature-kit/`: nature props, rocks, and vegetation.
- `Buildings/City/`: commercial, industrial, and suburban city kits plus roads.
- `Buildings/Modular/kenney-building-kit/`: modular building parts.
- `Props/`: furniture kit, food kit, and prototype kit props.
- `UI/kenney-ui-pack/` (see above) plus sci-fi, adventure, and pixel-adventure
  UI packs, mobile controls, cursor pack, minimap pack, emotes, and ranks.
- `UI/Icons/game-icons-urban/`: curated CC-BY-3.0 HUD, transport, weather, and
  status icons (167 SVGs, `Credits.txt` attribution retained).
- `Textures/ambientcg-*/`: curated CC0 PBR materials (asphalt, concrete,
  metal, glass-adjacent, brick, tile, plaster, wood, ground) at 1K JPG.
- `Environment/HDRI/polyhaven-*/`: six curated CC0 city/street skyboxes at 1K.
- `Environment/Models/polyhaven-*/`: six curated CC0 urban props at 1K.
- `Fonts/google-fonts-*/`: OFL-1.1 Rajdhani, Orbitron, and Noto Sans SC.
- `Characters/Animated/`: Kenney animated, blocky, and mini character packs.
- `Vehicles/Cars/`: Kenney car kit and racing kit.
- `Props/Quaternius/quaternius-downtown-city-megakit/`: CC0 modular city
  mega-kit with glTF (Godot), Unity, and Unreal exports.
- `Props/Quaternius/quaternius-lowpoly-cars/`: CC0 low-poly car pack
  (FBX/OBJ).
- `Props/Quaternius/quaternius-lowpoly-modular-street/`: CC0 modular street
  pack — signs, streetlights, roads, and crossings (FBX/OBJ).
- `Textures/cgbookcase-*/`: curated CC0 PBR street textures (asphalt,
  concrete, gravel, metal, brick, plaster, stucco, manhole cover) at 2K.

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

The game-icons.net set is CC BY 3.0: keep `Credits.txt` when redistributing
those icons. The Google Fonts sets are SIL OFL 1.1: keep their `License.txt`.

Kenney credit is not mandatory under CC0, but the project keeps the creator and
included license records for provenance. The current library is not yet
integrated into the game, so it does not affect the standalone browser build.
