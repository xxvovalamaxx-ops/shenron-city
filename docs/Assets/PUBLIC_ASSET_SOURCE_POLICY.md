# Public asset source policy

This repository is public and forkable. “Free” is a price, not a license, so
an asset enters Git only when its exact item license permits redistribution and
its implemented runtime use passes the asset and performance gates.

## Public-Git allowlist

| Source | Allowed content | Required evidence |
|---|---|---|
| [Poly Haven](https://polyhaven.com/license) | CC0 models, textures, and HDRIs | Official item/API URL, authors, download pins, receipt, runtime hash |
| [ambientCG](https://docs.ambientcg.com/license/) | CC0 materials, HDRIs, and models | Official item/API URL, source hash, runtime hash |
| [cgbookcase](https://www.cgbookcase.com/) | Exact CC0 texture items | Item URL, creator, source hash, runtime hash |
| [Quaternius](https://quaternius.com/faq.html) | CC0 packs and Universal Animation Libraries | Pack URL, included license, archive hash, implemented clip list |
| [Kenney](https://kenney.nl/support) | CC0 game assets | Asset-page URL, included license, archive and runtime hashes |
| Fab or Sketchfab | Exact CC0 or CC-BY item only | Listing snapshot, creator, exact license, attribution/change notice, hashes |

Official APIs are preferred. Do not scrape websites, bypass authentication, or
mirror whole catalogues. Downloading everything weakens provenance, fills Git
history with unused binaries, and does not produce coherent art direction.

## Denied from public Git by default

- **Fab Standard, free Fab Standard, limited-time-free, and Megascans:** usable
  in compatible tools and incorporated projects, but the
  [Fab EULA](https://www.fab.com/eula) does not permit publishing the source
  asset as a standalone public download. Keep source in private working
  storage and never make the public repository a substitute marketplace.
- **Legacy UE Marketplace / UE-Only content:** do not use in the Three.js
  project.
- **Mixamo source characters and animations:** do not publish raw files.
- **Sketchfab Standard/NoAI, ShareTextures, BlenderKit, and unknown mirrors:**
  do not publish raw assets without a separate exact-license clearance.
- **The historical 2,393-animation archive:** remains quarantined because
  filenames do not establish acquisition provenance or redistribution rights.

## Quality rule

AAA quality is an outcome, not a download count. Each production tranche must:

1. serve a specific visible district need;
2. use one coherent material and scale language;
3. ship optimized GLB/WebP/KTX2 outputs, not raw authoring archives;
4. define collision, LOD, animation, and streaming responsibility;
5. pass source provenance, exact hashes, browser read-back, and performance
   budgets before the next tranche begins.

Fab remains useful for private evaluation and for assets whose exact listing is
CC0/CC-BY. It is not a blanket source for files that can be republished in this
public repository.
