# Phase 1 city compiler foundation

This slice establishes a reproducible compiler contract plus an isolated development-only Three.js host. The default playable Manhattan route remains unchanged. The committed 1 km synthetic fixture is a technical test oracle, not a visual-production deliverable.

## Inputs and coordinate spaces

- `data/config/manhattan-hq.json` is the sole placement contract. It names the HQ anchor's vertical datum as well as its horizontal location and elevation. Normalized coordinates are metres east/north/up from HQ, where `up = sourceGroundElevationMeters - hqGeoAnchor.elevationMeters`. Render coordinates are X east, Y up, Z negative north. The root tileset transform retains the authored HQ world position, including its Y value.
- `data/locks/data-sources.lock.json` is the sole source inventory. Every input must remain repository-relative and match its SHA-256 digest before parsing. A source-wide ground-elevation datum and the explicit `same-as-hq-anchor` relation are required. Phase 1 does not guess or convert geoid, ellipsoidal, or differing vertical datums; a mismatch fails closed.
- The fixture uses WGS84 GeoJSON. EPSG:2263 source adapters must convert US survey feet using exactly `1200 / 3937` metres per foot and document their projection path.
- `package-tiles` does not trust a normalized file merely because its top-level source ID/hash look plausible. It re-normalizes the verified locked source with the active config and compiler, requires byte-identical canonical normalized JSON, and publishes the resulting `normalizedDerivationSha256` in every downstream product. A changed inner height, footprint, report, or metadata field therefore fails before any output replacement.

## 3D Tiles axis contract

The massing GLBs remain conventional Y-up assets with vertices laid out as `(east, up, -north)`. Because `tileset.json` declares `asset.gltfUpAxis = "Y"`, the 3D Tiles renderer converts GLB content into Z-up tile coordinates `(east, north, up)` before applying tile transforms. Child tile translations are therefore `[originEast, originNorth, 0]`, and every child bounding box is converted from the raw GLB bounds into that Z-up tile space. The root transform then maps Z-up tile coordinates into the game's X-east/Y-up/Z-negative-north world frame, including north yaw and the existing HQ world translation.

## Commands

Run from the repository root with Python 3.10 or later:

```powershell
python -m pipeline.python.city_pipeline build --output tests/fixtures/manhattan-phase1/generated
python -m pipeline.python.city_pipeline validate --output tests/fixtures/manhattan-phase1/generated
python -m unittest discover -s pipeline/python/tests -v
```

The lower-level commands are available when inspecting intermediate products:

```powershell
python -m pipeline.python.city_pipeline normalize --output data/normalized/buildings.json
python -m pipeline.python.city_pipeline package-tiles --normalized data/normalized/buildings.json --output data/generated/manhattan
```

Generated working data is ignored under `data/raw`, `data/normalized`, `data/generated`, `pipeline/reports`, and `public/city/generated`. The small golden fixture under `tests/fixtures/manhattan-phase1/generated` is deliberately committed. `build` and `package-tiles` first write a sibling, empty staging directory, validate it, then replace the prior output. A failed build preserves the previous tree; an output directory held open by Windows tooling fails before replacement rather than mixing new and stale files.

## Output contract

`normalized/buildings.json` contains stable sorted records, both source-datum ground elevation and HQ-local ground elevation, plus a vertical-reference report. `tileset.json` references one tile-local GLB per occupied 256 m cell. `gameplay/manifest.json` (schema version 2) references one collider JSON per matching visual tile. `reports/build-report.json` plus the per-tile reports record source hash, normalized derivation hash, counts, triangles, materials, byte size, raw Y-up GLB bounds, converted Z-up tile bounds, IDs, and validation errors.

The gameplay products are deliberately explicit about their coordinate bridge:

- The manifest is HQ-local metres with `x-east-y-up-z-negative-north`; each `boundsHqLocal` is `[east, north]` via named fields.
- `tileOriginMeters` is exactly `[hq-local-east, hq-local-north]` and is derived from the signed 256 m tile ID.
- A collider uses `tile-local-horizontal-plus-hq-local-y-up-meters`: every `footprintLocal` point is `[tile-local-east, tile-local-negative-north]`; `minY`/`maxY` are `hq-local-y-up`. Each collider declares and cross-checks its local horizontal/vertical bounds.

`release.json` (schema version 1, documented by `pipeline/schemas/release.schema.json`) is the narrow runtime entry point. It contains exactly `schemaVersion`, `sourceHash`, `normalizedDerivationSha256`, `tilesetUri` (`tileset.json`), `gameplayManifestUri` (`gameplay/manifest.json`), and sorted `requiredInitialTileIds`. The validator binds those IDs to every emitted visual child tile and rejects escaped or substituted URIs.

The validator requires all visual and gameplay tiles to agree on source ID/hash/derivation and building ownership; every building must occur exactly once; GLB accessor bounds must fit the declared 3D Tiles boxes; gameplay footprints/bounds/tile origins/activation radius/axis declarations must be finite and exact; content URIs must remain inside the output; release IDs must match emitted visual content; and reported counts/bytes must equal the artifacts on disk.

## Acceptance gates for this foundation

- Config and source lock reject malformed or unsupported values.
- A changed source byte fails SHA-256 verification before normalization.
- A `9999 m` inner-field tamper of an otherwise correctly labeled normalized input fails re-derivation before packaging.
- WGS84, HQ-local, Z-up 3D Tiles, and current-world transforms round-trip within test tolerance.
- Source ground elevations have an explicit, matching vertical datum; the fixture HQ floor and collider normalize to approximately local Y=0 and compose to the authored HQ world Y.
- The exact US-survey-foot conversion is tested.
- Tile ownership is deterministic at positive and negative 256 m boundaries, including a footprint crossing a tile edge.
- Two builds from the same locked input are byte-identical to the committed fixture.
- Replacing an existing output removes stale files only after the complete staged product validates; a staged failure leaves the old output untouched.
- Visual and gameplay IDs, counts, source hashes/derivation hashes, bounds, coordinate contracts, and release descriptor cross-validate.

## Deliberate next gate

`?city=phase1` is available only in Vite development builds. It lazy-loads the pinned `3d-tiles-renderer`, places the visual tiles through their OGC transforms, loads the separate gameplay manifest within its activation radius, reuses the existing collision engine, and exposes bounded diagnostics. `npm run qa:phase1-runtime` starts an isolated Vite/Chromium pair and gates visual residency, non-black framing, HQ spawn, ground/roof queries, collider sweep, request failures, and cleanup. Production builds cannot select the synthetic fixture route.

Before production promotion, replace the synthetic input with a separately licensed and locked official 1 km HQ-area source, verify the provisional anchor (including vertical datum) against the selected HQ building, add a source-specific CRS and any explicitly tested vertical-datum adapter, and retain the same golden/determinism/runtime checks. The one-block visual-quality, streaming-churn, repeated-mount, and real-hardware frame-time gates remain open.
