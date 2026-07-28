# Shenron City — Content Standards

## Naming Conventions
- `SM_` — Static Mesh (Three.js Group/Mesh)
- `M_` — Material (MeshStandardMaterial)
- `MI_` — Material Instance (cloned material with overrides)
- `T_` — Texture (CanvasTexture or loaded texture)
- `BP_` — Component (React component)
- `SFX_` — Sound effect (Web Audio node)
- `VFX_` — Visual effect (postprocessing pass)

## Asset Quality Gates
- No floating props (everything grounded or parented)
- No texture stretching (proper UV mapping)
- Consistent texel density within same material class
- No repetitive identical storefronts in hero areas
- All buildings have correct physical scale (3.5m per storey)
- Road markings aligned to road geometry
- Neon signs face the street, readable from walking distance

## Material Standards
- Roughness: 0.6-0.9 for non-metals
- Metalness: 0.0-0.3 for buildings, 0.8-1.0 for vehicles
- Emissive intensity: 0.5-2.0 for neon, 0.1-0.3 for window glow
- All materials use consistent color space (sRGB for diffuse, linear for roughness/metalness)
