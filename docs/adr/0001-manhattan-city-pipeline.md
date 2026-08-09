# ADR 0001: Reproducible Manhattan city compiler boundary

- Status: accepted for the Phase 1 foundation
- Date: 2026-08-09

## Context

The current game has an authored, local-coordinate city runtime. The production plan additionally needs licensed Manhattan source data, repeatable geospatial normalization, streamable visual content, and lightweight gameplay collision. Feeding raw GIS records directly into the browser would mix provenance, coordinate conversion, rendering, and gameplay concerns and would make output changes difficult to audit.

The HQ geographic anchor in `data/config/manhattan-hq.json` is provisional. It is derived from the current projection origin and authored HQ world position and must be checked against the selected official building record before production ingestion.

## Decision

Use an offline, standard-library Python compiler with a locked-input boundary:

1. `data-sources.lock.json` identifies each exact source file, digest, CRS, retrieval/version note, and license note. A digest mismatch stops the build. `package-tiles` re-derives normalized JSON from that verified source plus the active config and requires a canonical byte-for-byte match before consuming it; top-level provenance labels alone are never sufficient.
2. One validated config owns the WGS84 HQ anchor, its named vertical datum, existing world placement, axis convention, AOI, and tile sizes. At yaw zero east maps to world +X and north to world -Z; positive north yaw is clockwise, rotating north toward world +X.
3. Every locked source declares its ground-elevation vertical datum and explicitly asserts `same-as-hq-anchor`. Phase 1 does not implement generic datum conversion, so a mismatch or ambiguous relation is rejected rather than guessed. Normalization stores source ground elevation in the shared datum and emits HQ-local up as `sourceGroundElevationMeters - hqGeoAnchor.elevationMeters`.
4. A building belongs wholly to the 256 m tile containing its footprint centroid. Geometry is never cut at a tile boundary.
5. Each visual tile is a Y-up GLB laid out as X east, Y up, Z negative north. `asset.gltfUpAxis = Y` converts its content to Z-up tile coordinates X east, Y north, Z up. Child translations and bounding boxes use that tile frame; the root transform maps it into the current game world and retains the authored HQ Y placement.
6. Gameplay colliders are a separate schema-v2 manifest/product and must have exactly the same per-tile building ownership as the visual GLBs. The manifest explicitly names HQ-local axes, signed tile-origin order, the mixed tile-local-horizontal/HQ-local-up collider space, footprint point order, and vertical axis. Collider bounds, simple footprints, origins, finite values, ownership, and the fixed activation radius are cross-validated.
7. Every packaged product carries source hash and canonical normalized-derivation hash. A schema-v1 `release.json` is the sole narrow runtime entry descriptor: it binds canonical product URIs and the sorted exact set of required initial visual tile IDs to those hashes.
8. Per-tile and aggregate reports make counts, bounds, provenance, triangles, materials, and bytes machine-checkable.
9. Directory products are assembled in a sibling staging directory and validated before replacement. Failure keeps the old output; a Windows file lock fails cleanly before replacement rather than creating a stale mixed tree.
10. A development-only `?city=phase1` adapter may consume the golden fixture without replacing the default streamer. It lazy-loads the release-selected visual renderer, consumes the release-selected gameplay manifest through the existing collision engine, owns abort/disposal, and must pass browser acceptance before the contract is considered runtime-valid. Production cannot enable synthetic fixture content.

The repository fixture is intentionally synthetic and redistributable. It proves the contract and does not claim production Manhattan accuracy.

## Consequences

The build is deterministic, reviewable, and independent of Node/runtime packages. A bad source hash, stale or tampered normalized input, missing or mismatched vertical datum, invalid footprint, coordinate or glTF-axis contract change, duplicate ownership, escaped content URI, mismatched release descriptor/collider, non-finite or inconsistent bounds, unsupported activation radius, or undersized bounding volume fails closed.

This foundation includes an opt-in development renderer/collider adapter but does not replace the current city streamer, ingest official city data, generate production terrain/roads, compress textures or meshes, or implement production LODs. The adapter adds a bounded technical ground surface solely for traversal validation. Courtyard holes are preserved in normalized records, but the Phase 1 massing writer rejects holes until an explicitly tested triangulation policy is added.

## Revisit when

- the official HQ building record fixes the geographic anchor;
- production source adapters require EPSG:2263 projection handling beyond the exact US-survey-foot unit conversion or a tested vertical-datum conversion;
- hero tiles need 128 m ownership, semantic metadata, texture atlases, Meshopt, KTX2, or multiple LOD contents;
- the fixture adapter has official input and enough visual/gameplay fidelity to compete with, rather than merely coexist with, the current playable route.
