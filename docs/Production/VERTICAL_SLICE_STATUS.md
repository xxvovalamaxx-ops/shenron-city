# Shenzhen City — Vertical Slice Status

## Route Checklist
- [x] Start in exterior city area
- [x] Walk Dragon Boulevard
- [x] Pass traffic, pedestrians, small businesses
- [x] Visit Night Market (4 stalls)
- [x] Visit Dragon Pocket Park
- [x] Reach headquarters exterior
- [x] Automatic doors open
- [x] Enter cinematic lobby
- [x] Speak with AI secretary (Iris)
- [x] Enter elevator
- [x] Travel to Floor 45
- [x] Inspect agent offices
- [x] Return to city (elevator back down)

## Content Verification
- [x] One authored exterior district replacing the previous visible building and road shells
- [x] One hero boulevard
- [x] One market lane
- [x] Six distinct market configurations (ramen, tea, flowers, books, craft, bakery)
- [x] One green space
- [x] Headquarters exterior
- [x] Headquarters lobby
- [x] Working elevator (2 floors)
- [x] Authored Floor 45 shell and work bays
- [x] Player character and camera
- [x] Quality-scaled CC0 skinned pedestrians with deterministic route motion (5 / 11 / 18)
- [x] Light traffic (5-8 vehicles) with four original unbranded vehicle families
- [x] Three named NPCs (Iris, Mira, Kai)
- [x] Deterministic named-NPC dialogue
- [x] Doors (automatic sliding)
- [x] Spatial audio (5 zones)
- [x] Save/reload
- [x] City Tour objective compass and distance
- [x] Postprocessing (restrained Bloom, vignette, SMAA, filmic tone mapping)
- [x] Curated CC0 PBR texture pass
- [x] Audited CC0 vegetation and animated-citizen imports
- [x] Original Blender architecture, lobby, elevator, Floor 45, door, and vehicle exports
- [x] Reproducible Blender citizen conversion with pinned runtime hashes
- [x] CC0 65-joint Quaternius hero with 29 verified city and interaction motions
- [x] Authored modular street props, facade layers, and shallow storefront interiors
- [x] District minimap with player heading and objective marker
- [x] Calibrated night exposure across exterior, lobby, and Floor 45
- [x] Production manifest and visible-placeholder audit in `npm run check`
- [x] Twelve fixed visual-regression cameras captured in Chromium
- [x] Authored distant skyline ring with three runtime LOD levels

## Remaining Work
- [ ] Realistic hero and pedestrian characters that pass conversation-distance inspection
- [ ] Embedded LOD hierarchy for every production GLB
- [ ] Stable 60 FPS / 45 FPS 1%-low performance gate at 2560 x 1080
- [ ] Complete route recording with measured stereo loudness and true peak
- [ ] Apply the reviewed hero-motion vocabulary to additional gameplay roles
- [ ] Fully enterable shop interiors
