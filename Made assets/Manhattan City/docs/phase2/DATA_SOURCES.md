# Data Sources

Every byte of geographic and attribute data in this project comes from an open,
attributable source. Nothing is scraped from a commercial map provider, and no
geometry or imagery is taken from a game, a paid 3D map product, or a
street-view service.

---

## In use

### OpenStreetMap — via Overpass API

- **What:** building footprints, roads, rivers, parks, bridges, piers,
  railways, coastline, place names
- **Endpoint:** `https://overpass-api.de/api/interpreter`
- **Fetched by:** `scripts/01_fetch_osm.py`
- **Cached to:** `source_data/osm/`
- **Licence:** Open Database License (ODbL) 1.0
- **Attribution required:** yes — "© OpenStreetMap contributors"
- **Share-alike:** yes, on derived databases. See `LICENSING.md`.

### NYC Open Data (Socrata) — `data.cityofnewyork.us`

All NYC datasets below are published under NYC Open Data Terms of Use
(NYC Local Law 11 of 2012). They are free to use, redistribute and build on,
with attribution and no warranty.

| Dataset | Id | Rows fetched | Used for |
|---|---|---|---|
| BUILDING (footprints) | `5zhs-2jue` | 45,194 (MN) | BIN, BBL, surveyed `height_roof`, `ground_elevation`, `construction_year`, feature code |
| PLUTO | `64uk-42ks` | 42,544 (MN) | building class, land use, year built, floors, units, floor areas, zoning, owner |
| 2020 Neighborhood Tabulation Areas | `9nt8-h7nd` | 38 (MN) | authoritative district polygons |
| Centerline (LION) | `inkn-q76z` | 16,379 edges | street graph, lane counts, one-way flags, posted speed, carriageway width → traffic and the walk network |
| Planimetric Sidewalk | `52n9-sdep` | 5,202 polygons | kerb and pavement geometry, and the point-in-pavement test that every pedestrian and every prop has to pass |
| Forestry Tree Points | `hn5i-inap` | 254,514 → 54,214 (MN, on pavement) | street tree position, genus (crown form) and dbh (canopy scale) |
| Traffic Volume Counts | `7ym2-wayt` | 343,555 MN observations → 808 segments | mean hourly volume per street, driving traffic density |

The two mapped-geometry resources named in the Phase 2 spec, Centerline
`3mf9-qshr` and Sidewalk `vfx9-tbb6`, are Esri-backed and return `{}` from the
Socrata tabular API. The tabular twins above are the ones that serve rows.

**Fetched by:** `scripts/phase2/40_fetch_nyc_open_data.py`
**Cached to:** `source_data/nyc/`

Filters: BUILDING `bin >= 1000000 AND bin < 2000000` (first digit 1 =
Manhattan); PLUTO `borough='MN'`; NTA `boroname='Manhattan'`.

The fetcher pages at 20,000 rows, retries 4× with backoff, and skips any file
already on disk — delete a file to refetch.

---

## Fetched but not yet wired in

Listed here so the Phase 2 plan and the code agree.

| Dataset | Id | Will be used for | Blocking |
|---|---|---|---|
| Bus Stops (MTA GTFS) | — | shelter placement, which is currently a carriageway-width proxy calibrated to the borough total rather than a real stop list | 2H polish |
| Subway entrances | — | the single biggest missing footfall generator; the demand field is built from floor space alone | 2I polish |

### Declared in the Phase 2 spec but not readable

| Dataset | Id | Status |
|---|---|---|
| Pedestrian Mobility Counts | `2de2-6x2h` | Reports 114 rows but every column is hidden on the public API — JSON returns 114 empty objects, CSV returns blank lines, `$query=SELECT *` the same. Esri-backed, like the map resources below. The pedestrian demand field is therefore validated against known geography rather than measured footfall. |
| Centerline (map resource) | `3mf9-qshr` | Returns `{}`; use the tabular twin `inkn-q76z`. |
| Planimetric Sidewalk (map resource) | `vfx9-tbb6` | Returns `{}`; use the tabular twin `52n9-sdep`. |

### Projections

The traffic counts carry `wktgeom` in NAD83 / New York Long Island
(EPSG:2263, US survey feet) and no latitude or longitude. `pyproj` is not
available here, so `scripts/phase2/nysp.py` implements the Lambert Conformal
Conic inverse directly. It is checked two ways: control points round-trip to
2 × 10⁻⁸ m and land on their published State Plane coordinates, and 99.9% of
the 808 converted count points fall within 25 m of a LION street (median
0.7 m) — which a wrong projection could not do.

Nothing in this table is currently referenced by any build script. When one is
wired in, it moves to the **In use** table above with its row count.

### Derived data written by the build

| File | Written by | Contents |
|---|---|---|
| `data/manhattan/streets/street_graph.json` | `47_build_streets.py` | 16,379 directed-capable edges, 11,256 nodes, 1,027 km drivable |
| `data/manhattan/streets/sidewalk_geom.json` | `47_build_streets.py` | 5,202 pavement polygons with 3,854 holes, 6.97 km² net |
| `data/manhattan/streets/walk_graph.json` | `48_build_walk.py` | 14,675 walk lanes, 1,250 km, 10,099 corner nodes, per-vertex surveyed free width each side |
| `data/manhattan/props/props.bin` | `48_build_walk.py` | 112,418 static prop instances, 12 bytes each, cell-indexed |

---

## Not used, and why

These were considered and deliberately excluded. The reasons are legal, not
technical.

| Source | Why excluded |
|---|---|
| Google Maps / Earth 3D tiles | Terms prohibit extraction and redistribution of geometry or imagery |
| Apple Maps, Bing Maps 3D | Same |
| Commercial 3D city-model vendors | Licence does not permit game redistribution |
| Street-view imagery (any provider) | Not licensed for texture extraction |
| Ripped assets from GTA / Forza / Need for Speed / BeamNG / commercial simulators | Copyright infringement; explicitly out of bounds for this project |
| Leaked or resold marketplace packs | No valid licence chain |
| Photographs of real facades without rights | Cannot be shipped as textures |

Facade, roof and ground-floor detail is **generated procedurally in Blender**
from the archetype fields in the registry. No photographic source material is
used for building surfaces.

---

## NYC 3D Model

The DoITT NYC 3D Building Model (multipatch / 3DS tiles) is public-domain NYC
Open Data and is legitimate to use. It is **not** currently ingested: the
project builds massing from OSM footprints extruded to NYC surveyed heights,
which produces clean, watertight, id-tagged meshes that a game runtime can
instance. The 3D model's tile meshes would have to be re-topologised and
re-identified before they were useful here.

If it is later ingested it belongs in the **In use** table with its tile list.

---

## Reproducing the source data

```bash
python scripts/01_fetch_osm.py
python scripts/phase2/40_fetch_nyc_open_data.py
```

`source_data/` is git-ignored — it is 100+ MB of third-party data that should
be re-fetched, not vendored. The build is deterministic given the same caches;
`scripts/phase2/verify_baseline.py` proves it.
