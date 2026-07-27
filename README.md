# Shenron City

A skyscraper you walk around in, wired to live Mission Control data.

Walk across the plaza, through automatic doors, into a lobby. Ask reception what
your system is doing — she answers from real agent state, not from a model. Take
the lift to floor 45 and look into the offices, one per agent, each showing what
that agent is actually working on.

The building is the interface. Floors are systems, offices are agents, and what
you see in a room is what that part of your system is really doing.

This is a **vertical slice**: one route, built properly, rather than fifty empty
floors.

## Run it

```bash
npm install
npm run dev
```

Then <http://127.0.0.1:9122>.

Mission Control is the data source — start it first. Point the game at it with
`MISSION_CONTROL_URL` in a `.env` (see `.env.example`); it defaults to
`http://127.0.0.1:9120`.

If the backend is not reachable the game says so and offers demo mode as an
explicit choice. It will not quietly show you fiction.

| URL | Effect |
|---|---|
| `/` | Live Mission Control data |
| `/?mode=demo` | Fixture data, clearly labelled, no backend needed |
| `/?quality=low` | Skip postprocessing — for measuring, or a stubborn driver |

## Controls

| | |
|---|---|
| `W A S D` | Move |
| Mouse | Look |
| `Shift` | Sprint |
| `Space` | Jump |
| `E` | Interact |
| `Esc` | Release cursor / pause menu |
| `F3` | Performance overlay |

Click **Enter** to capture the mouse. Browsers only grant pointer lock on a real
click; if it is refused you land on the pause menu — click Resume.

## The route

Plaza → automatic doors → lobby → secretary → lift → floor 45 → agent office →
request a status summary.

Everything in an office comes from a validated snapshot. An empty slot renders
as an unlit **VACANT** room rather than as a plausible-looking agent.

## What is real

- Agent roster, states, models, current tasks, risk tiers — `/api/agents`
- Identity, running tasks, cost today, alerts — `/api/status`
- Host CPU and memory — `/api/system/metrics`
- The secretary's answers — composed from the above, never generated

## What is not real yet

No characters, no rigs, no audio, no assets at all — the entire building is
procedural geometry. Floor 45 exists; 46–50 do not. Six offices, so a larger
roster overflows (the floor says so rather than hiding it).

**Known issue:** in-world text needs the network. `drei/Text` → `troika` fetches
font data from jsDelivr on first glyph, so signage and office monitors will not
render offline. Fix is to ship a WOFF in `public/` and pass `font=` explicitly.

## Layout

```
src/
├── contracts/   the Mission Control boundary — zod schemas, normalisation
├── adapter/     the only network I/O — auth, polling, WS, degradation
├── gameplay/    pure simulation — no three.js, no React, 51 unit tests
├── world/       geometry and art direction
├── agents/      how an agent is represented and spoken to
├── ui/          DOM overlays
└── lib/         small utilities
```

`gameplay/` imports no renderer. That is deliberate — the lift, doors, collision
and shaft interlocks are ordinary functions, so they are tested directly:

```bash
npm test
```

## Four things worth keeping if you rewrite this

**The HUD is driven by the telemetry poll, not the render loop.**
`requestAnimationFrame` stops when a window is hidden or minimised — measured:
22 frames then nothing, while `setInterval` kept firing. A monitoring display
driven by rAF freezes at stale values and still looks correct. Only the 3D scene
belongs in `useFrame`.

**One ordered simulation loop.** Everything mutable advances in a fixed order in
`gameplay/GameLoop.tsx`. Spreading it across per-component `useFrame` calls makes
ordering depend on React's render order, and the first symptom is the player
sinking through the lift floor on a frame where the car moved first.

**Nothing renders unvalidated backend data.** Payloads are parsed at the boundary
and normalised to stable domain types. A malformed field degrades to a default; a
structurally wrong response is rejected. An unrecognised agent state becomes
`unknown` and renders magenta — louder than a healthy agent, never quieter.

**Demo data can never be mistaken for live.** `source` is explicit, the link chip
is amber, agents are named `demo-*`, and the floor carries a
`FIXTURE DATA — NOT LIVE` sign in world space.

## Where to start editing

`src/world/layout.ts` is the building as data — geometry *and* collision are
generated from it, so a wall and its collider cannot drift apart. Move a wall
there and it moves everywhere.

`src/world/palette.ts` is the art direction. With no assets, palette and lighting
are doing all the work. Point-light intensity is candela with 1/d² falloff:
anything lighting a room belongs in the hundreds, not the tens.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, data flow, what is load-bearing
- [`docs/STACK_DECISIONS.md`](docs/STACK_DECISIONS.md) — every dependency, adopted / deferred / rejected, with reasons
- [`docs/SECURITY_BOUNDARY.md`](docs/SECURITY_BOUNDARY.md) — what the game can and cannot do, and why the secretary does not call a model
