# Blender Work Log

## 2026-07-29 - Realistic Japanese forest shrine

- Asset ID: `environment.japanese_forest_shrine.realistic.v2`.
- Purpose: a publishable, editable forest-shrine hero scene that closely
  follows the supplied composition without redistributing the reference image.
- Geometry: 12,337 tagged objects, 500 mesh datablocks, 38 curves, and 17
  organized collections.
- Materials: 37 active project/CC0/CC-BY materials and 72 packed images; the
  CC0 forest HDRI stays as one checked-in external dependency.
- Contents: 88 individually weathered stair stones, expanded dark-wood shrine
  with 1,904 curved roof-tile instances and a recessed sanctuary, three stone
  lanterns, two realistic komainu, 87 tree instances plus 13 understory trees,
  112 moss rocks, 920 ferns, 8,000 grass/moss instances, dense modeled
  hydrangea banks, local fog, authored sun shafts, hero camera, and 17 lights.
- Final spatial revision: stair stones were buried further into the hillside,
  stair-joint moss was made camera-readable, the left guardian was reduced and
  moved deeper into the scene, the shrine was lowered, and the right foreground
  flower mound was reduced to reveal the hero guardian silhouette.
- Grounding revision: the komainu now face inward toward the stair axis, and
  69 individually staggered retaining-wall blocks and support piers physically
  connect the shrine's downhill wing to the terraced bank.
- Guardian geometry: 100,320 evaluated triangles across two symmetric meshes; supplied
  moss PBR material packed at a 512 px authoring cap.
- Source:
  `SourceAssets/Models/Environment/Working/Japanese_Forest_Shrine_Realistic.blend`.
- Generator: `SourceAssets/Blender/scripts/create_japanese_forest_shrine.py`.
- Final renders:
  `docs/Assets/Previews/Final/japanese-forest-shrine-final-1937x1079.png`,
  `japanese-forest-shrine-final-3840x2140.png`, and the verified multilayer
  OpenEXR under `docs/Assets/Previews/Final/Passes/`.
- Render configuration: Cycles/OptiX, 512 adaptive samples, 0.005 noise
  threshold, 12 maximum bounces, OpenImageDenoise, and AgX Medium High
  Contrast. The locked exact PNG took 87.370 seconds, the 4K PNG took 333.446
  seconds, and the exact multilayer EXR took 87.088 seconds on an RTX 5070.
- License: project-authored and Poly Haven work under CC0 1.0; “Komainu
  Statue” by Zgon under CC BY 4.0 with attribution and modifications recorded.
- Known limitation: this is a legally reproducible reference-inspired scene,
  not a pixel-identical reconstruction of an unavailable original production
  set.

## Historical checkpoint

## 2026-07-29 - Original CC0 Japanese forest shrine

- Asset ID: `environment.japanese_forest_shrine.original.v1`.
- Purpose: an editable forest-shrine environment source that is safe to publish
  and modify in a public GitHub repository.
- Reference scope: broad composition only—forested hillside, stone stairway,
  Japanese shrine, stone lanterns, guardian sculptures, moss, flowers, and
  cinematic daylight. The reference image is not redistributed.
- Dimensions: approximately 40 × 55 × 22 m in metric Blender units.
- Geometry: 1,063 tagged objects, 669 mesh datablocks, 32 curves, and eight
  organized collections.
- Materials: 21 original procedural materials; no image textures or HDRIs.
- Contents: irregular stair and retaining-stone set, detailed shrine shell,
  veranda and curved roofs, shimenawa and shide, three stone lanterns, two
  original guardian sculptures, twelve trees, reusable leaf and hydrangea
  clusters, grass, flowers, moss, local fog, camera, and seven lights.
- Source: `SourceAssets/Models/Environment/Working/Japanese_Forest_Shrine_Original_CC0.blend`.
- Generator: `SourceAssets/Blender/scripts/create_japanese_forest_shrine.py`.
- Proof render: `docs/Assets/Previews/japanese-forest-shrine-original.png`.
- License: CC0 1.0 Universal. No third-party geometry, textures, scans, HDRIs,
  audio, or linked libraries.
