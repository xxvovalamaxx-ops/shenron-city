# Manhattan Procedural World — Pipeline

A full-island, data-driven reconstruction of Manhattan in Blender 5.1.
Every building is a real OpenStreetMap footprint extruded to a real height —
there is no random scatter and no hand placement anywhere in the city.

The entire world rebuilds from source data in **about 70 seconds** headless.

---

## 1. Numbers

| Quantity | Value |
|---|---|
| Buildings | **56,501** (≈44.9k Manhattan + context boroughs) |
| Direct OSM `height` tag | **54,192 (95.9%)** |
| Derived from `building:levels` | 907 (1.6%) |
| Curated landmark override | 13 |
| Estimated by the zone model | **1,389 (2.5%)** |
| **Not estimated (real data)** | **55,112 (97.5%)** |
| Building geometry | ~2.87 M verts / 1.54 M faces in 244 merged meshes |
| Island footprint | 54.2 km² (real Manhattan: 59.1 km², difference is piers/fill and 2 m simplification) |
| Context landmass resolved | 938 km² (Brooklyn, Queens, Bronx, Jersey, Staten Island) |
| Road segments | 21,306 built (22,544 parsed) |
| Traffic | 13,086 lane splines, 2,398 lane-km, ≈46,000 moving vehicles |
| Parks | 3,180 polygons, Central Park measured at 3.40 km² (real: 3.41 km²) |
| Trees | 37,854 |
| Bridges | 21 crossings; 6 with towers, 5 with catenary main cables + hangers |
| Piers / wharfs | 2,192 features |
| Cameras | 7 stills + a 720-frame (24 s) aerial flythrough |
| Blend size | ~280 MB uncompressed |
| Full headless rebuild | **45.6 s** |
| Flythrough render | 720 frames @ 1080p in 363 s (0.50 s/frame, EEVEE) |
| glTF export | 22.1 MB Draco-compressed, whole city |

Tallest structures, straight from OSM (no authoring):
Central Park Tower 472 m · Empire State 443.2 m · 432 Park 426 m ·
270 Park 423 m · One World Trade 417 m (541.3 m to the mast) ·
One Vanderbilt 397 m · 30 Hudson Yards 395 m · Bank of America Tower 366 m.

---

## 2. Pipeline

```
Overpass API  ──►  source_data/*.json      01_fetch_osm.py, 01b_fetch_missing.py
                        │
                        ▼
                   02_process_osm.py        (system Python — projection, height
                        │                    derivation, coastline winding,
                        ▼                    classification)
              source_data/cache/*.pkl
                        │
                        ▼
                   99_build.py              (headless Blender driver)
        ┌───────────────┼───────────────────────────────┐
        ▼               ▼                               ▼
   10_scene_setup   18_terrain  19_parks  22_roads  20_buildings
   15_materials     24_bridges  26_piers  28_landmarks
                    30_traffic  32_cameras  35_lookdev
                        │
                        ▼
              blend/manhattan_world.blend
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   92_shots.py    94_playblast.py   96_export_gltf.py
   renders/       playblasts/       exports/
```

Rebuild everything:

```bash
blender --background --factory-startup --python scripts/99_build.py -- all
```

Rebuild one stage on the existing world (e.g. iterate lighting without
regenerating 46k buildings):

```bash
blender --background --factory-startup --python scripts/99_build.py -- lookdev save
```

### Why headless

The interactive Blender session is driven through an MCP bridge, and in that
context `bpy.ops.wm.open_mainfile` / `read_homefile` / `revert_mainfile` are
**deferred** — they do not take effect until the script returns. Building into
the live session therefore silently wrote geometry into whatever file happened
to be open. Every generation stage now runs in `blender --background`, where
file operators are synchronous, the artist's session is never touched, and a
full rebuild costs ~70 s.

---

## 3. Data sources

All geometry derives from **OpenStreetMap** via the Overpass API
(© OpenStreetMap contributors, ODbL). Nothing is traced, purchased, or scanned.

| Cache | Query | Used for |
|---|---|---|
| `buildings_band0..3`, `buildings_band4_0..3` | `way["building"]` inside the Manhattan borough area (`area(3600008398124)`), split into 5 latitude bands, band 4 re-split into 4 | 46k footprints + heights |
| `coastline_wide` | `way["natural"="coastline"]` over the harbour | island outline, land/water resolution |
| `water_wide` | `natural=water`, `waterway=riverbank` | Central Park Reservoir & Lake, inland ponds |
| `roads_manhattan` | `highway=motorway…residential` | street ribbons + traffic lanes |
| `parks_manhattan` | `leisure=park/garden/…`, `landuse=grass/forest/…` | park ground, tree scatter masks |
| `bridges_wide` | `bridge=*` on highway/railway, `man_made=bridge` | East/Harlem/Hudson River crossings |
| `piers_wide` | `man_made=pier/wharf/breakwater`, `waterway=dock` | finger piers, ferry terminals |
| `context_buildings` | tall/tagged buildings in Brooklyn, Queens, Jersey | wide-shot silhouette |
| `rail_manhattan` | surface rail | Hudson Yards / viaduct context |

