# Shenron City — stack decisions

## Rule

A dependency earns its place by solving a problem in the playable build.
Future usefulness is a reason to document a candidate, not to install it.

## Compatibility

`@react-three/fiber@9.6.1` supports React `>=19 <19.3`, so React stays on the
`~19.2.8` line. TypeScript stays on `~5.9.3` while the rewritten 7.x compiler
is unnecessary risk.

## Adopted

| Package | Decision |
|---|---|
| `vite` | Existing fast build and local server; HMR is disabled for the standalone boundary. |
| `three`, `@react-three/fiber` | Core renderer and scene composition. |
| `@react-three/drei` | Pointer lock and loading progress. Remote font helpers are not used. |
| `@react-three/postprocessing` | Lazy visual effects; disabled on low quality. |
| `@dgreenheck/ez-tree` | Lazy detailed landscaping with a procedural fallback. |
| `@react-three/rapier` | Fixed collider foundation for future physical props; player movement remains on the verified swept controller. |
| `yuka` | Local steering for ambient pedestrians; no model or network calls. |
| `zustand` | Keeps high-frequency simulation outside React while exposing a throttled HUD mirror. |
| `zod` | Validates schema and save boundaries; tree-shaken when unused. |
| `vitest`, `typescript` | Fast deterministic tests and strict type checking. |

## Removed in the repository-hygiene pass

| Package | Reason |
|---|---|
| `@pixiv/three-vrm` | The game is first-person and the 15 MB avatar plus animation set were not rendered. Reintroduce only with a third-person feature and verified license/provenance. |
| `@gltf-transform/core`, `@gltf-transform/cli` | No GLB is imported, and their unused toolchain introduced eight high-severity development advisories. |
| `playwright` | No repository test invoked it. Browser acceptance uses the external verification harness until a real in-repo E2E suite exists. |

## Deferred

`recast-navigation`, `three-mesh-bvh`, `three.quarks`, `koota`, `ecctrl`,
`xstate`, `theatre`, and native/online integrations remain uninstalled. Their
adoption gates are listed in [`STACK.md`](STACK.md).

## Boundary

Mission Control, multiplayer, telemetry, provider SDKs, Electron, and Tauri are
not part of this phase. Any future connection must arrive behind a separately
reviewed, disabled-by-default adapter.
