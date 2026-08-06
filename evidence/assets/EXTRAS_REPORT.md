# Asset extras report (characters + vehicles)

Generated 2026-08-05. Metrics extracted from Blender 5.1 headless import reports (staging/assets/reports).

## Character skeleton compatibility

- **kenney-mini-characters** — `format/character-female-d.fbx`: 504 verts, 797 tris, 6 bones, skin weights: yes, 32 actions, morph targets: 0, dims 0.7672 x 0.4995 x 0.7755m
- **kenney-mini-characters** — `format/character-male-a.fbx`: 489 verts, 709 tris, 6 bones, skin weights: yes, 32 actions, morph targets: 0, dims 0.7672 x 0.34 x 0.6713m
- **kenney-mini-characters** — `format/character-male-d.fbx`: 466 verts, 711 tris, 6 bones, skin weights: yes, 32 actions, morph targets: 0, dims 0.7672 x 0.34 x 0.7218m
- **kenney-mini-characters** — `format/character-female-d.glb`: 1443 verts, 877 tris, 7 bones, skin weights: yes, 32 actions, morph targets: 0, dims 1.9021 x 2 x 2m
- **kenney-mini-characters** — `format/character-male-a.glb`: 1301 verts, 803 tris, 7 bones, skin weights: yes, 32 actions, morph targets: 0, dims 1.9021 x 2 x 2m
- **kenney-mini-characters** — `format/character-male-d.glb`: 1281 verts, 791 tris, 7 bones, skin weights: yes, 32 actions, morph targets: 0, dims 1.9021 x 2 x 2m
- **kenney-animated-characters-protagonists** — `Model/characterMedium.fbx`: 804 verts, 1604 tris, 58 bones, skin weights: yes, 0 actions, morph targets: 0, dims 3.6186 x 1.0481 x 3.7647m
- **kenney-animated-characters-retro** — `Model/characterMedium.fbx`: 804 verts, 1604 tris, 58 bones, skin weights: yes, 0 actions, morph targets: 0, dims 3.6186 x 1.0481 x 3.7647m
- **kenney-animated-characters-survivors** — `Model/characterMedium.fbx`: 804 verts, 1604 tris, 58 bones, skin weights: yes, 0 actions, morph targets: 0, dims 3.6186 x 1.0481 x 3.7647m

The three Kenney skinning variants (protagonists/retro/survivors) all import with **58 bones** — identical rig topology, so shared animation clips (idle/jump/run) are directly retargetable across the three skins.

## Unit-scale consistency (FBX vs GLB twins)

Kenney packs ship the same models in multiple formats. Measured max dimensions differ by format, indicating non-uniform export scale:

| asset | FBX max dim | OBJ max dim | GLB max dim | verdict |
|---|---|---|---|---|
| kenney-mini-characters/character-male-a | 0.71 m | - | 2.0 m | GLB twin is meter-scaled; FBX ~3.5x smaller (cm-intended) |
| kenney-animated-characters-protagonists/characterMedium | 3.76 m (T-pose span) | - | - | FBX likely cm-scaled (×0.01 needed); hip height ≈1.0 m in file |
| kenney-city-kit-commercial/building-a | 1.29 m | - | - | building pieces are relative modules; assemble then rescale to city grid |

Recommendation: prefer **GLB twins** for runtime (glTF is meter-exact and Web-ready). When FBX is required, import with `global_scale=0.01` and re-verify against a 1.8 m reference character.

## Character facial / morph report

No character candidate has morph targets/shape keys. Facial animation is not available from the eligible library; rely on head-bone animation or add CC0 blendshape assets later.

## Character walk/idle tests

Filmstrip renders (6 frames each) at `evidence/assets/previews/<id>/` for the protagonist rig: `idle_01..06.png`, `run_01..06.png`, `jump_01..06.png`. Durations from import: idle 1.333s, run 0.667s, jump 0.5s at 24 fps. Root-motion: none detected (in-place clips) — locomotion will need code-driven root motion. All clips are binary FBX 7.4, 58 bones.

## Vehicle wheel-pivot report

