# Shenron City - Curated Asset Library
# GitHub-publishable, license-safe free assets for a GTA-style Three.js city game

## Directory Structure

```
SourceAssets/PublicLibrary/
├── Characters/           # Humanoid characters (154 models, ~6 GB)
│   ├── Humans_Modern/    # Realistic modern humans (pedestrians, NPCs)
│   ├── Humans_Fantasy/   # Fantasy, sci-fi, historical characters
│   ├── Creatures/        # Non-human creatures, monsters, aliens
│   ├── Heads_Busts/      # Head/bust sculpts, body parts, masks
│   ├── Base_Meshes/      # Base meshes, mannequins, reference models
│   ├── Rigged_Pro/       # Professional photogrammetry (Renderpeople)
│   ├── Sketchfab/        # Original Sketchfab downloads
│   ├── Mixamo/           # Original Mixamo downloads
│   └── Renderpeople/     # Original Renderpeople downloads
├── Vehicles/             # Cars, trucks, motorcycles, spacecraft (~64 models)
│   ├── Kenney_CarKit/    # 35 GLB vehicles (CC0)
│   ├── Quaternius_Cars/  # 7 FBX vehicles (CC0)
│   └── RGS_Vehicles/     # 18 FBX vehicles (CC0)
├── Buildings/            # Architecture, roads, urban kit
│   ├── Kenney_BuildingKit/  # 79 GLB building components (CC0)
│   ├── Kenney_UrbanKit/     # 124 GLB urban assets (CC0)
│   └── Kenney_RoadKit/      # 72 GLB road pieces (CC0)
├── Props/                # Furniture, weapons, miscellaneous
│   ├── Kenney_FurnitureKit/ # 140 GLB furniture items (CC0)
│   └── Kenney_WeaponsKit/   # 40 GLB blasters/grenades (CC0)
├── Nature/               # Trees, rocks, plants, terrain
│   └── Kenney_NatureKit/    # 329 GLB nature assets (CC0)
├── VFX/                  # Particles, effects
│   └── Kenney_ParticlePack/ # 160 PNG particle sprites (CC0)
└── UI/                   # GUI elements, input prompts
    ├── Kenney_InputPrompts/ # 4,667 UI icons (PNG/SVG)
    └── game-icons/          # 4,239 game icon SVGs
```

## Asset Sources & Licenses

| Source | License | Assets |
|--------|---------|--------|
| Kenney (kenney.nl) | CC0 1.0 Universal | Building Kit, Nature Kit, Urban Kit, Road Kit, Car Kit, Furniture Kit, Weapons Kit, Particle Pack, Space Kit |
| Quaternius (quaternius.com) | CC0 | Cars Pack |
| RGS_Dev | CC0 | Low Poly Vehicles Pack |
| Sketchfab CC-BY | CC Attribution 4.0 | 34 character models |
| Mixamo (Adobe) | Mixamo License | 108 rigged character FBX files |
| Renderpeople | Renderpeople License | 12 photogrammetry character packs |
| game-icons.net | CC BY 3.0 | 4,239 game icons |

## Total Stats

- **80,000+ files**
- **~17 GB on disk**
- **All assets are free and GitHub-publishable**
- **No proprietary or restricted content**

## Usage

All GLB files can be loaded directly with Three.js:
```javascript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
const loader = new GLTFLoader();
loader.load('path/to/model.glb', (gltf) => scene.add(gltf.scene));
```

FBX files need conversion to GLB via Blender or fbx2gltf.
