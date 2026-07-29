# GScatter workspace license audit

Audit date: 2026-07-29

Workspace:
`bc4079d7-c863-4bb9-82cc-45d028387ddf`

## Result

All 145 catalog entries were opened and inspected across all eight ecosystems.
The catalog totals and observed totals matched:

| Ecosystem | Catalog | Inspected |
| --- | ---: | ---: |
| Kitchen Herbs | 5 | 5 |
| Garden Glory | 10 | 10 |
| Kugelfangtrift | 10 | 10 |
| Urban Wilderness | 17 | 17 |
| Bee Meadow | 20 | 20 |
| Eilenriede Forest | 35 | 35 |
| Pathside | 14 | 14 |
| Field Meadow | 34 | 34 |
| **Total** | **145** | **145** |

No inspected asset panel displayed a CC0, commercial-use, or redistribution
license override. The panels expose asset names, botanical or pack details,
download formats, and download size, while license rights come from the
workspace-wide Graswald EULA.

## Governing terms

- Gscatter itself is free for commercial use:
  <https://graswald.notion.site/Gscatter-Introduction-319a0e9e6d5646919a4f1032fdad7019>
- Graswald Web App assets are available under a non-commercial license by
  default; commercial use requires contacting Graswald:
  <https://graswald.notion.site/Graswald-Web-App-Introduction-d10d2b75889b4df2b08e0fb8cad950a6>
- The current EULA defines the free license as non-commercial, requires every
  downloader or user to be a registered permitted user, and prohibits providing
  the original or modified Graswald asset files to third parties on a
  stand-alone or redistributed basis:
  <https://graswald.notion.site/End-User-License-Agreement-e8cac35ea7dc4240a57878ff5f9bc4a2>

## Repository decision

All 145 entries are blocked from download into or publication from this public
GitHub repository.

Even a separately obtained commercial license would not by itself permit
committing exposed source FBX, Alembic, `.gscatter`, texture, or converted GLB
files. Written terms must explicitly allow commercial game use, access by the
project's contributors, and the intended distribution method. Public source
redistribution must be explicitly allowed before any Graswald-derived runtime
asset is committed.

No Graswald model, texture, archive, or Gscatter package was downloaded during
this audit.

The asset-by-asset ledger is `GSCATTER_LICENSE_AUDIT.csv`.
