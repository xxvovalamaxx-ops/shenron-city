# AI Headquarters — stack decisions

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
| `@react-three/drei` | 10.7.7 | `Text`, `PointerLockControls`, `useProgress`. Used sparingly. |
| `@react-three/postprocessing` | 3.0.4 | Bloom and vignette carry most of the "cinematic" read at near-zero authoring cost. Off at the `low` preset. |
| `react` / `react-dom` | ~19.2.8 | Pinned below 19.3 per R3F's peer range. |
| `zustand` | 5.0.14 | Adapter state and the 10 Hz HUD mirror. Chosen over context to keep frame-rate updates out of React's render path. |
| `zod` | 4.4.3 | Runtime validation at the Mission Control boundary. The plan requires validated contracts; this is the enforcement. |
| `vitest` | 4.1.10 | 46 unit tests over the pure simulation logic. |
| `typescript` | ~5.9.3 | Strict, `noUnusedLocals`, `noUncheckedSideEffectImports`. |

## Deferred

| Package | Why not yet | Adopt when |
|---|---|---|
| `@react-three/rapier` | The slice has **no dynamic bodies**. Every collider is a static box and the one moving platform is the lift, which a physics solver makes *harder* (carrying a character on a kinematic platform is fiddly; explicit carry is four lines). A deterministic sweep is also unit-testable without a renderer — 17 collision tests exist because there is no WASM solver in the way. | Props, ragdolls, thrown objects, or anything that needs real dynamics. |
| `ecctrl` | Character controller built on rapier. Inherits that decision. | With rapier. |
| `three-mesh-bvh` | Accelerates raycasts against dense meshes. The scene is ~120 boxes; a linear sweep is faster than building a BVH. | Loaded GLB environments with real triangle counts. |
| `recast-navigation-js` | Navmesh + crowd pathfinding. Nothing in the slice walks — the secretary is stationary and agents are represented as fixed presences. | NPCs that move between rooms. |
| `xstate` | One state machine does not pay for a statechart runtime. `gameplay/elevator.ts` is a 5-phase total reducer with 8 tests asserting the impossible states cannot occur. | Three or more interacting machines. |
| `theatre` | Authored cinematic sequencing. Nothing is authored yet. | Cutscenes, scripted camera moves. |
| `uikit` | In-world React UI in WebGL. `drei/Text` covers the monitors and signage today. | Interactive in-world panels — lift buttons you actually click in 3D, agent screens with controls. |
| `gltfjsx`, `glTF-Transform` | Asset pipeline tooling. **There are no assets** — the entire building is procedural geometry. Installing a pipeline before any art exists is ceremony. | The first real GLB. That is also when Git LFS starts mattering. |
| `git-lfs` | See above. Repo has no binaries. | With the first GLB/texture/audio. |
| `turborepo`, `pnpm` | One app. A monorepo toolchain solves cross-package task orchestration, and there is nothing to orchestrate. The layered boundaries the plan actually cares about are enforced by directory + import discipline today. | A second deployable (desktop shell, adapter service) lands. |
| `playwright` | E2E against WebGL. Headless GPU is unreliable in CI, and the deterministic logic — the part worth regression-testing — is already covered by 46 unit tests. Adding a flaky browser job would make CI less trustworthy, not more. | A stable GPU-enabled runner, or when there is DOM-level UI worth driving. |
| `opentelemetry-js`, `sentry` | Nothing is deployed. Local-only, one user. | First non-local deployment. |
| `modelcontextprotocol/typescript-sdk` | Browser-side MCP is not how this connects. The game talks to the existing FastAPI backend, which already owns tool access. | If the game ever needs to call MCP servers directly — probably never; that belongs behind the backend. |

## Rejected

| Package | Why |
|---|---|
| `socket.io` | The plan says adopt "**only if** the existing system does not already provide an appropriate real-time transport." It does: `backend/server.py` exposes `@app.websocket("/ws")` backed by `Broadcaster`. The adapter consumes it. Adding a second transport would mean two event paths and two failure modes. |
| `vercel/ai` | Provider-neutral AI SDK, designed to run where the API key is. In a browser bundle that means **shipping a provider key to the client**, which the security boundary forbids outright. Model access, if enabled, routes through the backend that already owns credentials. |
| `tauri` | A second desktop stack. This repo already ships an Electron shell with an updater, an NSIS installer and a release channel. Introducing Tauri would mean maintaining two native wrappers to gain nothing the slice needs — the browser build reaches everything through the existing localhost API. Revisit only if Electron becomes the blocker. |
| `react-three-next` | Next.js starter. Wrong framework for this app, and the plan itself flags its staleness. |

## What this leaves

Nine runtime dependencies and six dev dependencies. Production bundle:
**1.48 MB raw / 449 kB gzipped**, which is essentially three.js plus the React
runtime — there is no meaningful fat to cut without dropping the renderer.
