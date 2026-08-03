# Shenzhen City asset museum

Blender display files that show the 3D content of the public library at a
glance, organized like a museum floor.

## Files

- **`asset_museum.blend`** — the full museum (256 models on display, one
  collection per category).
- **`Top10_Buildings.blend`** / `Top10_Vehicles.blend` /
  `Top10_Characters.blend` / `Top10_Nature.blend` / `Top10_VFX.blend` /
  `Top10_Props.blend` — one file per category showing that category's 10
  most detailed assets, each with a floating name label. A `Top10_*.png`
  preview sits next to each.
- **`museum_preview.png`** — rendered overview of the full museum floor.
- **`scripts/assets/build-asset-museum.py`** — full-museum generator.
- **`scripts/assets/build-top10-museum.py`** — per-category Top-10 generator.

## Top-10 selection

"Top 10" = the 10 largest (most detailed) 3D files per category,
deduplicated by model name. VFX shows the 10 largest 2D sprites as textured
planes, since the VFX packs are sprite-based.

## Regenerating

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/assets/build-asset-museum.py
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/assets/build-top10-museum.py
```

Both scripts re-import from the library, so they pick up new packs
automatically. The selection is capped to keep files usable — a full
7,000-model display would be multiple GB.
