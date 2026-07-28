# Shenron City — Three.js Game-Dev Stack

All packages researched, installed, and verified with `three ^0.185.1` + `@react-three/fiber ^9.6.1`.

## Installed & Ready

| Package | Version | Status | What It Does |
|---------|---------|--------|--------------|
| `three` | ^0.185.1 | ✅ active | 3D renderer foundation |
| `@react-three/fiber` | ^9.6.1 | ✅ active | React renderer for Three.js |
| `@react-three/drei` | ^10.7.7 | ✅ active | R3F helpers (controls, loaders, etc.) |
| `@react-three/postprocessing` | ^3.0.4 | ✅ active | Bloom, Vignette, SMAA already wired |
| `@dgreenheck/ez-tree` | ^1.1.0 | ⚠️ active, lazy | Detailed planter trees. **~3.9 MB** — it inlines bark and leaf textures as base64 in one line of JS, more than three.js itself. Loaded as a separate chunk on medium/high only; `PlanterTree` covers low. Never import it statically. |
| `@react-three/rapier` | ^2.2.0 | 🔲 ready | Physics: rigid bodies, colliders, character controller, joints, sensors |
| `recast-navigation` | ^0.43.1 | 🔲 ready | NavMesh generation + pathfinding |
| `@recast-navigation/three` | ^0.43.1 | 🔲 ready | Three.js helpers for recast |
| `yuka` | ^0.7.8 | 🔲 ready | NPC AI: FSM, steering, goals, perception, trigger zones |
| `three-mesh-bvh` | ^0.9.13 | 🔲 ready | Fast raycasting, spatial queries (3.4M weekly downloads) |
| `three.quarks` | ^0.17.1 | 🔲 ready | Particle system: fire, smoke, sparks, explosions |
| `quarks.r3f` | ^0.17.1 | 🔲 ready | React Three Fiber wrapper for quarks |
| `@gltf-transform/core` | ^4.4.2 | 🔲 ready | GLB/GLTF optimization, compression, Draco/Meshopt |
| `@gltf-transform/cli` | ^4.4.2 | 🔲 ready | CLI: `gltf-transform optimize input.glb output.glb` |
| `koota` | ^0.6.6 | 🔲 ready | ECS: entities, traits, relations, queries |
| `zustand` | ^5.0.14 | ✅ active | State management |

## GitHub-Only (no npm)

| Repo | Purpose | Status |
|------|---------|--------|
| ZyFou/ProceduralTerrains | Procedural terrain, infinite chunks | Clone to use |
| SkyeShark/SeedThree | WebGPU tree generator with wind | Clone to use (WebGPU only) |

## Integration Priority

1. ✅ Trees (ez-tree) — done
2. 🔲 **rapier** — replace custom collision with real physics
3. 🔲 **postprocessing extras** — add N8AO, GodRays, ChromaticAberration
4. 🔲 **recast-navigation** — NPC pathfinding on navmesh
5. 🔲 **yuka** — NPC AI state machines + steering
6. 🔲 **three.quarks** — particle effects (neon glow, steam, sparks)
7. 🔲 **three-mesh-bvh** — fast raycasting for interaction, line-of-sight
8. 🔲 **gltf-transform** — compress imported GLB assets
9. 🔲 **koota** — ECS for game state at scale
