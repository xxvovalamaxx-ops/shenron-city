# Shenron City architecture

## Current phase

The current build is a standalone Three.js web game. It has no runtime
connection to Mission Control or the host computer. The goal of this phase is
to make the city, movement, interaction, doors, elevator, residents, and user
experience solid before any external integration returns.

## Layers

```text
src/
├── adapter/      in-repository scenario state; no network I/O
├── agents/       characters, ambient routes, and deterministic dialogue
├── contracts/    stable domain types and dormant future adapter schemas
├── gameplay/     pure simulation; no renderer or host integration
├── world/        Three.js scene composition and art direction
├── ui/           DOM overlays and local canvas-texture labels
└── lib/          focused utilities
```

The active data flow is:

```text
adapter/fixtures.ts
        ↓
adapter/store.ts ───────→ ui/
        ↓
world/ + agents/
```

There is no network client, API proxy, WebSocket, desktop bridge, filesystem
access, provider key, telemetry exporter, or external font resolver in this
flow.

## Simulation order

`gameplay/GameLoop.tsx` advances mutable state in one ordered `useFrame`:

1. entrance doors
2. elevator obstruction check
3. elevator state
4. collider assembly
5. input
6. swept movement and collision
7. player carry with the elevator
8. camera
9. interaction targeting
10. scene transforms
11. performance/HUD mirror

This ordering is load-bearing. Splitting these operations among components
would make behavior depend on React render order.

## Important invariants

- Collision is swept so frame hitches cannot tunnel through thin walls.
- Elevator landing gaps remain solid unless the car is aligned and open.
- The elevator reducer is total; invalid event/state pairs are no-ops.
- The player is carried explicitly by the moving elevator.
- Scenario residents have stable IDs so office assignment cannot jump.
- District geometry and collision consume the same renderer-free city data.
- Ambient pedestrians use deterministic fixed routes and never call a model.
- In-world text is generated from browser canvas textures and never resolves a
  remote font.

## Reintroducing integrations later

Mission Control, multiplayer, AI dialogue, and a desktop shell are separate
future boundaries. Each must be opt-in and versioned. They must not be imported
directly by `world/`, `gameplay/`, `agents/`, or general UI components.

A future connection should live behind an adapter that:

- validates all inbound data,
- exposes narrow domain events,
- is disabled by default,
- visibly distinguishes standalone and connected states,
- cannot expose arbitrary shell or filesystem access,
- has independent permission, contract, and disconnect tests.

## Known limitations

- One city district, one headquarters route, and one detailed floor.
- Procedural geometry only; no production asset pipeline yet.
- Fictional residents are stylized forms with deterministic dialogue and
  authored ambient routes.
- No audio, multiplayer, persistence, live AI, Mission Control, or desktop
  bridge.
- The production JavaScript bundle is still large and should be code-split
  after the first art/gameplay direction is fixed.
