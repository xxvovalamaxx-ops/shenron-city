# Asset License Audit

- **Snapshot:** 2026-08-05T19:20:52Z
- **Scope:** SourceAssets vault (E:\temp projects\shenron-city\SourceAssets)
- **Files scanned:** 81470 (47361806855 bytes)
- **Primary asset files:** 24934
- **License files found:** 263
- **Archives:** 15

## License mix (records in registry)

| License                      | Records | Bytes       |
| ---------------------------- | ------- | ----------- |
| CC0 1.0                      | 17498   | 465024896   |
| CC BY 3.0                    | 4667    | 7697127     |
| None                         | 2683    | 25269453904 |
| CC0 2.0                      | 217     | 4210146     |
| Commercial EULA (purchase)   | 106     | 806394416   |
| In-house                     | 19      | 15963704712 |
| SIL OFL 1.1                  | 9       | 19377291    |
| MIT (TripoSR) + in-house rig | 5       | 52086307    |
| CC0                          | 5       | 14539980    |
| CC BY 4.0                    | 3       | 18299981    |

## By publisher / source pack

| Source Pack                     | Records | Bytes       |
| ------------------------------- | ------- | ----------- |
| Kenney (packs)                  | 7234    | 231471918   |
| game-icons.net                  | 4667    | 7697127     |
| Kenney                          | 4424    | 69582457    |
| Kenney (UI packs)               | 3321    | 5109821     |
| Unknown                         | 2416    | 14525782068 |
| Kenney / Quaternius (props)     | 745     | 55216275    |
| Kenney (audio packs)            | 660     | 14027471    |
| Kenney (building kits)          | 386     | 11434199    |
| Kenney (nature kit)             | 329     | 3034380     |
| Kenney (City Roads)             | 217     | 4210146     |
| Quaternius (Downtown City)      | 157     | 18194905    |
| Unknown (Mixamo-style)          | 131     | 4905826714  |
| Renderpeople (commercial)       | 106     | 806394416   |
| Sketchfab community             | 85      | 3355140023  |
| ambientCG                       | 78      | 34572423    |
| Kenney / Quaternius / RGS       | 78      | 7555448     |
| Unknown (Photorealistic)        | 39      | 2202935421  |
| Quaternius (Ultimate Buildings) | 26      | 3998392     |
| Quaternius (Modular Streets)    | 25      | 848204      |
| Poly Haven                      | 24      | 9976638     |
| ambientCG / Poly Haven          | 11      | 2365        |
| Google Fonts                    | 9       | 19377291    |
| In-house working files          | 8       | 29131417    |
| Poly Haven (unverified)         | 8       | 205383926   |
| In-house showcase blends        | 6       | 15934570741 |
| In-house (TripoSR pipeline)     | 5       | 52086307    |
| OpenGameArt (fire/smoke)        | 5       | 14539980    |
| In-house docs                   | 3       | 827         |
| Zgon (Sketchfab)                | 3       | 18299981    |
| Unknown (Sketchfab-style rip)   | 3       | 65653548    |
| In-house scripts                | 1       | 1289        |
| In-house catalogs               | 1       | 438         |
| Unknown (Sketchfab community)   | 1       | 8732204     |

## Evidence completeness

- Records with co-located license evidence: 22529
- Records missing evidence (QUARANTINE + REJECTED): 2683

## Key findings

- Kenney, Quaternius, ambientCG, Poly Haven, Google Fonts, game-icons, RGS: evidence present (license files and/or download receipts).
- Renderpeople (Rigged_Pro): purchase voucher + FAQ present, no EULA text — commercial terms, **game use only**.
- Mixamo/Adobe EULA text absent everywhere; Mixamo-derived files carry redistribution restrictions — treated as QUARANTINE.
- 7838 content-duplicate groups waste ~1088.2 MB.
- No license evidence for: Interiors, Street_Props, Photorealistic_*, Supercars, Vegetation, Animals, Weapons (non-Kenney), HDRIs, Props (non-Kenney/Quaternius), Environment (non-PolyHaven/Kenney), remaining UI/VFX/Buildings/Characters/Vehicles/Roads/Models.

## Legend

- **APPROVED_LOCAL** — In-house / working files. Fine locally; not licensed for redistribution.
- **APPROVED_GAME_ONLY** — Licensed for game use only (commercial EULA); redistribution prohibited.
- **APPROVED_PUBLIC_RUNTIME** — Free (CC0/PD) to use in the shipped game runtime.
- **APPROVED_PUBLIC_SOURCE** — Free (CC0/PD/MIT/OFL) to use AND redistribute in public source (e.g. GitHub).
- **ATTRIBUTION_REQUIRED** — Usable, including redistribution, with attribution (CC BY / OFL notice).
- **QUARANTINE** — No license evidence / unknown origin / brand or fan content. Not usable until verified.
- **REJECTED** — Suspect IP rip or trademark content. Never ship, never publish.