- Known limitations: this is a compact original scene and art foundation, not a
  photogrammetry reconstruction or a claim of pixel-identical reproduction.

## 2026-07-29 - Authored distant skyline LOD set

- Asset ID: `architecture.distant-skyline`
- Purpose: replace the black exterior horizon around the complete hero route.
- Source reference: contemporary mixed-use, hotel, residential and office tower
  construction; original unbranded geometry, no external model inputs.
- Dimensions: five tower families, 66-112 m tall, arranged as a 150 m modular
  cluster and instanced as five skyline groups in Three.js.
- LODs: near, middle and far GLBs generated from the editable Blender source.
- Materials: concrete, stone, metal, dark glazing, deterministic warm/cool/dark
  interior variation, and restrained aviation-light emission.
- Construction: podiums, two-stage setbacks, recessed facade ribbons,
  vertical fins/mullions, crowns, rooftop mechanical units and antennas.
- Export: evaluated bevels, stable asset IDs/extras, Y-up GLB, static geometry
  batched by material for browser draw-call control.
- Runtime outputs:
  `public/assets/production/architecture/distant-skyline-lod0.glb`,
  `distant-skyline-lod1.glb`, and `distant-skyline-lod2.glb`.
- Export automation: `scripts/assets/export_production_skyline.py`.
- Known limitations: no close interior rooms; intended for distant skyline use.

## production.hero-district.v1

- Purpose: replace the visible boulevard, market, headquarters exterior, flat windows,
  raw building boxes, primitive stalls, and sparse street furnishing.
- Source references: Los-Angeles-inspired contemporary construction language; project
  layout/collision coordinates; CC0 Poly Haven material sources in the asset manifest.
- Dimensions: approximately 96 × 160 × 64 m authored in game-space metres.
- Geometry: 1,399 editable source meshes are evaluated and material-batched into 23 runtime
  meshes / 277,736 triangles / 23 material slots. Current per-export counts are generated by
  `npm run inspect:production-assets`.
- Texture sets: runtime asphalt, pavement, concrete, stone, and wood PBR overrides; authored
  metal, glass, plaster, brick, emissive, rubber, and vegetation-support materials.
- Rig/animations: static architecture; gameplay owns doors, traffic, NPCs, and vegetation.
- Export: binary glTF 2.0, Y-up, applied modifiers, material export, custom extras, no
  external texture URI.
- Runtime output: `public/assets/production/architecture/hero-district.glb`.
- Known limitations: no baked high-to-low normal set or embedded LOD hierarchy yet.

## production.hq-lobby.v1

- Purpose: physically constructed lobby shell and furnishing.
- Dimensions: approximately 28 × 32 × 9 m.
- Contents: floor/wall/ceiling envelope, ceiling grid and fixtures, layered reception desk,
  workstation props, visitor seating, security gates, directory, elevator bank, plants.
- Rig/animations: static; automatic doors and elevator remain gameplay-owned.
- Export: binary glTF 2.0 with stable asset IDs and project license extras.
- Runtime output: `public/assets/production/interiors/hq-lobby.glb`.
- Known limitations: receptionist character is a separate current-generation humanoid
  foundation and does not yet meet facial/LOD acceptance.

## production.floor45.v1

- Purpose: replace primitive Mission Control office surfaces.
- Dimensions: approximately 30 × 34 × 9 m, positioned at the existing 180 m gameplay floor.
- Contents: curtain wall, mullions, six work bays, desks, monitors, partitions, ceiling,
  lights, and structural finish.
- Rig/animations: static; live Service Android and truthful state displays remain separate.
- Runtime output: `public/assets/production/interiors/floor45.glb`.
- Known limitations: additional close-range workstation prop detail and baked LODs remain.

## production.automatic-door-leaf.v1