**Height derivation.** Every building records which rule produced its height in
the manifest's `height_source` column, so any figure here can be audited rather
than trusted:

| `height_source` | Rule | Count | Share |
|---|---|---:|---:|
| `tag` | OSM `height` (metres; feet and `'` parsed) | 54,192 | 95.9% |
| `levels` | `building:levels` × 3.2 m + 1.2 m ground floor | 907 | 1.6% |
| `landmark_override` | curated table, raise-only (see §6) | 13 | 0.02% |
| `zone_model` | neighbourhood band × footprint area × stable hash | 1,389 | 2.5% |

The headline **97.5% means "not estimated"** — `tag + levels + landmark`. The
narrower claim, *a direct OSM `height` tag*, is **95.9%**. Both are recomputed
from the manifest by `98_audit.py`.

Coverage is unusually high because NYC's OSM buildings were bulk-imported from
the NYC Open Data footprint release, which carries a surveyed roof height for
essentially every structure in the five boroughs.

---

## 4. Procedural systems

### Projection
Local tangent plane centred on the island centroid (40.78 N, 73.968 W).
1 Blender unit = 1 metre, +X east, +Y north. Equirectangular error across
Manhattan's 21 km extent stays well under a metre — far below footprint
fidelity. `blender_common.ll2xy` and `02_process_osm.ll2xy` are kept identical.

### Land / water resolution — scanline winding
The hard problem was separating land from water for the *context* boroughs.
Two approaches failed before the one that works:

* **Fixed-width inland strips from each shore.** The East River is only ~600 m
  wide, so any strip wide enough to read as a landmass bridges the river and
  swallows Manhattan.
* **Running winding number along each scanline.** Assumes the sweep starts in
  open water, but Long Island and New Jersey extend past the download bbox, so
  their enclosing ways are absent and the count never balances — most rows
  produced no land at all.

The working method uses OSM's guarantee that **land lies to the LEFT of a
coastline way**, and sets the state *absolutely* at every crossing rather than
accumulating: sweeping in +X, a downward segment means "now on land", an upward
segment means "now in water". This needs no far-field closure. A morphological
close over rows then removes the striping where the Sound's coastline is sparse.
Result: 938 km² of correctly resolved land, verified against known points
(Manhattan/Brooklyn/Queens/Jersey/Bronx = land; Hudson/East River = water).

Manhattan itself does not use the raster — its coastline ring closes cleanly, so
it is triangulated exactly from the real OSM ring (~25 m detail).

**The raster is a classifier, not geometry.** Emitting one quad per land cell
renders a staircase no matter how the quads are welded, because at that point
the steps *are* the data. Two further problems compounded it: the raster also
covered Manhattan, so its staircase poked out past the precise ring all along
the waterfront, and half a cell of wobble survives Chaikin smoothing because
corner-cutting rounds corners without reducing step amplitude.

The shoreline is therefore built as follows:

1. classify land/water on a **25 m** grid (finer costs preprocessing time only —
   the grid never becomes geometry)
2. **carve out** every precisely-modelled island, dilated by one cell, so
   Manhattan and the harbour islands own their own shores with no overlap
3. trace the land/water boundary into closed loops, land kept on the left so
   outer loops come out CCW and holes CW
4. **Chaikin ×2** to round the staircase, then **14 Laplacian passes** to damp
   the residual half-cell wobble, then Douglas-Peucker at 3 m
5. triangulate the resulting polygons

Result: 932 km² of context land in **45 contours / 9,597 verts**, down from
375,311 quads — smoother *and* two orders of magnitude cheaper.

**Depth precision is a first-class constraint at this scale.** The land started
2 m above the ocean plane, which looked harmless and was not. A 24-bit depth
buffer spanning 4 m to 120 km resolves only ~3 m at 15 km, so the ocean and the
landmass landed in the same depth bucket and z-fought across every borough.
The artefact changed appearance with the land's topology, which made it easy to
misdiagnose twice:

| Land geometry | Artefact | Wrong conclusion |
|---|---|---|
| coarse row strips | hard horizontal banding | "seams — overlap the rows" |
| overlapped strips | banding, worse | "coplanar overlap — weld it" |
| welded 50 m lattice | regular per-cell speckle | "shadow acne — disable casting" |

The isolating test was to hide every building, road, park and vehicle: the
speckle survived, proving it was the ground plane and not the city. The actual
fixes are both one-liners — raise `LAND_LEVEL` from 2 m to **12 m**, and push
camera `clip_start` from 4 m to **60 m** (an aerial camera never needs a 4 m
near plane, and the near plane is what starves depth precision). Together they
buy roughly 15× the depth resolution and the artefact disappears completely.

