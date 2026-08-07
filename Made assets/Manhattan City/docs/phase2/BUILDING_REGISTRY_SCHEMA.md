# Building Registry Schema

The canonical record for every building in the world. One row per building,
`building_id` stable for the life of the project.

- `data/manhattan/buildings/building_registry.csv` — 56,476 rows, 60 columns
- `data/manhattan/buildings/building_registry.json` — same data, keyed by id
- `data/manhattan/buildings/review_unmatched.csv` — rows with no NYC footprint
- `data/manhattan/buildings/review_ambiguous.csv` — rows with >1 plausible match

Built by, in order:

```bash
python scripts/phase2/40_fetch_nyc_open_data.py
python scripts/phase2/41_build_registry.py
python scripts/phase2/42_classify_architecture.py
python scripts/phase2/43_assign_districts.py
```

Steps 42 and 43 rewrite the same CSV in place and are idempotent. Step 41
rebuilds from source and drops their columns, so it must be followed by both.

---

## Identity

`building_id` is the join key across everything downstream: Blender mesh
attributes, glTF `_BID`, the Three.js instance table, interior assignments,
mission triggers. It survives mesh merging because it is carried as a
per-vertex attribute, not an object name.

| Column | Type | Fill | Notes |
|---|---|---|---|
| `building_id` | int | 100% | canonical id, 0-based, assigned by `41_build_registry.py` in OSM-id order so it is stable across rebuilds |
| `osm_id` | int | 100% | OpenStreetMap way/relation id |
| `osm_type` | str | 100% | `way` or `relation` |
| `bin` | int | 79.3% | NYC Building Identification Number |
| `bbl` | int | 79.3% | Borough-Block-Lot that joined PLUTO. Since P2-013 (2026-08-05) this is the BBL that actually matched a PLUTO lot: `base_bbl` where it joins, otherwise the `mappluto_bbl` (the key PLUTO stores condominium lots under). |
| `bbl_mappluto` | int | 79.3% | The footprint's `mappluto_bbl`, kept alongside `bbl` so the join provenance is auditable |
| `bbl_source` | enum | 79.3% | `base` / `mappluto` — which BBL field won the PLUTO join; empty when no BBL or no join |

Fill rates below 100% are almost always the 11,482 context-borough buildings
(Brooklyn/Queens/Bronx/Jersey skyline filler). Manhattan-only fill is far
higher — see *Coverage* below.

### Identity across the mesh pipeline

| Stage | Carrier | Domain |
|---|---|---|
| Blender | `bid` | FACE / INT |
| Blender | `_bid` | POINT / FLOAT |
| Blender | `bcol` | CORNER / FLOAT_COLOR |
| glTF | `_BID` | vertex attribute |
| glTF | `COLOR_0` | vertex colour |
| Three.js | instance index → `building_id` | lookup table |

glTF export requires `export_attributes=True` or `_BID` is silently dropped.
This is regression requirement **R14**.

---

## Geometry and placement

| Column | Type | Fill | Notes |
|---|---|---|---|
| `lat`, `lon` | float | 100% | WGS84 centroid |
| `x_m`, `y_m` | float | 100% | local tangent-plane metres, origin `LAT0=40.7800, LON0=-73.9680` |
| `footprint_area` | float m² | 100% | from the OSM polygon |
| `footprint_verts` | int | 100% | vertex count of the simplified ring |
| `roof_height` | float m | 100% | height used by the build |
| `min_height` | float m | 100% | base offset for buildings on podiums |
| `height_source` | enum | 100% | `tag` / `levels` / `nyc` / `zone` — which input won |
| `nyc_height_roof` | float m | 79.3% | surveyed roof height from NYC BUILDING |
| `nyc_ground_elev` | float m | 79.3% | surveyed ground elevation |
| `nyc_area` | float m² | 79.3% | NYC footprint area, used for the match ratio |
| `lod_tier` | enum | 100% | `landmark` / `skyline` / `district` / `block` |

