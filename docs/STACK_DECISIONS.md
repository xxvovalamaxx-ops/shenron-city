# Shenron City — stack decisions

Every candidate from the build plan, with a verdict and the reason. Versions
were read from the npm registry on 2026-07-27 and checked against each
package's declared peer ranges, not guessed.

**Rule applied throughout:** a dependency earns its place by solving a problem
this build actually has. "We will need it later" is a reason to defer, not to
install.

## Verified compatibility

`@react-three/fiber@9.6.1` declares `react: ">=19 <19.3"`. A `^19.2.8` range
would allow 19.3 and silently break that contract, so React is pinned
`~19.2.8`. `drei@10.7.7` and `@react-three/postprocessing@3.0.4` both require
`@react-three/fiber@^9`, satisfied. `three@0.185.1` clears every declared floor
(`>=0.156`).

TypeScript is pinned to `~5.9.3`. 7.0.2 (the native port) is published, but
betting a new build's whole toolchain on a rewritten compiler buys nothing here.

## Adopted

| Package | Version | Why |
|---|---|---|
| `vite` | 8.1.5 | Build + dev server. Already the tool the rest of the repo uses. |
| `three` | 0.185.1 | The renderer. |
| `@react-three/fiber` | 9.6.1 | React reconciler for three. Lets the world be composed the way the rest of the codebase is. |
| `@react-three/drei` | 10.7.7 | `PointerLockControls` and `useProgress`. In-world text moved to local canvas textures so no font CDN is needed. |
| `@react-three/postprocessing` | 3.0.4 | Bloom, vignette, SMAA. 34 more effects available (AO, DOF, GodRays, etc). Off at the `low` preset. |
| `@dgreenheck/ez-tree` | 1.1.0 | Procedural trees with real bark/leaf textures. Used for plaza landscaping. |
| `@react-three/rapier` | 2.2.0 | Physics: rigid bodies, colliders, character controller, joints, sensors, collision events. Replaces custom AABB collision. |
| `recast-navigation` | 0.43.1 | NavMesh generation + Detour pathfinding for NPCs. |
| `@recast-navigation/three` | 0.43.1 | Three.js integration for recast: mesh-to-navmesh, debug visualization. |
| `yuka` | 0.7.8 | Game AI: FSM, steering behaviors, goal management, perception, trigger zones. |
| `three-mesh-bvh` | 0.9.13 | Fast raycasting and spatial queries (3.4M weekly downloads). |
| `three.quarks` | 0.17.1 | Particle system: fire, smoke, sparks, explosions. |
| `quarks.r3f` | 0.17.1 | React Three Fiber wrapper for three.quarks. |
| `@gltf-transform/core` | 4.4.2 | GLB/GLTF optimization, compression, Draco/Meshopt encoding. |
| `@gltf-transform/cli` | 4.4.2 | CLI: `gltf-transform optimize input.glb output.glb`. |
| `koota` | 0.6.6 | ECS: entities, traits, relations, queries. Framework-agnostic. |
| `react` / `react-dom` | ~19.2.8 | Pinned below 19.3 per R3F's peer range. |
| `zustand` | 5.0.14 | Standalone scenario state and the HUD mirror. Chosen over context to keep frame-rate updates out of React's render path. |
| `zod` | 4.4.3 | Retained for quarantined, pure future adapter schemas and their tests; it is tree-shaken from the active standalone path. |
| `vitest` | 4.1.10 | 76 tests over the City Tour, simulation, city data, ambient routes, dialogue, contracts, HUD mirroring, and the standalone boundary. |
| `typescript` | ~5.9.3 | Strict, `noUnusedLocals`, `noUncheckedSideEffectImports`. |

## Previously deferred — now installed

These were originally deferred because the vertical slice didn't need them yet.
They are now installed and ready for integration as the game grows.

| Package | Was deferred because | Now installed because |
|---|---|---|
| `@react-three/rapier` | No dynamic bodies; static AABBs were sufficient. | Adding NPCs, vehicles, props, ragdolls. Real physics needed. |
| `recast-navigation` + `@recast-navigation/three` | Four validated walking loops didn't need navmesh. | NPCs will choose destinations and avoid dynamic obstacles. |
| `yuka` | One state machine didn't justify a runtime. | Multiple NPC AI behaviors, steering, perception needed. |
| `three-mesh-bvh` | Simple AABB boxes didn't need BVH. | GLB environments with real triangle counts coming. |
| `three.quarks` + `quarks.r3f` | No particle effects in the slice. | Neon glow, steam vents, sparks, rain effects planned. |
| `@gltf-transform/core` + `cli` | No assets to optimize. | First real GLB assets arriving; compression needed. |
| `koota` | One app, no ECS complexity needed. | Game state growing; ECS pattern needed at scale. |

## Still deferred

| Package | Why not yet | Adopt when |
|---|---|---|
| `ecctrl` | Character controller built on rapier. Inherits that decision. | With rapier integration. |
| `xstate` | One state machine does not pay for a statechart runtime. | Three or more interacting machines. |
| `theatre` | Authored cinematic sequencing. Nothing is authored yet. | Cutscenes, scripted camera moves. |
| `uikit` | In-world React UI in WebGL. `WorldText` covers current needs. | Interactive in-world panels — lift buttons in 3D, screens with controls. |
| `gltfjsx` | Asset pipeline tooling. Will use when importing models. | When importing real GLB models. |
| `git-lfs` | Repo has no binaries yet. | With the first GLB/texture/audio. |
| `turborepo`, `pnpm` | One app. No cross-package orchestration needed. | A second deployable lands. |
| `playwright` | E2E against WebGL is flaky in CI. | GPU-enabled CI runner or DOM-level UI. |
| `opentelemetry-js`, `sentry` | Nothing is deployed. Local-only. | First non-local deployment. |
| `modelcontextprotocol/typescript-sdk` | No tool or backend connection in standalone game. | Behind a separately reviewed server adapter. |
| `tauri` | No desktop or native bridge by design. | Approved desktop phase after game is stable. |

## Rejected

| Package | Why |
|---|---|
| `socket.io` | No network transport. Future multiplayer evaluated separately. |
| `vercel/ai` | No model connection. Provider access belongs on server, not browser. |
| `react-three-next` | Next.js starter. Wrong framework. |

## What this leaves

Twenty runtime dependencies and six dev dependencies. Packages are installed
and ready but integration is incremental — each is wired in when the feature
that needs it is built, not all at once.

## Integration roadmap

1. ✅ Trees (`@dgreenheck/ez-tree`) — plaza landscaping done
2. 🔲 `@react-three/rapier` — replace custom collision with real physics
3. 🔲 `@react-three/postprocessing` extras — N8AO, GodRays, ChromaticAberration
4. 🔲 `recast-navigation` — NPC navmesh generation and pathfinding
5. 🔲 `yuka` — NPC AI state machines, steering, perception
6. 🔲 `three.quarks` + `quarks.r3f` — particle effects (neon, steam, sparks)
7. 🔲 `three-mesh-bvh` — fast raycasting for interaction and line-of-sight
8. 🔲 `@gltf-transform` — compress imported GLB assets
9. 🔲 `koota` — ECS for game state at scale
