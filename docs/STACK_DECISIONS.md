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
| `@react-three/postprocessing` | 3.0.4 | Bloom and vignette carry most of the "cinematic" read at near-zero authoring cost. Off at the `low` preset. |
| `react` / `react-dom` | ~19.2.8 | Pinned below 19.3 per R3F's peer range. |
| `zustand` | 5.0.14 | Standalone scenario state and the HUD mirror. Chosen over context to keep frame-rate updates out of React's render path. |
| `zod` | 4.4.3 | Retained for quarantined, pure future adapter schemas and their tests; it is tree-shaken from the active standalone path. |
| `vitest` | 4.1.10 | 64 tests over simulation, contracts, HUD mirroring, and the standalone boundary. |
| `typescript` | ~5.9.3 | Strict, `noUnusedLocals`, `noUncheckedSideEffectImports`. |

## Deferred

| Package | Why not yet | Adopt when |
|---|---|---|
| `@react-three/rapier` | The slice has **no dynamic bodies**. Every collider is a static box and the one moving platform is the lift, which a physics solver makes *harder* (carrying a character on a kinematic platform is fiddly; explicit carry is four lines). A deterministic sweep is also unit-testable without a renderer — 17 collision tests exist because there is no WASM solver in the way. | Props, ragdolls, thrown objects, or anything that needs real dynamics. |
| `ecctrl` | Character controller built on rapier. Inherits that decision. | With rapier. |
| `three-mesh-bvh` | Accelerates raycasts against dense meshes. The scene is ~120 boxes; a linear sweep is faster than building a BVH. | Loaded GLB environments with real triangle counts. |
| `recast-navigation-js` | Navmesh + crowd pathfinding. Nothing in the slice walks — the secretary is stationary and agents are represented as fixed presences. | NPCs that move between rooms. |
| `xstate` | One state machine does not pay for a statechart runtime. `gameplay/elevator.ts` is a 5-phase total reducer with 10 tests asserting the impossible states cannot occur. | Three or more interacting machines. |
| `theatre` | Authored cinematic sequencing. Nothing is authored yet. | Cutscenes, scripted camera moves. |
| `uikit` | In-world React UI in WebGL. The local `WorldText` canvas component covers current monitors and signage. | Interactive in-world panels — lift buttons you actually click in 3D, resident screens with controls. |
| `gltfjsx`, `glTF-Transform` | Asset pipeline tooling. **There are no assets** — the entire building is procedural geometry. Installing a pipeline before any art exists is ceremony. | The first real GLB. That is also when Git LFS starts mattering. |
| `git-lfs` | See above. Repo has no binaries. | With the first GLB/texture/audio. |
| `turborepo`, `pnpm` | One app. A monorepo toolchain solves cross-package task orchestration, and there is nothing to orchestrate. The layered boundaries the plan actually cares about are enforced by directory + import discipline today. | A second deployable (desktop shell, adapter service) lands. |
| `playwright` | E2E against WebGL. Headless GPU is unreliable in CI, and the deterministic logic is already covered by 64 automated tests. Adding a flaky browser job would make CI less trustworthy, not more. | A stable GPU-enabled runner, or when there is DOM-level UI worth driving. |
| `opentelemetry-js`, `sentry` | Nothing is deployed. Local-only, one user. | First non-local deployment. |
| `modelcontextprotocol/typescript-sdk` | The standalone game has no tool or backend connection. Browser-side MCP would violate the current boundary. | Only behind a separately reviewed server adapter; probably never in the browser. |
| `tauri` | The current build intentionally has no desktop or native bridge. | A separately approved, allowlisted desktop phase after the game is stable. |

## Rejected

| Package | Why |
|---|---|
| `socket.io` | The current game has no network transport. Adding one now would create integration before gameplay needs it. Future multiplayer and Mission Control traffic must be evaluated separately. |
| `vercel/ai` | The current game has no model connection. Provider access never belongs in the browser bundle; a future AI feature requires a separately approved server boundary. |
| `react-three-next` | Next.js starter. Wrong framework for this app, and the plan itself flags its staleness. |

## What this leaves

Nine runtime dependencies and six dev dependencies. The current production
JavaScript is approximately **1.30 MB raw / 388 kB gzipped**. It is primarily
Three.js, React, and rendering helpers. Code-splitting is deferred until the
first gameplay/art direction is fixed.
