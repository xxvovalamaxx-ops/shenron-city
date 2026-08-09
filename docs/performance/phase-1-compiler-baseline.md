# Phase 1 compiler fixture baseline

Recorded 2026-08-09 from the committed synthetic fixture. These figures verify accounting and regression stability; they are not production Manhattan budgets.

| Metric | Fixture result |
| --- | ---: |
| AOI contract | 1,000 m |
| Standard tile size | 256 m |
| Input/normalized buildings | 6 / 6 |
| Occupied visual/gameplay tiles | 6 / 6 |
| Visual GLB bytes | 11,664 |
| Materials per tile | 1 |
| Compiler/release contract | `city-pipeline/0.1.2`; gameplay schema 2; release schema 1 |

The development runtime acceptance at `evidence/opus/performance/phase1runtimecheck.json` additionally proves that the corrected OGC transforms render a non-black 1080p frame, the HQ-area player spawn resolves at world Y 12 m, four near gameplay tiles/colliders are resident, the HQ roof resolves near 112 m, and a collision sweep stops before the building centre. This is a SwiftShader correctness probe, not a real-GPU performance result.

The release descriptor at `tests/fixtures/manhattan-phase1/generated/release.json` binds the package source digest, normalized derivation digest, canonical tileset/gameplay URIs, and all six required initial visual tile IDs. The authoritative per-tile triangle, mesh, bounds, and byte figures live in `tests/fixtures/manhattan-phase1/generated/reports`. Any intentional generator change must regenerate the fixture through the staged publisher, explain the byte-level delta, and keep the full validation suite green.
