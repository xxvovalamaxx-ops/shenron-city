# Shenron City — Known Issues

## Current
- Storefront interiors are shallow procedural shells, not full enterable shops
- Citizen art remains deliberately stylized; the current Kenney cast is skinned and animated but not photorealistic
- Citizen locomotion currently re-times the authored Run clip; a separately authored walk clip is still needed
- Kai has 29 reviewed Quaternius motions, but most are pipeline-ready rather than connected to gameplay state
- Browser build only by design; no native wrapper is planned for this phase
- Entry bundle remains large due to the renderer and detailed world
- Tree chunk 4MB (ez-tree library, lazy-loaded)
- No weather system
- Only 2 elevator floors (Lobby + Floor 45)

## Deferred
- Bespoke hero models beyond the reviewed CC0 GLB set
- Applying the reviewed Quaternius motion set to more named characters and activities
- Enterable building interiors
- Optional weather effects such as rain
- Additional audio mixing controls beyond the existing master-volume slider