`height_source` exists so the 32 removed giant-plate defects can never come
back silently: a building whose only height input was a `height=0` tag falls
through to the zone estimator and is labelled `zone`, not `tag`.

---

## Match provenance

Every join to city data records how confident it is, so downstream work can
degrade instead of guessing.

| Column | Type | Notes |
|---|---|---|
| `match_confidence` | enum | `high` / `medium` / `low` / `none` |
| `match_distance_m` | float | centroid distance to the NYC footprint |
| `match_area_ratio` | float | min(a,b)/max(a,b) of the two footprint areas |

Scoring in `41_build_registry.py`:

```
score = (1 - d / 45.0) * 0.55 + area_ratio * 0.45
high    d < 8 m   and ratio > 0.75
medium  d < 20 m  and ratio > 0.45
low     otherwise
```

Manhattan result: 42,627 high, 1,202 medium, 938 low.

---

## PLUTO attributes

Present only where the BBL joined to a PLUTO lot (99.4% of Manhattan since
P2-013; 92.0% before the mappluto-BBL fallback).

| Column | Notes |
|---|---|
| `building_class` | NYC class code, e.g. `C4`, `O6`, `R8` — the single most useful field in the whole registry |
| `land_use` | PLUTO land-use code 1–11 |
| `year_built`, `year_altered` | |
| `number_of_floors` | |
| `units_res`, `units_total` | |
| `lot_area`, `bldg_area`, `res_area`, `retail_area`, `office_area`, `garage_area`, `factory_area` | ft², as PLUTO ships them |
| `built_far` | built floor-area ratio |
| `zoning` | primary zoning district, e.g. `C6-4`, `R8B` |
| `owner`, `address`, `postcode` | |
| `num_bldgs_on_lot` | >1 means several OSM buildings share one BBL |
| `community_district` | e.g. `101` |

`retail_area` drives storefront generation; `units_res` drives interior and
population seeding; `zoning` drives street-level signage density.

---

## District

Phase 1 approximated districts with latitude bands. That was measurably wrong
(Upper West Side 1,071 buildings, East Village 70) and is now replaced by the
city's own polygons.

| Column | Fill | Notes |
|---|---|---|
| `district` | 100% | NTA name, e.g. `Hamilton Heights-Sugar Hill` |
| `nta_id` | 79.2% | e.g. `MN0101` |
| `nta_type` | 79.7% | `neighborhood` / `park` / `special` / `park_water` / `unassigned` |
| `cdta_name` | 79.2% | community-district tabulation area |
| `district_coarse` | 100% | the Phase 1 label, kept for comparison |

44,724 of 44,994 Manhattan buildings (99.40%) fall inside one of the 38
Manhattan NTAs. The 270 misses sit on piers and fill beyond the NTA shoreline
and keep their Phase 1 label with `nta_type = unassigned`.

Context-borough buildings have no NTA and keep `district_coarse` in
`district`.

---

## Architecture

Assigned by `42_classify_architecture.py` from `building_class`, `year_built`,
`number_of_floors`, `land_use` and footprint geometry.

| Column | Notes |
|---|---|
| `facade_archetype` | one of 22, see below |
| `archetype_source` | what drove the decision — `bldgclass`, `bldgclass_sub`, `bldgclass+year`, `geometry`, `osm_tag`, `name`, … |
| `material_family` | 16 values, e.g. `brownstone`, `curtain_glass`, `buff_brick` |
| `roof_archetype` | 11 values, e.g. `flat_parapet_cornice`, `deco_crown`, `setback_crown` |
| `ground_floor_archetype` | 15 values, e.g. `stoop_entry`, `storefront_row`, `glass_lobby` |
| `storefront_slots` | 1 where a storefront treatment applies, else 0 |

`archetype_source` is the honesty column: 26% of all rows (mostly context
boroughs) are `geometry`, meaning no city data backed the decision. Within
Manhattan it is 7.9%.

### The 22 archetypes

