# Shenron City

[![CI](https://github.com/xxvovalamaxx-ops/shenron-city/actions/workflows/ci.yml/badge.svg)](https://github.com/xxvovalamaxx-ops/shenron-city/actions/workflows/ci.yml)

Shenron City is a standalone browser-based 3D city built with Three.js and
React Three Fiber.

Walk Dragon Boulevard past shops and ambient pedestrians, visit the night
market and Pocket Park, talk with local scripted characters, enter through
headquarters' automatic doors, meet reception, take the elevator to floor 45,
and inspect the first fictional headquarters team. This phase is intentionally
a game only: it does not connect to Mission Control, the filesystem, local
services, model providers, telemetry, or any external host.

## Run it

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:9122>.

## Controls

| Input | Action |
|---|---|
| `W A S D` | Move |
| Mouse | Look |
| `Shift` | Sprint |
| `Space` | Jump |
| `E` | Interact |
| `Esc` | Release pointer / pause |
| `F3` | Performance overlay |

Click **Enter Shenron City** to capture the mouse.

## Current playable route

Dragon Boulevard → night market / Pocket Park → headquarters plaza →
automatic doors → lobby → secretary → elevator → floor 45 → resident office.

The **City Tour** HUD turns that route into six ordered objectives. Progress is
deterministic game state and is saved only in the game's validated browser
save; it is never sent to a host service.

The current geometry and audio are procedural. The art pass uses a curated set
of CC0 Poly Haven PBR textures recorded in
[`docs/Assets/ASSET_MANIFEST.csv`](docs/Assets/ASSET_MANIFEST.csv); it ships no
downloaded character, vehicle, or building models. District layout, collision
solids, and ambient walking loops share `src/world/city-data.ts`. Fictional
residents and activities come from `src/adapter/fixtures.ts`.

## Standalone boundary

- The former Mission Control network client is removed.
- Vite has no `/api` or WebSocket proxy.
- The browser policy uses `connect-src 'none'`.
- Runtime HMR is disabled so the development page does not open a WebSocket.
- In-world text uses local canvas textures rather than a font CDN.
- Save data stays inside browser `localStorage`; the game has no filesystem
  or native-computer access.
- A CI verifier rejects fetch/WebSocket/native-bridge paths and known
  integration markers, executable public HTML, and unreferenced shipped assets.

Verify the boundary:

```bash
npm test
npm run build
npm run verify:standalone
```

## Stack

| Category | Packages |
|----------|----------|
| **Renderer** | `three`, `@react-three/fiber`, `@react-three/drei` |
| **Visuals** | `@react-three/postprocessing` (Bloom, SMAA, Vignette) |
| **Physics** | `@react-three/rapier` (rigid bodies, colliders, character controller) |
| **Crowd** | Deterministic authored routes shared by rendering and collision |
| **Procedural** | `@dgreenheck/ez-tree` (trees with real bark/leaf textures) |
| **Architecture** | `zustand` (state), `zod` (schemas) |
| **Tooling** | `vite`, `typescript`, `vitest` |

See [`docs/STACK_DECISIONS.md`](docs/STACK_DECISIONS.md) for why each package was adopted.

## Structure

```text
src/
├── adapter/      local standalone scenario state
├── agents/       local characters, ambient crowds, and scripted dialogue
├── contracts/    stable world types and quarantined future adapter schemas
├── gameplay/     renderer-independent simulation and tests
├── world/        city data, geometry, lighting, offices, doors, and elevator
├── ui/           HUD, menus, panels, and local in-world text
└── lib/          small utilities
```

`gameplay/` owns the deterministic City Tour, doors, elevator, collision,
shaft interlocks, and player carry logic. `world/` renders that state. Host
integration is not part of the current runtime.

## Working together

`main` is the shared stable branch. Work in focused branches, open pull
requests, and avoid mixing world art, gameplay, and future integration changes
in one commit. Before requesting review, run:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run verify:standalone
npm audit --audit-level=high
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch, conflict, review, and
verification conventions. Report sensitive problems through
[SECURITY.md](SECURITY.md), not a public issue.

The future Mission Control and multiplayer work should arrive through explicit
versioned adapters, after the standalone game loop is fun and stable. Do not
reintroduce PC access through UI or NPC code.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/CITY_VERTICAL_SLICE.md`](docs/CITY_VERTICAL_SLICE.md)
- [`docs/STACK_DECISIONS.md`](docs/STACK_DECISIONS.md)
- [`docs/SECURITY_BOUNDARY.md`](docs/SECURITY_BOUNDARY.md)