- **kenney-car-kit** `race.fbx`: 1952 tris, dims 1.3 x 2.5598 x 0.7325m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.37
- **kenney-car-kit** `taxi.obj`: 2072 tris, dims 1.5 x 2.75 x 1.5m, collision proxies: 0, pivots (root offset from bbox center): 0.00, -0.03, -0.75
- **kenney-car-kit** `ambulance.fbx`: 2746 tris, dims 1.5 x 3.25 x 1.8m, collision proxies: 0, pivots (root offset from bbox center): 0.00, -0.03, -0.90
- **kenney-car-kit** `hatchback-sports.fbx`: 2088 tris, dims 1.3 x 2.85 x 1.1m, collision proxies: 0, pivots (root offset from bbox center): 0.00, -0.03, -0.55
- **kenney-car-kit** `tractor-shovel.fbx`: 2646 tris, dims 1.6606 x 2.4701 x 1.512m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.76
- **kenney-car-kit** `debris-bumper.obj`: 116 tris, dims 1.3 x 0.45 x 0.4m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.20
- **kenney-car-kit** `firetruck.obj`: 2767 tris, dims 1.5 x 3.4 x 1.7m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.85
- **kenney-car-kit** `kart-oozi.obj`: 2726 tris, dims 0.9743 x 1.4278 x 1.3291m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.11, -0.67
- **kenney-car-kit** `debris-plate-b.obj`: 44 tris, dims 0.9 x 0.9 x 0.2m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.10
- **kenney-car-kit** `wheel-dark.obj`: 332 tris, dims 0.4 x 0.6 x 0.6m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, 0.00
- **kenney-racing-kit** `roadSplitRound.obj`: 375 tris, dims 3 x 2 x 0.02m, collision proxies: 0, pivots (root offset from bbox center): 0.50, 1.00, -0.01
- **kenney-car-kit** `debris-door.fbx`: 68 tris, dims 0.188 x 0.8 x 0.9m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.45
- **kenney-car-kit** `debris-spoiler-a.fbx`: 48 tris, dims 1.1 x 0.2374 x 0.3m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.15
- **kenney-car-kit** `wheel-tractor-back.fbx`: 428 tris, dims 0.5376 x 0.8752 x 0.8752m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, 0.00
- **kenney-car-kit** `sedan.glb`: 2032 tris, dims 1.5 x 2.55 x 1.3m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.50
- **kenney-car-kit** `truck.glb`: 2082 tris, dims 1.5 x 2.95 x 1.3m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.50
- **kenney-racing-kit** `grass.obj`: 2 tris, dims 1 x 1 x 0m, collision proxies: 0, pivots (root offset from bbox center): 0.50, 0.50, 0.00
- **kenney-racing-kit** `radarEquipment.obj`: 292 tris, dims 0.5889 x 0.4131 x 0.5431m, collision proxies: 0, pivots (root offset from bbox center): 0.46, 0.41, -0.27
- **kenney-racing-kit** `roadSplitRound.glb`: 375 tris, dims 3 x 2 x 0.02m, collision proxies: 0, pivots (root offset from bbox center): -0.50, -1.00, -0.01
- **kenney-racing-kit** `roadCornerSmallBorder.obj`: 76 tris, dims 1.21 x 1.21 x 0.02m, collision proxies: 0, pivots (root offset from bbox center): 0.40, 0.60, -0.01
- **kenney-car-kit** `cone-flat.glb`: 172 tris, dims 0.4762 x 0.4762 x 0.281m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.14
- **kenney-car-kit** `debris-nut.glb`: 40 tris, dims 0.1732 x 0.2 x 0.1m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, -0.05
- **kenney-car-kit** `debris-tire.glb`: 288 tris, dims 0.35 x 0.6 x 0.6m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, 0.00
- **kenney-car-kit** `kart-ooli.glb`: 2706 tris, dims 0.9743 x 1.4278 x 1.3291m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.11, -0.67
- **kenney-car-kit** `wheel-tractor-dark-front.glb`: 332 tris, dims 0.3693 x 0.5386 x 0.5386m, collision proxies: 0, pivots (root offset from bbox center): 0.00, 0.00, 0.00
- **kenney-racing-kit** `bannerTowerGreen.obj`: 328 tris, dims 0.3852 x 0.3852 x 1.2457m, collision proxies: 0, pivots (root offset from bbox center): 0.19, 0.19, -0.62
- **kenney-racing-kit** `grass.glb`: 2 tris, dims 1 x 1 x 0m, collision proxies: 0, pivots (root offset from bbox center): -0.50, -0.50, 0.00
- **kenney-racing-kit** `radarEquipment.glb`: 292 tris, dims 0.5889 x 0.4131 x 0.5431m, collision proxies: 0, pivots (root offset from bbox center): -0.46, -0.41, -0.27
- **kenney-racing-kit** `roadCornerSmallBorder.glb`: 76 tris, dims 1.21 x 1.21 x 0.02m, collision proxies: 0, pivots (root offset from bbox center): -0.40, -0.60, -0.01
- **kenney-racing-kit** `bannerTowerGreen.glb`: 426 tris, dims 0.3852 x 0.3852 x 1.2457m, collision proxies: 0, pivots (root offset from bbox center): -0.19, -0.19, -0.62