`prewar_masonry_apartment`, `brownstone_rowhouse`, `cast_iron_commercial`,
`early_skyscraper_masonry`, `art_deco_tower`, `beaux_arts_civic`,
`postwar_office_slab`, `midcentury_residential_tower`, `modern_glass_office`,
`contemporary_luxury_residential`, `industrial_loft`, `warehouse`,
`retail_podium`, `mixed_use_avenue`, `hotel`, `school`, `hospital`,
`parking_structure`, `religious`, `transit_utility`, `pier_waterfront`,
`construction`

All 22 are used.

### Classification rules that are not obvious

NYC class **C is walk-up apartments**, which in Manhattan means the tenement
stock, not brownstones. The sub-class separates them and the measured
geometry agrees (Manhattan medians):

| Class | Meaning | Footprint | Floors | → archetype |
|---|---|---|---|---|
| C0 | three families | 90 m² | 3 | brownstone |
| C3 | four families | 90 m² | 3 | brownstone |
| C2 | five–six families | 102 m² | 4 | brownstone if <160 m² and ≤5 fl |
| C5 | converted dwelling | 116 m² | 4 | brownstone if <160 m² and ≤5 fl |
| C1 | over six families | 187 m² | 5 | prewar apartment |
| C4 | old-law tenement | 166 m² | 5 | prewar apartment |
| C6, C8 | walk-up co-op | 157 m² | 5 | prewar apartment |
| C7 | walk-up over stores | 174 m² | 5 | mixed-use avenue |

B-class (two-family) medians are 86–89 m² / 3 fl, so C0 and C3 are
geometrically indistinguishable from the rowhouses beside them.

---

## Coverage

| Metric | All rows | Manhattan only |
|---|---|---|
| Buildings | 56,476 | 44,994 |
| Matched to an NYC footprint | 44,767 (79.3%) | 44,763 (**99.5%**) |
| Joined to PLUTO | 44,738 (79.2%) | 44,733 (**99.4%**) |
| Assigned an NTA | — | 44,724 (**99.4%**) |

The all-rows percentages are low only because the NYC extract is Manhattan-only
and can never match the 11,482 context-borough buildings. The Manhattan figures
are the real ones. 3,353 of the PLUTO joins succeed via `bbl_source =
mappluto` — the condominium lots P2-013 restored.

Of the 45,194 NYC footprints, 43,183 were used, 2,011 went unused (no OSM
building within 45 m — mostly small rear structures OSM does not carry) and
1,250 are shared by more than one OSM building.

---

## Validation

The classification is checked against geography, not against itself. Real
Manhattan puts rowhouses in Harlem and on the Upper West Side and towers in
Midtown; the assignment reproduces that without ever being told to:

| District | n | brownstone | prewar | mixed-use | towers |
|---|---|---|---|---|---|
| Hamilton Heights-Sugar Hill | 1,560 | 49.7% | 30.4% | 9.2% | 0.7% |
| Harlem (South) | 1,916 | 44.9% | 29.1% | 13.0% | 1.7% |
| Upper West Side (Central) | 2,719 | 41.4% | 37.2% | 8.9% | 1.1% |
| Midtown-Times Square | 1,473 | 0.4% | 10.0% | 33.4% | **34.8%** |
| Financial District-Battery Park City | 685 | 3.5% | 17.5% | 18.0% | **25.7%** |
| Chinatown-Two Bridges | 1,109 | 2.1% | 10.6% | **58.6%** | 1.8% |
| Lower East Side | 1,026 | 3.5% | 22.3% | 42.0% | 1.5% |
| Washington Heights (North) | 955 | 8.5% | **51.0%** | 17.5% | 1.7% |

An independent geometric test — footprint < 150 m² and ≤ 5 floors, the physical
envelope of a 25 ft NYC rowhouse lot — matches 36.9% of Manhattan buildings,
against 20.7% classified brownstone. The classifier is conservative relative to
the envelope, which is correct: old-law tenements occupy the same envelope and
are separated only by the sub-class.