The welded lattice was kept regardless: it is strictly better geometry
(375,311 coplanar quads, zero duplicates, one shared vertex per corner).

### Buildings
Per footprint: extrude, then add the things that actually make Manhattan read
from the air.

* **1916-zoning setbacks.** Towers ≥110 m step in three times, 60–110 m once,
  and a third of 34–60 m buildings get a top step. Inset distance scales with
  the footprint's effective radius, mitred per edge with a validity check —
  when a footprint is too small to step again the stage simply runs to the top.
  This "wedding cake" profile is the single strongest cue separating a real
  Manhattan skyline from a field of extruded polygons.
* **Crowns and masts** above 200 m / 260 m.
* **Parapets** on 9–60 m masonry.
* **Rooftop mechanical penthouses** on 55% of roofs over 260 m².
* **Hexagonal timber water towers** on 17% of 11–65 m buildings.

**Colour** is baked per building into a `FLOAT_COLOR` corner attribute (`bcol`)
and read by a single `MAT_facade`. 46k individually coloured buildings therefore
cost one material and no extra draw calls. Colours interpolate between two
hand-picked anchors per class and then take a brightness multiplier —
jittering R/G/B independently (the obvious approach) decorrelates the channels
and produces lilac and mint skyscrapers instead of a masonry family.

Values are deliberately kept low: AgX desaturates hard as luminance rises, so
bright base colours emerge from the view transform as white rather than warm
masonry.

### Building identity across the merge
Merging 56,501 buildings into 244 meshes is what makes the city tractable — but
it destroys per-building identity unless that identity is carried explicitly.
Three things carry it:

| Carrier | Domain | Survives glTF | Purpose |
|---|---|---|---|
| `bid` | FACE, INT | no | select / isolate a building inside Blender |
| `_bid` | POINT, FLOAT | **yes** (`_BID`) | identify a building at runtime in three.js |
| `bcol` | CORNER, FLOAT_COLOR | yes (`COLOR_0`) | per-building facade colour |

`_bid` is a float because glTF has no face attributes and integers up to 2²⁴ are
exact in float32 — 56,501 is lossless. The leading underscore is what makes
Blender's exporter emit it as a custom accessor, and `export_attributes=True`
must be set or it is silently dropped.

**`exports/building_manifest.csv`** is the lookup table: one row per building,
27 columns, ~11 MB. Given a `bid` you get the source OSM way, name, address,
postcode, district, height *and which rule produced it*, class, LOD tier,
footprint area, lat/lon, local x/y, the merged mesh it lives in, its exact
`face_start`/`face_count` and `vert_start`/`vert_count` range, material class
and collision proxy. `exports/building_index.json` describes the 244 chunks,
the projection, and the attribute schema.

That makes the merged city fully addressable again — you can select, isolate,
replace, illuminate, stream or attribute any one of the 56,501 buildings, in
Blender or in the browser.

### Traffic
Every drivable road becomes a poly spline (offset to the right of the centreline
so opposing streams separate). One Geometry Nodes tree turns all of them into
evenly spaced instanced cars and slides each point along its own tangent by
`(scene_time × speed) mod spacing`. Because the cars are identical and evenly
spaced, a car reaching the next slot is indistinguishable from the one that was
there — the wrap is invisible, traffic flows continuously, and corners work
because the tangent is re-evaluated per point. **One modifier drives ~46,000
vehicles.**

### Atmosphere
Aerial perspective comes from the **mist pass** driving a compositor mix, not a
world volume. A volume scatter is the physically correct approach and is what
Cycles wants, but EEVEE's froxel volumetrics cannot integrate a 45 km range and
return an essentially black frame. Mist gives the same read for free and stays
controllable. Blender 5.x specifics: the compositor is a node *group* assigned
to `scene.compositing_node_group` and terminated by `NodeGroupOutput`;
`CompositorNodeComposite` and `CompositorNodeMixRGB` no longer exist.

---

## 5. What is real vs. approximate

**Real (straight from OSM, no authoring):**
footprint geometry for all 46,286 buildings · 97% of building heights ·
the Manhattan shoreline · Central Park and every other park boundary ·
the Reservoir and the Lake · the street network · bridge alignments ·
pier and wharf outlines · Roosevelt / Randalls / Governors Island.

**Landmark-enhanced (curated, but geometry still from OSM):**
13 named towers whose OSM height belonged to a podium or annex —
Chrysler 56.6→318.9 m, 30 Rockefeller Plaza 10→266 m, Seagram 20→157 m,
Trump Tower 20→202 m, Citigroup Center 111→279 m, Hearst 30→182 m,
Woolworth 120→241.4 m, Trump World Tower 44.6→262 m, Solow 67→210 m, and others.
Only ever raised, never lowered, and only on footprints over 800 m².
Plus the One World Trade mast (417 m roof → 541.3 m tip) and the Empire State
mast, positioned from the cached building centroids.

