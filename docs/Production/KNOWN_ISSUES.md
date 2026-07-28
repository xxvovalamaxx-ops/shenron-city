# Shenron City — Known Issues

## Current
- Storefront interiors are shallow procedural shells, not full enterable shops
- Ambient characters are stylized primitives without locomotion animation
- Browser build only by design; no native wrapper is planned for this phase
- Entry bundle remains large due to the renderer, physics, and AI runtimes
- Tree chunk 4MB (ez-tree library, lazy-loaded)
- No minimap or compass
- No weather system
- Only 2 elevator floors (Lobby + Floor 45)

## Deferred
- GLB models from external sources (currently all procedural)
- Skeletal character animations
- Enterable building interiors
- Particle effects (rain, fog, neon glow)
- Additional audio mixing controls beyond the existing master-volume slider
