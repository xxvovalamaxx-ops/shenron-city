# AI Headquarters — architecture

A skyscraper you walk around in, wired to the Mission Control that already
exists. This is the current-state map and the layer boundaries.

## What was already here (inspected, not assumed)

| Thing | Finding |
|---|---|
| Backend | FastAPI, binds `127.0.0.1:9120`, **207 endpoints** across 15 route modules |
| Real-time | `@app.websocket("/ws")` backed by `Broadcaster` — an existing transport, so no second one was added |
| Auth | `POST /api/auth/session` → token sent as `X-Session-Token` |
| Rate limiting | `security/rate_limit.py`, default bucket **200 requests / 60 s shared across all routes** |
| Agent data | `GET /api/agents` reads `$HERMES_HOME/agents/registry.json` + workspace `IDENTITY.md` files |
| Status | `GET /api/status` — identity, model, provider, running/completed/failed counts, cost, alerts |
| Host metrics | `GET /api/system/metrics` — CPU, memory, disk, process count |
| Agent home | `HERMES_HOME`, resolved by `backend/runtime_paths.py`; currently `E:\Shenron` |
| Frontend | React 19 + Vite 6 + TanStack Query on port 9121 — **untouched by this work** |

Nothing in Mission Control was rewritten. The game is additive.

## Layers

```
src/
├── contracts/     ← the boundary. zod schemas + normalisation.
├── adapter/       ← the only network I/O. auth, polling, WS, degradation.
├── gameplay/      ← pure simulation. no three.js, no React, fully testable.
├── world/         ← geometry and art direction.
├── agents/        ← how an agent is represented and spoken to.
└── ui/            ← DOM overlays. driven by the adapter, never by the frame loop.
```

**The rule that matters:** nothing in `world/`, `agents/` or `ui/` imports a
backend response shape. Raw payloads enter `contracts/`, get validated, and
leave as stable domain types. When the backend changes shape, exactly one
directory breaks.

`gameplay/` imports no renderer at all. That is why the elevator, the doors,
the collision sweep and the shaft interlocks have 46 unit tests — they are
ordinary functions.

## Data flow

```
FastAPI :9120
   │  GET /api/status | /api/agents | /api/system/metrics      (staggered)
   │  WS  /ws                                                  (coalesced)
   ▼
adapter/client.ts ──► contracts/ (zod validate + normalise) ──► adapter/store.ts
                                                                    │
                                          ┌─────────────────────────┴────────┐
                                          ▼                                  ▼
                                   world/ + agents/                        ui/
                                   (3D, in useFrame)              (DOM, 10 Hz mirror)
```

Requests go through the Vite proxy so they are same-origin. The backend's CORS
allowlist does not include port 9122 and did not need to be widened.

### Polling cadence, and why it is not uniform

The shared limiter allows 200 req/min. Polling three endpoints on one 2 s timer
plus a full refresh per socket event exceeded that immediately — the first live
run returned `429` on `/api/agents` and `/api/system/metrics`, and floor 45
rendered empty. Now:

| Endpoint | Interval | ~req/min |
|---|---|---|
| `/api/status` | 2 s | 30 |
| `/api/system/metrics` | 4 s | 15 |
| `/api/agents` | 8 s | 8 |

≈53/min. Socket events force an immediate refresh but are debounced 700 ms, and
each endpoint caches its last good body — a `429` degrades to stale data rather
than blanking the roster.

## Simulation

One `useFrame`, in `gameplay/GameLoop.tsx`, in a fixed order:

1. entrance doors → 2. lift obstruction check → 3. lift tick → 4. assemble
colliders → 5. input → 6. move + collide → 7. carry player with the car →
8. camera → 9. interaction target → 10. write meshes → 11. perf + HUD mirror

Scattering these across per-component `useFrame` calls would make ordering
depend on React's render order. The first symptom would be the player sinking
through the lift floor on any frame where the car moved first.

`dt` is clamped to 1/20 s. A stalled frame slows time rather than teleporting
the player through a wall.

### Things that are load-bearing

- **Collision is swept, not sampled.** Testing only the destination tunnels
  through thin geometry whenever a frame hitch produces a large delta. Substeps
  are capped at 0.07 m — below half the thinnest collider (a 0.16 m door leaf).
- **Shaft interlocks.** Every landing is solid unless the car is aligned within
  0.35 m *and* its doors are ≥75 % open. Without this you walk into the opening
  on 45 while the car is in the lobby and fall 180 m.
- **The lift is a total state machine.** `step(state, event)` returns a state
  for every pair; nonsensical pairs return the state unchanged. Tests assert
  directly that `phase === 'travelling'` implies `doorOpenness === 0`.
- **The player is carried explicitly.** At 180 m in 7 s the car rises ~0.43 m
  per frame — more than the step height, so relying on the floor collider to
  push would drop the player through it.

## Live vs demo

`WorldSnapshot.source` is `'live' | 'demo'` and is never inferred. The game
attempts live on start; if Mission Control is unreachable it **says so and
offers demo as an explicit choice** rather than quietly substituting fiction.
In demo mode every agent is named `demo-*`, the identity string reads
`DEMO — not a live agent`, the link chip is amber, and floor 45 carries a
`FIXTURE DATA — NOT LIVE` sign in world space.

Link states: `connecting → live → degraded (last known) → unreachable (stale)`.
Degraded keeps the last good snapshot on screen and labels it. It does not blank.

## The HUD is not in the render loop

`requestAnimationFrame` stops when a window is hidden, minimised or occluded —
verified during this build: with the Chrome window behind VS Code the loop
delivered 22 frames and then nothing, while `setInterval` kept firing. A
monitoring surface driven by rAF freezes at stale values and looks fine. So the
HUD renders from the adapter's poll; only the 3D scene lives in `useFrame`.

## Known limitations

- **No assets.** Everything is procedural geometry. No characters, no rigs, no
  audio. The secretary and agents are abstract presences, deliberately — an
  unrigged humanoid built from primitives is worse than an honest abstraction.
- **Six offices.** Floor 45 has six slots; the roster currently reports 25
  agents. The overflow is stated in-world rather than silently dropped.
- **One floor.** 45 exists. 46–50 do not.
- **The secretary is grounded, not generative.** See [`SECURITY_BOUNDARY.md`](SECURITY_BOUNDARY.md).
- **No desktop bridge.** Browser-only. Nothing here can touch the OS.
