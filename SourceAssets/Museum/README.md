# Shenzhen City asset museum

A Blender display file that shows the 3D content of the public library at a
glance, organized like a museum floor.

## What it contains

- **`asset_museum.blend`** — the museum scene (256 models on display).
- **`museum_preview.png`** — a rendered overview of the museum floor.
- **`scripts/assets/build-asset-museum.py`** — the generator script that
  imports models from `SourceAssets/PublicLibrary` and lays them out.

## Organization

Models are grouped into collections, one per asset category:

| Collection | What it shows |
|---|---|
| `Buildings` | City kits, modular building kit, fantasy town, retro urban, factory, space station, modular cave/dungeon/space, graveyard |
| `Vehicles` | Cars, racing kit, train kit, watercraft, space kit |
| `Characters` | Animated characters, cube pets, mini arena |
| `Nature` | Nature kit, mini forest |
| `Street & Props` | Market, Quaternius street props, prototype, interior, platformer, retro fantasy, pirate, survival, blaster, mini packs |

Each pack is one row; models sit side by side with their name floating above
them. Floors are marked per pack row so the eye can follow each collection.

## Regenerating

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" --background --python scripts/assets/build-asset-museum.py
```

The script re-imports from the library, so it picks up new packs automatically
(the selection is capped at 8 representative models per pack to keep the file
usable — a full 7,000-model display would be multiple GB).
