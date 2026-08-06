# Shenzhen City architecture

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
├── animals/      imported animal actors plus renderer-free route contracts
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
7. City Tour location events
8. player carry with the elevator
9. camera
10. interaction targeting
11. scene transforms
12. performance/HUD mirror

This ordering is load-bearing. Splitting these operations among components
would make behavior depend on React render order.

## Important invariants

- Collision is swept so frame hitches cannot tunnel through thin walls.
- Elevator landing gaps remain solid unless the car is aligned and open.
- The elevator reducer is total; invalid event/state pairs are no-ops.
- The player is carried explicitly by the moving elevator.
- Scenario residents have stable IDs so office assignment cannot jump.
- District geometry and collision consume the same renderer-free city data.
- Ambient pedestrian meshes and colliders sample the same deterministic
  authored routes, phases, and quality-scaled count.
- The capybara visual, animation selection, and moving collider sample one
  deterministic route pose, so rendering cannot drift away from collision.
- The six-step City Tour is an ordered pure reducer; later objectives cannot
  be completed early and validated progress can be restored from the local
  browser save.
- City Tour direction and distance come from renderer-free target and bearing
  math, quantized into the same 10 Hz HUD mirror as other readouts.
- In-world text is generated from browser canvas textures and never resolves a
  remote font.
- Save data is validated browser `localStorage`, not filesystem access.
- Destructible-prop simulation lives in the renderer-free runtime
  (`rt.destruction`) and is stepped by GameLoop with the same real dt as
  everything else; React renders it but owns no destruction state, so
  time-to-destroy is identical at 30, 60 or 120 fps and StrictMode cannot
  double-apply damage. Destroyed ids persist through the validated save
  (v2+).

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
- Procedural city geometry with a curated CC0 PBR texture pass and one audited
  production animal pipeline.
- Fictional residents are stylized forms with deterministic dialogue and local
  steering.
- No multiplayer, live AI, Mission Control, or desktop bridge.
- The production JavaScript bundle is still large and should be code-split
  after the first art/gameplay direction is fixed.
