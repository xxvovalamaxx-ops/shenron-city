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
| Gscatter nature library | Graswald Gscatter Web App | Rejected for repository import on 2026-07-29: the official Web App documentation grants non-commercial access, requires registered permitted users, and does not grant public source-asset redistribution. Reconsider only with written commercial and redistribution permission for this public repository. |

## Gscatter review

The Gscatter **add-on** is free for commercial use, but the add-on and the
downloadable Graswald asset library have different terms:

- [Gscatter Introduction](https://graswald.notion.site/Gscatter-Introduction-319a0e9e6d5646919a4f1032fdad7019)
  says the scattering add-on itself is free, including commercial use.
- [Gscatter Web App Introduction](https://graswald.notion.site/Graswald-Web-App-Introduction-d10d2b75889b4df2b08e0fb8cad950a6)
  says Web App assets are available under a non-commercial license and directs
  commercial users to contact Graswald.
- [Gscatter EULA](https://graswald.notion.site/End-User-License-Agreement-e8cac35ea7dc4240a57878ff5f9bc4a2)
  says everyone downloading or using Graswald assets must be a registered
  permitted user. That is incompatible with committing editable source models
  to an unrestricted public GitHub repository.
- [Official installation documentation](https://graswald.notion.site/Download-Installation-Gscatter-and-Assets-dbe897a471fb47ce9661c48fdc23fec1)
  requires an account to obtain the official ZIP.
- [Official compatibility chart](https://graswald.notion.site/Changelog-515ec868dc0b49e9ad4c25e48f066b2c)
  currently documents Blender 4.2 through 4.5+ for Gscatter 0.12.x; it does not
  verify Blender 5.1/Python 3.13 compatibility.

No Graswald model, texture, ecotope, archive, or unofficial patched add-on was
downloaded or committed. Production vegetation continues to use the existing
CC0 Poly Haven inputs and project-authored Geometry Nodes/scatter tooling.

The complete workspace audit opened all 145 catalog entries across eight
ecosystems and found zero individual license overrides. See
[`GSCATTER_LICENSE_AUDIT.md`](GSCATTER_LICENSE_AUDIT.md) for the decision and
[`GSCATTER_LICENSE_AUDIT.csv`](GSCATTER_LICENSE_AUDIT.csv) for the
asset-by-asset ledger.

## Procurement rule

Prefer improving the procedural vertical slice over collecting speculative
assets. A candidate becomes repository content only in the same focused change
that renders it, records it in `ASSET_MANIFEST.csv`, tests its fallback, and
passes `npm run check`.