**Approximate:**
* Setbacks, crowns, parapets, roof plant and water towers are *rules*, not
  per-building truth — correct in character and distribution, not per address.
* The Statue of Liberty is a hand-built low-poly silhouette (star fort,
  pedestal, figure, torch) placed at its true coordinates.
* Context boroughs are a 50 m land raster with sparse tall buildings only —
  correct shorelines, deliberately low detail.
* Terrain is flat. Manhattan's real relief (Washington Heights, Morningside) is
  not modelled.
* Building colour is procedural, not photographic.

---

## 6. Performance

* **222 merged building meshes, not 46k objects.** Blender's depsgraph falls
  over well before 46k objects but handles 2.3 M verts across ~250 meshes
  without effort. Meshes are chunked on a 1,400 m grid *and* by height band, so
  towers/mid/low-rise can be isolated or culled independently.
* Trees are merged blobs (8 verts each) in 72 chunk meshes, not instances.
* Traffic is GPU instancing via one Geometry Nodes modifier.
* One facade material for the whole city, driven by a vertex colour attribute.
* Full rebuild ≈70 s. EEVEE still ≈1–2 s at 1080p. The 720-frame flythrough
  renders in minutes, not hours.
* Cycles/OptiX is configured for hero stills (`92_shots.py -- --cycles`).

---

## 7. Three.js / game export

```bash
blender -b --python scripts/96_export_gltf.py -- --tiles
```

* Per-building colour travels in `COLOR_0` — set `vertexColors: true` on the
  three.js material and all 46k colours arrive with one draw call per tile.
* `--tiles` writes one `.glb` per spatial chunk so a web viewer can stream and
  frustum-cull rather than loading the whole island at once.
* Draco compression is on by default.
* Blender is Z-up, glTF is Y-up; the exporter converts, so imported geometry is
  already correct for three.js' default world.
* **Traffic does not cross the glTF boundary and is not meant to.** The ~52,800
  vehicles are Geometry Nodes *instances* evaluated inside Blender; the GLB
  contains no vehicles and no vehicle animation. Re-implement traffic in
  three.js as an `InstancedMesh` driven by the lane polylines
  (`source_data/cache/roads.pkl`, or re-export the `CRV_traffic_lanes` splines),
  advancing each instance along its lane per frame. That is both cheaper and
  more controllable than baking tens of thousands of animated nodes.
* `exports/viewer/index.html` is a working three.js loader for the GLB —
  Draco decode, `COLOR_0` vertex colours, and click-to-pick a building that
  resolves its `_BID` against `building_manifest.csv`. Serve `exports/` over
  HTTP (`python -m http.server 8777`) and open `/viewer/`. Verified loading
  626 meshes / 3.95 M triangles in 0.8 s.

---

## 8. How to extend

* **Sharper context boroughs** — drop `MINOR_KEEP`/area thresholds in
  `02_process_osm.process_buildings` for `context_buildings`, and lower the
  raster `cell` from 50 m to 25 m in `process_land_raster`.
* **Real terrain** — sample an SRTM/USGS DEM in `18_terrain.py` and displace the
  landmass; buildings already read their base from `bc.LAND_LEVEL`, so switch
  that to a sampled height per footprint centroid.
* **Facade detail** — `MAT_facade` already bands by world Z. Swap the procedural
  band for a texture atlas keyed by the building class stored in the colour
  attribute's alpha.
* **More landmarks** — add to `LANDMARK_HEIGHTS` (heights) or `MASTS`
  (spires) in `28_landmarks.py`; both are keyed by OSM name.
* **Night lighting** — add an emission mask driven by the same Z banding, gated
  on a per-building hash so windows light unevenly.
* **Interiors / gameplay** — the 1,400 m chunk grid is already a streaming grid.
* **Other cities** — only `LAT0/LON0`, the Overpass area id, and the zone-height
  bands in `zone_height()` are Manhattan-specific. Everything else is generic.

---

## 9. Known gaps

* The land raster ends at the download bbox, producing a straight edge at the
  extreme north-east horizon.
* Context boroughs resolve at 50 m, so their shorelines are visibly stepped at
  close range. Drop `cell` in `process_land_raster` to sharpen.
* District labels are latitude-band approximations, not legal boundaries — the
  Chrysler Building lands in "Murray Hill / Kips Bay" rather than Midtown East.
  Fine for querying and streaming; not a gazetteer.
* Building multipolygon relations were not fetched, so courtyard buildings are
  solid rather than hollow.
* `building:part` ways are included alongside their parent envelope, so a few
  detailed towers carry harmless interior geometry.
* Terrain is flat.
