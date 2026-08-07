# Phase 2 Integrity Report — Condo BBL join and open-item audit

Audit run by the qa-integrity worker, 2026-08-05, on branch `ds/qa-integrity`.

House rule applied throughout: *if you have not measured it, you do not know
it.* Every claim below carries a number taken from a deterministic rerun of
the pipeline, not from a self-report.

---

## 1. Reproduced defects

### P2-013 — condominium BBLs do not join PLUTO (fixed)

**Symptom reproduced from source data, before any code change:**

| Quantity | Value |
|---|---|
| NYC BUILDING footprints | 45,194 |
| Footprints where `base_bbl != mappluto_bbl` | **3,536** (all condo-style lots) |
| `base_bbl` present in PLUTO | 41,705 / 45,194 (**92.28%**) |
| `mappluto_bbl` present in PLUTO | 45,143 / 45,194 (**99.89%**) |
| Diff rows joining only via `mappluto_bbl` | 3,536 |
| Diff rows joining only via `base_bbl` | 98 |
| Diff rows joining via neither | 0 |
| Non-diff rows joining via neither | 51 (BBLs ending `9999` and special keys) |

The registry script joined PLUTO on `base_bbl` alone (`41_build_registry.py`),
so every condominium — PLUTO lists condos under their own `mappluto_bbl` —
joined nothing. Baseline run confirmed the ledger's numbers exactly:
`pluto_joined_manhattan = 41,381` of 44,994 (91.97%).

**Impact measured on the data that matters:** the affected stock is the newest
and tallest in the city. After the fix, the recovered buildings include
Central Park Tower (472 m), 432 Park Avenue (426 m), 53 West 53 (320 m), 35
Hudson Yards (304.8 m), 520 5th Avenue (304.8 m) and One Manhattan West
(303 m) — all previously carrying an empty `building_class` and no floor-area
or unit fields.

### P2-026 — Javits Center misclassified (fixed)

Reproduced: building 19495 (Jacob K. Javits Convention Center, OSM way
278353371, footprint 86,231 m², roof 53.6 m) was `prewar_masonry_apartment`
via `archetype_source = geometry`. It has no NYC footprint match
(`match_confidence = none`), an uninformative OSM tag (`building=yes`), and
the geometry ladder had no notion of a giant horizontal floor plate.

---

## 2. Root causes

1. **P2-013.** `41_build_registry.py` stored a single BBL per footprint,
   `base_bbl or mappluto_bbl`, and joined PLUTO on it. `base_bbl` is the
   pre-condo parcel BBL; PLUTO no longer lists those parcels for condominium
   lots. The join was a plain `dict.get`, so a failed join silently produced
   an empty `building_class` rather than an error.
2. **P2-026.** `42_classify_architecture.py` geometry ladder ordered its
   checks by height and floors only; footprint scale never appeared. A
   30,000+ m² building is two city blocks of floor plate — no apartment or
   office building is that wide — but 53.6 m and ~15 implied floors cleared
   the tower branch, the warehouse branch (`fl <= 2`) and the rowhouse
   branch (`fl <= 5 and area < 150`), then fell to the final default.

## 3. Fixes

### 3.1 `scripts/phase2/41_build_registry.py`

- Every footprint now carries both `bbl` (`base_bbl`) and
  `bbl_mappluto` (`mappluto_bbl`).
- The PLUTO join tries `bbl` first, then `bbl_mappluto`, and records which
  one won in the new `bbl_source` column (`base` / `mappluto`, empty when the
  row has no BBL).
- The registry's `bbl` column now holds the BBL that actually joined — for
  condos that is the `mappluto_bbl`, which is also the correct key for the
  per-lot apportionment in `49_build_demand.py` (buildings sharing a condo
  lot group under the same key).
- New report fields: `pluto_joined_via_mappluto`.
- The `bbl_mappluto` / `bbl_source` columns were added to the CSV column
  order after `bbl`.

### 3.2 `scripts/phase2/42_classify_architecture.py`

The geometry ladder now checks footprint scale after the tower branch:

```
if area >= 30000:
    return (A_BEAUX_ARTS if name else A_WAREHOUSE), src
```

Measured blast radius: only 4 Manhattan buildings and 1 context building
have a footprint ≥ 30,000 m². The two transit facilities and the American
Museum of Natural History are caught by `bldgclass` earlier, so the rule
changes exactly two rows: Javits → `beaux_arts_civic`, and the one unnamed
context shed (32,011 m² Jersey filler) → `warehouse` instead of
`prewar_masonry_apartment`.

## 4. Verified results (deterministic reruns)

| Metric | Before | After |
|---|---|---|
| `pluto_joined` (all rows) | 41,385 | 44,738 |
| `pluto_joined_manhattan` | 41,381 | **44,733** |
| `pluto_joined_pct_manhattan` | 91.97% | **99.42%** |
| joined via `mappluto_bbl` | 0 | 3,353 |
| Javits archetype | `prewar_masonry_apartment` | `beaux_arts_civic` |
| Manhattan geometry-only residue | (P2-009 baseline) | 277 / 44,994 (0.6%) |

**Demand field** (`49_build_demand.py`, which consumes the PLUTO areas):
3,407 cells changed; the p99 day scale rose 17,327.9 → 21,560.1 (+24.4%) and
the p99 evening scale rose 6,257.5 → 8,862.5 (+41.6%). The recovered towers
add real floor area exactly where the hero corridor runs. Total lot
apportionment is unchanged in method; totals went from
`? -> 893,026 res units / 42.1 M m² office / 158 M m² floor area`.

