# Phase 2 — Regression Requirements

Every item below was a real defect that was found, diagnosed and fixed during
Phase 1. Each has an automated check. **A Phase 2 change that breaks one of
these is a regression regardless of what else it improves.**

Run the gate:

```bash
blender -b --python scripts/98_audit.py -- --json docs/audit.json
python scripts/phase2/verify_baseline.py --audit docs/audit.json
```

---

## R1 — Land/ocean depth separation

**Was:** land sat 2 m above the ocean plane. A 24-bit depth buffer spanning
4 m–120 km resolves ~3 m at 15 km, so they z-fought across every borough. The
artefact changed appearance with the land's topology (banding with coarse
quads, per-cell speckle with a fine lattice), which made it easy to
misdiagnose twice.

**Invariant:** `blender_common.LAND_LEVEL >= 10.0` and camera
`clip_start >= 40.0`.
**Check:** visual; constants asserted in `verify_phase2_invariants`.

## R2 — Distant facade aliasing

**Was:** procedural window pattern has no mip chain, so past ~600 m each pixel
sampled one arbitrary point and the city dissolved into speckle.

**Invariant:** `MAT_facade` contains a `ShaderNodeCameraData` driving a
distance fade on the window mask, the per-pane noise and the bump strength.
**Check:** node presence assertion.

## R3 — Self-intersecting setback caps

**Was:** insetting a concave footprint can fold it into a bowtie whose signed
area is still positive, so area-based validation passed it. Capped as an
n-gon it tessellated into long triangular shards spiking out of roofs.
511 of 3,980 insets (12.8%) were affected.

**Invariant:** zero self-intersecting horizontal n-gon caps.
**Check:** `roof caps free of bowtie shards` — exact segment-crossing test on
every cap ring. Currently 0 / 71,692.

> Note: an area-vs-bounding-box heuristic looks tempting here and is **wrong** —
> a long thin building on a diagonal has a huge bbox and small area while being
> perfectly convex. It false-positived on 20 ordinary Manhattan footprints.

## R4 — Roof-clutter orientation

**Was:** rooftop plant was built axis-aligned to the world while Manhattan's
grid runs ~29° off north, so every box sat skewed on its building.

**Invariant:** roof boxes/towers/masts oriented to the footprint's longest
edge (`principal_axis`).

## R5 — Roof-clutter overhang

**Was:** boxes were sized from the oriented bounding box but placed on
L-shaped roofs, so 2,504 of 11,962 (20.9%) had a corner hanging in mid-air.
Testing only the centre point passed them all.

**Invariant:** `fit_box` tests 8 points (4 corners + 4 edge midpoints), shrinks
up to 6× by 0.72, and skips rather than emitting an overhang.
**Check:** build reports `roof_clutter` counts; `box_skipped` > 0 proves the
rejection path is live.

## R6 — Oversized underground footprints

**Was:** OSM maps subway concourses as `building=train_station`,
`location=underground`. Penn Station's 946 m outline carried `height=0`, which
the parser rejected as out-of-range and passed to the *zone-model estimator* —
giving an underground concourse a 94.8 m roof and a vast plate over Midtown.

**Invariant:** skip `location=underground`, `tunnel=yes`, negative `layer` on
transit buildings, and explicit `height=0`.
**Check:** `no oversized building footprints` — no building face spans >700 m.
Largest legitimate is the North River treatment plant at 658 m.

## R7 — Shoreline quality

**Was (a):** the 50 m context raster also covered Manhattan, so its staircase
poked out past the precise 25 m coastline ring.
**Was (b):** Chaikin smoothing rounds corners but does **not** reduce step
amplitude, so a Chaikin-only shore is smooth and still wobbles by half a cell.

**Invariant:** precise islands carved out of the raster (dilated 1 cell);
contours smoothed with Chaikin ×2 **plus** ≥10 Laplacian passes.
**Check:** context land is contour geometry (≤ 20k verts), not a cell grid.

## R8 — Building identity across the merge

**Was:** merging 56k buildings into 242 meshes destroyed per-building identity.

**Invariant:** every chunk carries `bid` (FACE, INT) and `_bid` (POINT, FLOAT,
glTF-exportable as `_BID`); `building_manifest.csv` maps every id to its mesh,
face range and vertex range; ids unique and contiguous.
**Checks:** `bid uniqueness / contiguity`, `bid attribute on every chunk`,
`_bid attribute (glTF-exportable)`, `GLB carries building ids`.

> `export_attributes=True` must stay set on the glTF exporter or `_BID` is
> silently dropped and the GLB arrives with only POSITION/NORMAL/COLOR_0.

## R9 — Height provenance honesty

**Invariant:** every building records `height_source` ∈
{`tag`, `levels`, `landmark_override`, `zone_model`}. The headline "97.5%"
means *not estimated*; the direct-`height`-tag figure is **95.9%**. Both are
recomputed from the manifest, never asserted.

## R10 — Non-destructiveness

**Was:** MCP-driven `bpy.ops.wm.*` file operators are **deferred**, so an early
pass wrote terrain into whatever file was open and it was later saved —
contaminating the user's brick-building project through v002…v010.

**Invariant:** all destructive/whole-world builds run in
`blender --background`. The interactive session opens
`manhattan_world_VIEW.blend`, a throwaway copy, so a stray save cannot clobber
the canonical build.

---

## Phase 2 additions to guard

| # | Requirement |
|---|---|
| R11 | No duplicate building ids after registry merge |
| R12 | No building loses its `bid` → mesh/face-range mapping |
| R13 | No LOD pair z-fights (min 5 cm separation or mutually exclusive visibility) |
| R14 | No facade module floats or leaves a gap at a footprint corner |
| R15 | Every runtime cell referenced by the manifest exists on disk |
| R16 | No `_BID` collisions across cells |
| R17 | Lane graph has no dangling connections |
| R18 | No console error or network 404 in a clean runtime load |
