# Shenzhen City

[![CI](https://github.com/xxvovalamaxx-ops/shenron-city/actions/workflows/ci.yml/badge.svg)](https://github.com/xxvovalamaxx-ops/shenron-city/actions/workflows/ci.yml)

Shenzhen City is a standalone browser-based 3D city built with Three.js and
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

Click **Enter Shenzhen City** to capture the mouse.

## Current playable route

Dragon Boulevard → night market / Pocket Park → headquarters plaza →
automatic doors → lobby → secretary → elevator → floor 45 → resident office.

The **City Tour** HUD turns that route into six ordered objectives. Progress is
deterministic game state and is saved only in the game's validated browser
save; it is never sent to a host service. A local compass, distance readout,
and north-up minimap guide the player to the active objective.

The current world uses original Blender exports for the hero district,
headquarters lobby, elevator, Floor 45, automatic doors, and four unbranded
vehicle families. Curated CC0 Poly Haven surfaces, vegetation, animated
Quaternius humanoids, the Service Android, and the project-authored capybara
support those assets. Legacy Kenney files remain verified for compatibility,
but their cartoon citizens and toy vehicles are not rendered on the production
route. Every Production Pass 02 runtime GLB is recorded in
[`docs/Assets/ASSET_MANIFEST.json`](docs/Assets/ASSET_MANIFEST.json); historical
downloads remain in
[`docs/Assets/ASSET_MANIFEST.csv`](docs/Assets/ASSET_MANIFEST.csv).

The current pass is an audited intermediate build, not a claim of photoreal or
AAA completion. The exact visible-replacement status is in
[`docs/Production/PLACEHOLDER_REPLACEMENT_LEDGER.csv`](docs/Production/PLACEHOLDER_REPLACEMENT_LEDGER.csv),
and measured evidence is under
[`docs/Production/evidence/production-pass-02`](docs/Production/evidence/production-pass-02).
District layout, invisible collision solids, traffic transforms, and ambient
walking loops still share `src/world/city-data.ts`, so imported presentation
cannot drift from gameplay collision. Fictional residents and activities come
from `src/adapter/fixtures.ts`.

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
npm run check
```

## Stack

| Category | Packages |
|----------|----------|
| **Renderer** | `three`, `@react-three/fiber`, `@react-three/drei` |
| **Visuals** | `@react-three/postprocessing` (Bloom, SMAA, Vignette) |
| **Collision** | Deterministic swept capsule-vs-AABB controller |
| **Crowd** | Deterministic authored routes shared by rendering and collision |
| **Procedural** | `@dgreenheck/ez-tree` (trees with real bark/leaf textures) |
| **Architecture** | `zustand` (state), `zod` (schemas) |
| **Tooling** | `vite`, `typescript`, `eslint`, `vitest` |

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
npm run check
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
- [`docs/Production/VERTICAL_SLICE_STATUS.md`](docs/Production/VERTICAL_SLICE_STATUS.md)
- [`docs/Production/KNOWN_ISSUES.md`](docs/Production/KNOWN_ISSUES.md)
- [`docs/Assets/BLENDER_WORK_LOG.md`](docs/Assets/BLENDER_WORK_LOG.md)
- [`docs/STACK_DECISIONS.md`](docs/STACK_DECISIONS.md)
- [`docs/SECURITY_BOUNDARY.md`](docs/SECURITY_BOUNDARY.md)
