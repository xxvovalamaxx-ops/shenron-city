# Shenron City — Technical Design

## Architecture
- **Renderer**: Three.js via React Three Fiber
- **State**: Zustand stores (game state, HUD, settings)
- **Physics**: Custom AABB collision + Rapier for static world colliders
- **Pedestrians**: deterministic authored route sampling shared by rendering and collision
- **Audio**: Web Audio API, fully procedural (no audio files)
- **Build**: Vite with code-splitting (postprocessing, trees lazy-loaded)

## Data-Driven Design
Building layout, city district, collision boxes, routes, and audio zones all derive from shared data modules (`city-data.ts`, `layout.ts`, `palette.ts`). Moving a wall automatically moves its collider.

## Performance Strategy
- Instanced meshes for repeated geometry (traffic, trees, lights, windows, NPCs)
- Lazy-loaded postprocessing and detail trees
- Throttled HUD updates (10Hz)
- Quality presets (low/medium/high) control shadows, postprocessing, DPR
- Single-scene (no world streaming needed for vertical slice)

## Collision System
Custom capsule-vs-AABB with swept horizontal movement, substep prevention (0.07m), step-up for kerbs, gravity, head clearance. Runs at 60fps with zero allocations per frame.

## Audio System
5-zone ambience (boulevard, market, park, lobby, HQ) with constant-power crossfade. All procedural — noise generation, impulse reverb synthesis, no audio file downloads.
