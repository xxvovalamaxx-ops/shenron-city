# Shenron City — Asset Pipeline Guide

How to get free assets into the game.

## Quick Start

1. Download assets from sources below
2. Place GLB files in `public/models/`
3. Place textures in `public/textures/`
4. Place HDRIs in `public/hdris/`
5. Optimize with glTF-Transform: `npx gltf-transform optimize input.glb output.glb --compress draco`

## Usage in Code

```tsx
import { GLBModel } from './GLBModel'

// Basic
<GLBModel src="/models/tree.glb" position={[0, 0, 5]} />

// With scale and rotation
<GLBModel
  src="/models/building.glb"
  position={[10, 0, -20]}
  scale={3}
  rotation={[0, Math.PI / 4, 0]}
/>

// Preload at module level
import { preloadGLB } from './GLBModel'
preloadGLB('/models/tree.glb')
```

## Top 5 Free Asset Sources

### 1. Poly Haven (polyhaven.com) — CC0
- **What**: 980 HDRIs, 780 PBR textures, 520 models
- **Best for**: Night/evening HDRIs, urban textures (concrete, metal, road)
- **Download**: Direct download, multiple resolutions
- **API**: `api.polyhaven.com` (keyless)

### 2. ambientCG (ambientcg.com) — CC0
- **What**: 2000+ PBR materials, HDRIs
- **Best for**: Cyberpunk surfaces — wet concrete, brushed metal, glass, neon
- **Download**: Direct download, up to 8K

### 3. Quaternius (quaternius.com) — CC0
- **What**: 1400+ low-poly 3D models (characters, props, environments)
- **Best for**: Quick prototyping, animated NPCs, modular building pieces
- **Download**: Direct GLB/GLTF download

### 4. Kenney (kenney.nl) — CC0
- **What**: 30,000+ game assets — models, UI, audio, textures
- **Best for**: Modular building kit, car kit, UI elements, sound effects
- **Download**: Direct download, zip bundles

### 5. Sketchfab CC0 (sketchfab.com) — Check licenses!
- **What**: Millions of 3D models
- **Best for**: Unique cyberpunk props, Japanese storefronts, sci-fi vehicles
- **Filter**: `?licenses=7c23a1ba438d4306920229c12afcb5f9` (CC0 only)
- **Download**: GLTF/GLB format available

## Bonus Sources

### Mixamo (mixamo.com) — Royalty-free
- **What**: 1000+ humanoid animations (walk, run, idle, combat)
- **Best for**: NPC walking animations, idle poses
- **Download**: FBX → convert to GLB via Blender

### Fab (fab.com) — Mixed licenses
- **What**: 60,000+ game assets, Megascans library
- **Best for**: High-quality sci-fi environments, monthly free giveaways

## Recommended Assets for Cyberpunk City

### Textures (from ambientCG)
- Wet concrete (roads, sidewalks)
- Brushed metal (building facades)
- Glass (windows, neon signs)
- Asphalt (boulevard)

### Models (from Quaternius + Kenney)
- Modular building kit (Kenney)
- Street props: benches, trash cans, signs
- Animated humanoid characters (Quaternius)
- Vehicle models

### HDRIs (from Poly Haven)
- Night city HDRI for ambient lighting
- Neon-lit alley HDRI for reflections

## Optimization Pipeline

```bash
# Install glTF-Transform CLI
npm install -g @gltf-transform/cli

# Optimize a GLB (compress, resize textures, remove unused data)
gltf-transform optimize input.glb output.glb --compress draco

# Resize textures to 2K
gltf-transform resize output.glb final.glb --width 2048 --height 2048

# Convert texture to WebP for smaller files
gltf-transform webp final.glb output.webp.glb --quality 85
```

## File Structure

```
public/
├── models/          # GLB/GLTF 3D models
│   ├── buildings/   # Building models
│   ├── props/       # Street furniture
│   ├── characters/  # NPC models
│   └── vehicles/    # Car models
├── textures/        # PBR texture maps
│   ├── diffuse/     # Color maps
│   ├── normal/      # Normal maps
│   ├── roughness/   # Roughness maps
│   └── metalness/   # Metalness maps
└── hdris/           # Environment maps
    └── night_city.hdr
```
