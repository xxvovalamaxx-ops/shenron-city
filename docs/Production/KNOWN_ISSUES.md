# Shenron City — Known Issues

## Current
- Storefronts are solid boxes (not enterable interiors)
- No character locomotion animations (procedural sway only)
- No packaged executable (build works, no wrapper)
- Entry bundle 3.5MB gzipped (large due to Three.js + R3F)
- Tree chunk 4MB (ez-tree library, lazy-loaded)
- No minimap or compass
- No weather system
- Only 2 elevator floors (Lobby + Floor 45)

## Deferred
- GLB models from external sources (currently all procedural)
- PBR textures (currently flat colors)
- Skeletal character animations
- Enterable building interiors
- Particle effects (rain, fog, neon glow)
- Audio volume UI (API exists, slider added)
