# Shenzhen City — future asset candidates

This is a browser/Three.js project. The current vertical slice needs no paid
asset purchase, and nothing listed here is approved for import until its exact
license, web format, performance cost, and in-game use are reviewed.

| Need | Candidate source | Evaluation gate |
|---|---|---|
| Modular city pieces | Quaternius or Kenney | Exact item is browser-ready or converts cleanly to GLB, has compatible redistribution terms, and improves the hero route |
| Hero props | Poly Haven, ambientCG, Kenney | Provenance is recorded and texture/model cost fits the production budget |
| Characters | Web-compatible GLB supplier | Character license covers game redistribution; geometry, textures, and rig fit the browser budget |
| Locomotion | Licensed animation supplier | License is recorded, animation retargeting is reproducible, and only used clips are committed |
| Sound effects | CC0 or explicitly licensed library | Exact recording and creator are recorded; files are compressed and spatial playback is tested |
| Music | Original or explicitly licensed source | License covers distribution with the game and looping/volume behavior is verified |

## Procurement rule

Prefer improving the procedural vertical slice over collecting speculative
assets. A candidate becomes repository content only in the same focused change
that renders it, records it in `ASSET_MANIFEST.csv`, tests its fallback, and
passes `npm run check`.
