# Manhattan — procedural world

A full-island, map-driven reconstruction of Manhattan in Blender 5.1.
**56,501 buildings, 97.5% carrying real OpenStreetMap height tags.** Every
building is a real footprint extruded to a real height — nothing is scattered
and nothing is hand-placed.

The entire world regenerates from source data in **~46 seconds**, headless.

![plan](renders/plan.png)

## Quick start

Rebuild the whole world:

```bash
blender --background --factory-startup --python "scripts/99_build.py" -- all
```

Render the still set:

```bash
blender --background --python "scripts/92_shots.py"
```

Render the 24-second aerial flythrough:

```bash
blender --background --python "scripts/94_playblast.py"
```

Export for three.js (Draco-compressed, per-building vertex colour):

```bash
blender --background --python "scripts/96_export_gltf.py" -- --tiles
```

Re-fetch source data from Overpass (only needed if you change the query area):

```bash
python "scripts/01_fetch_osm.py"
python "scripts/02_process_osm.py"
```

## Layout

```
source_data/   raw Overpass JSON + cache/*.pkl build caches
scripts/       21 scripts; 99_build.py is the headless driver
blend/         manhattan_world.blend
renders/       still set (shot_*.png) + plan.png
playblasts/    flythrough.mp4 + frame sequence
exports/       manhattan_world.glb
docs/          PIPELINE.md, data_report.json
```

## Stages

`99_build.py` runs these in order; any subset can be re-run against the saved
world (e.g. `-- lookdev save` to iterate lighting without rebuilding 56k
buildings):

`setup · materials · terrain · parks · roads · buildings · bridges · piers ·
landmarks · traffic · cameras · lookdev · save`

## Read next

**[docs/PIPELINE.md](docs/PIPELINE.md)** — the full write-up: data sources,
height derivation, the land/water winding algorithm, the setback and traffic
systems, what is real vs. approximate, performance notes, and how to extend
this to real terrain, night lighting, or another city.