**Determinism:** `41_build_registry.py` run twice → byte-identical
`building_registry.csv` (SHA-256 equal). Full chain
`41 → 42 → 43 → 49` run twice → byte-identical CSV. The CSV is the canonical
tracked artifact; the JSON duplicate and reports carry a regenerated
timestamp by design.

## 5. Open-item audit (all six remaining ledger entries)

| Ledger id | Status | Verdict |
|---|---|---|
| P2-013 | fixed | see §3.1, §4 |
| P2-026 | fixed | see §3.2, §4 |
| P2-008 | open | confirmed: 270 unassigned, 243 in Inwood, 263/270 far from the core — waterfront structures beyond the NTA shoreline; the `unassigned` label is the honest state, keep as-is |
| P2-009 | open | confirmed acceptable residue: 277 Manhattan rows (0.6%) — 215 are <300 m² rear structures, 17 are ≥60 m (30 Hudson Yards at 395 m is genuinely new construction with no lot record); auditable via `archetype_source=geometry` |
| P2-043 | wontfix | external NYC DOT API returns empty objects on JSON and CSV; not fixable from this repo |
| P2-048 | wontfix | `LOD_REPORT.json grid_m = 1400.0` — tile-grid LOD is the documented design decision |

## 6. Regression requirements

`verify_baseline.py` covers Phase 1 scripts, caches and three derived
artifacts (`docs/data_report.json`, `exports/building_index.json`,
`exports/building_manifest.csv`); none of them are touched by the
`41/42/49` changes, and `phase2_scripts` is `enforced: false`. The registry
CSV and the phase-2 reports are tracked artifacts regenerated here, so the
freeze is unaffected. No Blender phase-1 script was modified; Manhattan is
not regenerated.

## 7. Files changed

- `scripts/phase2/41_build_registry.py` — P2-013 fix + report fields
- `scripts/phase2/42_classify_architecture.py` — P2-026 fix
- `data/manhattan/buildings/building_registry.csv` — regenerated (3,353 rows
  gained PLUTO attributes, 2 new columns)
- `data/manhattan/buildings/review_unmatched.csv` — regenerated (column
  order shift from `bbl_source`)
- `data/manhattan/runtime/demand.json` — regenerated
- `docs/phase2/REGISTRY_REPORT.json`, `ARCHETYPE_REPORT.json`,
  `DEMAND_REPORT.json`, `DISTRICT_REPORT.json` — regenerated
- `docs/qa/PHASE2_BUG_LEDGER.csv` — P2-013, P2-026 fixed; P2-008/009/043/048
  audited with measurements; P2-077 added
- `docs/qa/PHASE2_INTEGRITY_REPORT.md` — this report

## 8. Permanent winding guard (P2-077)

The P2-062 fix corrected `Builder.box()` winding and verified it once
(signed volume +8.0), but nothing made the measurement a build gate —
HANDOFF §0 check #3 prescribes exactly that. Added `scripts/mesh_audit.py`
(pure stdlib, no bpy import, so it runs outside Blender):

- `signed_volume(verts, faces)` — the handoff formula
  `Σ dot(v0, cross(v1-v0, v2-v0)) / 6`, fan-triangulated.
- `is_closed(verts, faces)` — every undirected edge in exactly two faces.
- `assert_outward(name, verts, faces)` — **hard fail** when a closed mesh has
  negative signed volume. Wired into the exterior-solid scripts:
  `52_vehicles`, `54_props`, `56_build_lods`, `58_weather`, `66_subway`.
- `report_volume(name, verts, faces)` — non-fatal JSON-line diagnostic for
  interior shells, which wind inward by design (rooms, lift cab). Wired into
  `60_interiors`, `62_hq`, `64_corridor`.
- Open meshes (doorways, canopies) are skipped — an open mesh has no
  meaningful signed volume.

**Measured before wiring** (primitives replicated without Blender):

| Primitive | Signed volume | Closed |
|---|---|---|
| 2 m cube (P2-062 fixture) | +8.0 | yes |
| tapered box (taper 0.5) | +4.667 | yes |
| tube r=1 h=2 (8-gon) | +5.657 | yes |
| cone r=1 h=2 (8-gon) | +1.886 | yes |
| blob r=1 (8-seg, 3 rings) | +2.828 | yes |

Self-check: `python scripts/mesh_audit.py --self-test` → `"pass": true`,
with an inverted cube caught (assert raises) and open meshes skipped. All
eight authoring scripts still compile after the wiring.

## 9. Remaining risks

- **183 condo footprints did not gain attributes:** of the 3,536 diff
  footprints, 3,353 joined via a matched OSM building. The remaining 183 are
  NYC footprints with no OSM building within 45 m (part of the 2,011 unused
  footprints) — no registry row exists for them to join onto. This is the
  OSM coverage gap, not a join bug.
- **30 rows still have a BBL but no PLUTO row:** 18 are pseudo-BBLs ending
  `9999` (master/group lots, e.g. `1004159999`, `1999999999` Jury Duty,
  `1009959999` NYPD Times Square Substation), 12 are special keys
  (`1001210998`, etc.). None of these exist in PLUTO; they stay visible via
  `bbl_source = ''` and empty `building_class`.
- **Demand field changed materially** (3,407 cells, +24%/+42% at p99).
  Runtime visuals driven by `demand.json` will shift; no runtime change was
  needed, but the change should be seen in the next evidence capture rather
  than assumed.
- **P2-026's material family** for Javits is `limestone` because
  `beaux_arts_civic` carries that trait; there is no glass-shed archetype in
  the vocabulary. The archetype is right; the material is the nearest
  available trait.