Wheel pivots: Kenney car-kit wheels are separate named objects (e.g. `wheel-*`); axle location must be set at integration time. None of the eligible packs carry pre-rigged wheel transforms (no armatures in car-kit).

## Vehicle door hierarchy report

- **kenney-car-kit** `race.fbx`: 6 objects; door/window-named: none
- **kenney-car-kit** `taxi.obj`: 1 objects; door/window-named: none
- **kenney-car-kit** `ambulance.fbx`: 8 objects; door/window-named: none
- **kenney-car-kit** `hatchback-sports.fbx`: 6 objects; door/window-named: none
- **kenney-car-kit** `tractor-shovel.fbx`: 7 objects; door/window-named: none
- **kenney-car-kit** `debris-bumper.obj`: 1 objects; door/window-named: none
- **kenney-car-kit** `firetruck.obj`: 1 objects; door/window-named: none
- **kenney-car-kit** `kart-oozi.obj`: 1 objects; door/window-named: none
- **kenney-car-kit** `debris-plate-b.obj`: 1 objects; door/window-named: none
- **kenney-car-kit** `wheel-dark.obj`: 1 objects; door/window-named: none
- **kenney-racing-kit** `roadSplitRound.obj`: 1 objects; door/window-named: none
- **kenney-car-kit** `debris-door.fbx`: 1 objects; door/window-named: none
- **kenney-car-kit** `debris-spoiler-a.fbx`: 1 objects; door/window-named: none
- **kenney-car-kit** `wheel-tractor-back.fbx`: 1 objects; door/window-named: none
- **kenney-car-kit** `sedan.glb`: 5 objects; door/window-named: none
- **kenney-car-kit** `truck.glb`: 5 objects; door/window-named: none
- **kenney-racing-kit** `grass.obj`: 1 objects; door/window-named: none
- **kenney-racing-kit** `radarEquipment.obj`: 1 objects; door/window-named: none
- **kenney-racing-kit** `roadSplitRound.glb`: 1 objects; door/window-named: none
- **kenney-racing-kit** `roadCornerSmallBorder.obj`: 1 objects; door/window-named: none
- **kenney-car-kit** `cone-flat.glb`: 1 objects; door/window-named: none
- **kenney-car-kit** `debris-nut.glb`: 1 objects; door/window-named: none
- **kenney-car-kit** `debris-tire.glb`: 1 objects; door/window-named: none
- **kenney-car-kit** `kart-ooli.glb`: 6 objects; door/window-named: none
- **kenney-car-kit** `wheel-tractor-dark-front.glb`: 1 objects; door/window-named: none
- **kenney-racing-kit** `bannerTowerGreen.obj`: 1 objects; door/window-named: none
- **kenney-racing-kit** `grass.glb`: 1 objects; door/window-named: none
- **kenney-racing-kit** `radarEquipment.glb`: 1 objects; door/window-named: none
- **kenney-racing-kit** `roadCornerSmallBorder.glb`: 1 objects; door/window-named: none
- **kenney-racing-kit** `bannerTowerGreen.glb`: 1 objects; door/window-named: none

## Vehicle collision proxy report

Collision meshes: none of the eligible packs ship dedicated collision proxies (`collision`/`col_`/`physics` named objects: 0 across all sampled vehicle models). Runtime colliders must be generated (e.g. box/sphere approximations) or exported during conversion. Low triangle counts (<3k) make convex hull generation cheap.
