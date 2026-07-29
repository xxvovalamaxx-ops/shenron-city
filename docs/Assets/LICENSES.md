# Production Asset Licenses

This document covers the runtime assets introduced or retained by Production Pass 02.
The machine-readable authority is `ASSET_MANIFEST.json`; the historic acquisition log is
`ASSET_MANIFEST.csv`.

## Project-owned Blender assets

The hero district, headquarters lobby, Floor 45 interior, automatic door leaf, and four
unbranded vehicle families are original project work stored in
`SourceAssets/Models/Environment/Working/Shenzhen_City_Production_Pass_02.blend`.
They may be redistributed only as part of this repository or its built game under the
project owner's terms. They are not third-party branded vehicle reproductions and contain
no ripped commercial-game content.

## CC0 material and environment sources

Poly Haven files recorded in `ASSET_MANIFEST.csv` are licensed CC0 1.0. The runtime uses
the locally stored asphalt, pavement, concrete, stone, wood, vegetation, meadow, and HDR
files listed there. No runtime asset is hotlinked.

## CC0 character and animation sources

The Service Android is the CC0 Three.js RobotExpressive sample credited in
`ASSET_MANIFEST.csv`. The current adult humanoid foundation and its animation set are
Quaternius CC0 files processed through Blender and credited in that ledger.

Kenney character and city-kit files remain in repository history/runtime storage for
compatibility, but Production Pass 02 removes the Kenney character and vehicle meshes from
the visible hero route. Their CC0 terms remain recorded in `ASSET_MANIFEST.csv`.

## Prohibited content

No ripped GTA, Forza, Need for Speed, BeamNG, Unreal Marketplace, Fab, film, or unknown
marketplace content is present in the Production Pass 02 runtime directory.

## Reviewed but not imported: Gscatter assets

On 2026-07-29 the official Graswald documents were reviewed separately for the
Gscatter add-on and the Web App asset library. The add-on is documented as free
for commercial use. The Web App assets are documented as non-commercial unless
Graswald grants commercial permission, and the EULA requires every asset user
to be a registered permitted user. Those terms do not grant redistribution of
editable asset files through this public GitHub repository.

No Graswald model, texture, ecotope, archive, or community-patched Gscatter ZIP
is included. The project may use the official add-on later as a local authoring
tool after an account download and compatible Blender release are available,
but it will scatter only project-owned or separately verified CC0 inputs unless
written Graswald permission explicitly covers this repository model.

## Realistic Japanese forest shrine

`SourceAssets/Models/Environment/Working/Japanese_Forest_Shrine_Realistic.blend`
combines project-authored CC0 architecture, terrain, stairs, lanterns, layout,
lighting, and procedural materials with verified Poly Haven CC0 nature assets
and “Komainu Statue” by Zgon under CC BY 4.0.

The untouched 1K guardian source is checked in at
`SourceAssets/Models/Environment/External/Zgon/Komainu_Statue/`.
The scene applies the supplied moss material to both symmetric guardians and
records the modification. The reference image is not redistributed. Exact
scope, attribution, and license links are recorded in
`SourceAssets/Models/Environment/JAPANESE_FOREST_SHRINE_LICENSE.md`.