- Purpose: replace visible procedural exterior, car, and Floor 45 door leaves without
  changing tested transforms or collision.
- Dimensions: 3.35 × 4.1 × 0.14 m.
- Contents: glazing, metal stiles, top/bottom rails, handle.
- Runtime output: `public/assets/production/props/automatic-door-leaf.glb`.
- Known limitations: one scalable leaf family is reused across openings.

## production.elevator-static.v1

- Purpose: replace the procedural elevator portal, exposed shaft cue, guide system, and
  cyan torus treatment while preserving the existing elevator state machine.
- Dimensions: full lobby-to-Floor-45 travel volume at the existing gameplay coordinates.
- Geometry: 35 meshes / 6,500 triangles / 4 material slots.
- Contents: fire-rated shaft enclosure, guide rails, structural ribs, entrance portal,
  layered cladding, transom, reveal, call station, and restrained practical emitters.
- Rig/animations: static Blender structure; gameplay owns cabin travel, doors, and indicators.
- Runtime output: `public/assets/production/interiors/elevator-static.glb`.
- Known limitations: no embedded LOD hierarchy; portal indicator text remains runtime UI.

## production.elevator-car.v1

- Purpose: replace the visible BoxGeometry cabin while retaining tested player transport.
- Dimensions: approximately 3.8 × 2.8 × 2.6 m at real-world game scale.
- Geometry: 18 meshes / 3,064 triangles / 7 material slots.
- Contents: layered wall and floor construction, segmented panels, mirror band, handrails,
  ceiling, narrow practical light, control panel, buttons, and kick plates.
- Rig/animations: the authored cabin is a stable transform root moved by the existing
  elevator logic; automatic door leaves remain separately animated runtime assets.
- Runtime output: `public/assets/production/interiors/elevator-car.glb`.
- Known limitations: no embedded LOD hierarchy and no baked texture set.

## production.vehicle families v1

- Assets: premium sedan, SUV/crossover, compact city car, delivery van.
- Purpose: replace visible toy-car meshes with original unbranded contemporary silhouettes.
- Dimensions: real-scale widths 1.78–2.04 m, lengths 3.92–5.35 m, heights 1.43–2.34 m.
- Contents: authored body panels, cabin glazing, hood, roof, beltlines, A/C pillars,
  windshield headers, rockers, mirrors, handles, grille, bumpers, lamps, seats, steering
  silhouette, tires, and hubs.
- Geometry: 38 editable meshes / 8,488 triangles / 7 material slots per family,
  exported as 6 static material batches plus 8 animated wheel/hub nodes (14 runtime meshes).
- Rig/animations: stable named wheel nodes; Three.js rotates wheels from travelled distance.
- Materials: automotive paint, clear glass, rubber, chrome, black metal, lamp emissive.
- Runtime outputs: `public/assets/production/vehicles/*.glb`.
- Known limitations: no authored steering pivot, suspension rig, texture-baked wear set, or
  explicit LOD meshes yet.

## Pipeline

The official Blender Foundation MCP add-on at `127.0.0.1:9876` executes the checked-in
`scripts/assets/build_production_pass_02.py` through
`scripts/assets/blender_mcp_client.py`. The script creates a new editable `.blend` and never
overwrites the existing meadow source. Axis conversion is stored as an editable collection
root so the Blender viewport and exported Three.js scene are both upright. The editable
source is tracked at
`SourceAssets/Models/Environment/Working/Shenzhen_City_Production_Pass_02.blend`; the
`scripts/assets/build_production_elevator.py` and `scripts/assets/patch_production_plaza.py`
passes are saved into that same source file. `scripts/assets/optimize_production_glbs.py`
evaluates modifiers and joins compatible static source meshes by material into temporary
runtime batches, exports them, and removes the batches without flattening the editable source.
`scripts/assets/optimize_production_vehicles.py` applies the same strategy to vehicle bodies
while preserving four wheel pivots and their four hub children for runtime rotation.
