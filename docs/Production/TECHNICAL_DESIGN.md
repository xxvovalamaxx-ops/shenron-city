# Shenzhen City — Technical Design

## Architecture
- **Renderer**: Three.js via React Three Fiber
- **State**: Zustand stores (game state, HUD, settings)
- **Collision**: Custom swept capsule-vs-AABB controller as the single authority
- **Pedestrians**: deterministic route sampling shared by skinned rendering and collision
- **Audio**: Web Audio API, fully procedural (no audio files)
- **Build**: Vite with code-splitting (postprocessing, trees lazy-loaded)

## Data-Driven Design
Building layout, city district, collision boxes, routes, and audio zones all derive from shared data modules (`city-data.ts`, `layout.ts`, `palette.ts`). Moving a wall automatically moves its collider.

## Performance Strategy
- Instanced meshes for repeated static geometry; skeleton-safe clones for animated characters
- Lazy-loaded postprocessing and detail trees
- Throttled HUD updates (10Hz)
- Renderer-free City Tour bearing and distance, quantized into the HUD mirror
- Quality presets (low/medium/high) control shadows, postprocessing, DPR
- Single-scene (no world streaming needed for vertical slice)

## Collision System
Custom capsule-vs-AABB with swept horizontal movement, substep prevention (0.07m), step-up for kerbs, gravity, head clearance. Runs at 60fps with zero allocations per frame.

Street props, plaza fixtures, building shells, office glass, vehicles,
pedestrians, doors, and elevator guards derive their collision from the same
renderer-free records or frame-exact samplers as their visible geometry.

Imported building, vegetation, and vehicle GLBs are normalized into those
authored bounds instead of supplying an independent collision source. The
Kenney citizen GLB is converted reproducibly in Blender and is pinned together
with its six local skins by `npm run verify:assets`.

Kai uses a reproducible Quaternius Blender export. The clothed Male Ranger and
both reviewed Universal Animation Library Standard packs share the same
65-joint hierarchy by count, name, and order. The runtime selects 29 useful
motions from the tracked 86-clip CC0 catalog; the verifier reads the GLB binary
and proves each clip contains changing transform samples rather than trusting
animation names or channel counts.

## Audio System
5-zone ambience (boulevard, market, park, lobby, HQ) with constant-power crossfade. All procedural — noise generation, impulse reverb synthesis, no audio file downloads.
