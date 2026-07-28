# Shenzhen City — Three.js stack

The package lock is the authority. A package is documented as installed only
when it is actually present in `package.json`.

## Active runtime

| Package | Purpose |
|---|---|
| `react`, `react-dom` | Application and DOM overlays |
| `three` | WebGL renderer |
| `@react-three/fiber` | React scene graph |
| `@react-three/drei` | Pointer-lock controls and loading helpers |
| `@react-three/postprocessing` | Lazy high/medium visual effects |
| `@dgreenheck/ez-tree` | Lazy detailed plaza trees |
| `zustand` | Scenario and HUD state |
| `zod` | Validated standalone/future adapter schemas |

## Tooling

| Package | Purpose |
|---|---|
| `vite`, `@vitejs/plugin-react` | Development and production builds |
| `typescript` | Strict static checking |
| `vitest` | Renderer-free simulation and contract tests |

## Deferred, not installed

| Candidate | Adopt only when |
|---|---|
| `recast-navigation`, `@recast-navigation/three` | NPCs need generated navmesh paths instead of authored routes |
| `three-mesh-bvh` | Imported triangle meshes make raycasts measurable |
| `three.quarks`, `quarks.r3f` | A reviewed particle effect enters the hero route |
| `@gltf-transform/*` | The first provenance-approved GLB is imported and the current audit path is clean |
| `koota` | Profiling proves the current state model no longer scales |
| `@pixiv/three-vrm` | A third-person camera and licensed character are approved together |
| `yuka` | Crowd behavior needs steering beyond the current deterministic authored routes |
| `@react-three/rapier` | A real dynamic rigid-body feature cannot be expressed by the verified swept controller |

Do not install speculative foundations. Each addition needs a real feature,
bundle-cost evidence, a focused test, and a clean dependency audit.
