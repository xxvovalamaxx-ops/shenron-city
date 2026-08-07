# Phase 2A — Accepted Geographic Foundation (frozen)

Tag: **`manhattan-geographic-foundation-v1`**
Frozen: 2026-08-03T09:33:02Z
Archive: `archive/manhattan-geographic-foundation-v1/` (68 files, 465.4 MB)
Hash record: `docs/phase2/BASELINE_HASHES.json` (85 files, 661.7 MB)
Audit record: `docs/phase2/BASELINE_AUDIT.json` (28 checks, 28 pass / 0 fail)

This is the Phase 1 world, accepted as the large-scale geographic source of
truth. Phase 2 builds **on top of** it and must never regress it.

---

## 1. Verified counts

These are re-measured from the current build, not copied from an earlier report.

| Quantity | Verified value |
|---|---|
| Buildings | **56,476** |
| Direct OSM `height` tag | 54,170 (95.9%) |
| Derived from `building:levels` | 907 (1.6%) |
| Curated landmark override | 13 |
| Estimated by zone model | 1,386 (2.5%) |
| Building chunk meshes | 242 |
| Building geometry | 2,932,907 verts / 1,569,041 faces |
| Total scene verts | 3,444,020 |
| Road segments built | 21,306 of 22,544 parsed |
| Traffic lane splines | 13,086 (2,398 lane-km) |
| Parks | 3,180 polygons; Central Park 3.40 km² |
| Trees | 37,854 |
| Bridge crossings | 21 |
| Pier features | 2,192 |
| Context land | 932.2 km², 45 smoothed contours, 9,597 verts |
| Manhattan coastline | 838-point exact OSM ring, ~25 m median segment |
| Headless rebuild | **41.6 s** |

### Correction to the previously reported figure

Earlier reports said **56,501** buildings. The verified current number is
**56,476**. The difference is 25 structures removed by the accepted
"oversized underground/subway footprint removal" fix — OSM maps subway
concourses as `building=train_station` with `location=underground`, and
Pennsylvania Station's 946 m outline was being extruded to 95 m. That fix is
part of the accepted baseline, so 56,476 is the correct number going forward.

---

## 2. Determinism proof

The `.blend`, `.glb`, `.mp4` and `.png` outputs are **not** byte-deterministic —
each embeds timestamps, encoder metadata or pointer addresses, so they differ
on every rebuild from identical input. Hashing them as a regression gate would
fail every time and train us to ignore the gate.

Determinism is therefore proven on the **derived data**, which is
byte-deterministic by construction (stable FNV hashes, no RNG in geometry):

```
manifest BEFORE rebuild: 6C222E668D27E6D7C8B761F04A99A4FF56744358B9CDDCB110EA7DC82AFE08D1
full headless rebuild ... TOTAL 41.6s
manifest AFTER  rebuild: 6C222E668D27E6D7C8B761F04A99A4FF56744358B9CDDCB110EA7DC82AFE08D1
=> DETERMINISTIC
```

`BASELINE_HASHES.json` records every file but marks each group `enforced` or
`recorded`:

| Group | Files | Enforced? | Rationale |
|---|---:|---|---|
| `scripts` | 25 | **yes** | Phase 1 generation logic |
| `caches` | 7 | **yes** | pickles are deterministic |
| `derived_data` | 3 | **yes** | manifest CSV / index JSON / data report |
| `phase2_scripts` | 2 | no | expected to grow |
| `docs` | 2 | no | expected to grow |
| `binary_outputs` | 3 | no | non-deterministic containers |
| `renders` | 26 | no | PNG timestamp chunk |
| `source_raw` | 17 | no | immutable downloads |

---

## 3. Accepted fixes that must not regress

Each is covered by an automated check in `scripts/98_audit.py`.

| # | Fix | Guarded by |
|---|---|---|
| 1 | Land/ocean depth-buffer banding | `LAND_LEVEL` = 12 m, camera `clip_start` = 60 m |
| 2 | Distant facade-pattern aliasing | camera-distance fade in `MAT_facade` |
| 3 | Self-intersecting setback caps | `roof caps free of bowtie shards` (0 / 71,692) |
| 4 | Roof-box world-axis skew | oriented to footprint principal axis |
| 5 | Underground/subway footprints | `no oversized building footprints` (max 658 m) |
| 6 | Roof-equipment overhang | `fit_box` 8-point containment; build reports counts |
| 7 | Shoreline staircase | 45 smoothed contours; islands carved from raster |
| 8 | Building identity across merge | `bid` / `_bid` attributes + manifest, audited |

---

## 4. Regression gate

```bash
# after any Phase 2 change
blender -b --python scripts/98_audit.py -- --json docs/audit.json
python scripts/phase2/verify_baseline.py --audit docs/audit.json
```

Exit code 0 = foundation intact. Non-zero if an enforced file changed, a file
went missing, a baseline audit check regressed or disappeared, or the current
audit has any failure.

Current result: **PASS** — 68 unchanged, 0 changed, 0 missing, audit 28/28.

---

## 5. Honest state of the build

The current world is a **city-scale massing model with procedural facades**.
It is not photoreal and not game-ready. Specifically:

- buildings are extruded real footprints with a procedural window shader, not
  constructed facades with modelled reveals, sills or storefronts
- there are no sidewalks, curbs, crossings or street furniture
- vehicles are 16-vertex boxes; there are no pedestrians at all
- there is no runtime, no streaming, no interiors, no audio
- traffic is a Blender Geometry Nodes preview, not a simulation

Phase 2 addresses these. This document exists so that progress is measured
against a fixed, verified starting point rather than against memory.
