# Phase 3A — Deterministic Player-Drivable Vehicles

Branch scope: a deterministic kinematic/arcade vehicle system on top of the
renderer-free simulation architecture. No rigid-body engine, no wanted/combat
systems.

## Design position

Phase 3A deliberately starts with an **arcade kinematic model** instead of a
rigid-body engine: a signed forward speed, a rate-limited front-wheel steering
angle, an exponentially damped lateral velocity for traction, and a handbrake
that trades grip for yaw. The whole vehicle world is pure TypeScript —
`src/gameplay/vehicles/` imports no THREE and no React — and every subsystem
is a pure function of its inputs, so a recorded input stream replays
bit-identically.

Existing systems are reused where they exist: the camera boom machinery
(`camera-boom.ts` constants and easing) and the collision vocabulary
(`collision.ts` AABBs, `rayBoxDistance`). Lane, route and traffic systems did
not exist in this codebase before Phase 3A; they are new here.

## Module map

| Module | Responsibility |
|---|---|
| `vehicle-model.ts` | Pure arcade dynamics: throttle/brake/reverse, drag, traction, speed-sensitive steering, handbrake, wheel spin, front-wheel steering, brake lights. Heading basis matches the walk controller. |
| `vehicle-specs.ts` | Four families (sedan/taxi/police/ambulance) with fixed authored numbers. |
| `vehicle-lanes.ts` | Hand-authored polyline lanes (`boulevard-loop`), nearest-point projection, point-at-distance, curvature. |
| `vehicle-collision.ts` | `VehicleWorld` interface, AABB arena, SAT rect contact with minimum-translation depth, pedestrian response. |
| `vehicle-entities.ts` | The seven-state machine, transition table, doors/seat/exit geometry, seeded default layout. |
| `vehicle-traffic.ts` | Seeded AI traffic on lanes (pure pursuit + leader gaps), pair collision resolution, traffic director (return-to-AI), pedestrian walking. |
| `vehicle-camera.ts` | Chase and cockpit cameras with world-swept boom collision. |
| `vehicle-control.ts` | The per-step orchestrator: enter prompt, transitions, driving, exit validation, events. |
| `vehicle-session.ts` | The module-level singleton + fixed-substep driver the game loop calls. |
| `world/manhattan-vehicle-world.ts` | The `VehicleWorld` implementation over the Manhattan BVH (the only vehicle code that touches THREE). |
| `world/VehicleRig.tsx` | Procedural visuals: wheels that rotate and steer, brake lights, headlights, pedestrians. |
| `gameplay/input.ts`, `GameLoop.tsx` | `E` interact key, the driving frame branch, HUD speed, event → audio/HUD side effects. |
| `gameplay/save.ts` | Save format v2 with the `vehicle` section + v1 migration. |
| `audio/mix.ts` | `horn` one-shot (plus reuse of `doorOpen`/`doorClose` for enter/exit). |

## Vehicle states

Exactly one of seven, changed only through the explicit transition table
(`VEHICLE_TRANSITIONS` in `vehicle-entities.ts`):

```
UNAVAILABLE → PARKED, AI_CONTROLLED
PARKED      → ENTERING, AI_CONTROLLED
ENTERING    → PLAYER_CONTROLLED, PARKED (abort)
PLAYER_CONTROLLED → EXITING, DISABLED
EXITING     → PARKED, PLAYER_CONTROLLED (exit placement failed)
AI_CONTROLLED → ENTERING, PARKED, DISABLED
DISABLED    → (terminal)
```

Authority transfers are first-class:

- **AI → player**: `AI_CONTROLLED → ENTERING → PLAYER_CONTROLLED`. The AI
  state is dropped at the moment of the transfer. The player may take any
  stationary vehicle whose door they can reach.
- **player → AI**: `PLAYER_CONTROLLED → EXITING → PARKED`, then the traffic
  director returns an abandoned owned car to the loop via the explicit
  `PARKED → AI_CONTROLLED` transition. There is no direct
  `PLAYER_CONTROLLED → AI_CONTROLLED` shortcut; exiting always parks first.

The player's car (owned) is persisted in the save file once driven;
restoring a save always parks it.

## Required mechanics → where

Enter prompt at a valid door: `updateEnterPrompt` — the nearest door within
`ENTER_PROMPT_RADIUS`, on clear ground and not blocked by another vehicle;
prompt changes emit `prompt` events the game loop mirrors to the HUD.

Enter/exit transitions: fixed-duration smoothstep interpolation
(`ENTER_DURATION` 0.6 s, `EXIT_DURATION` 0.45 s) with the player attached to
the seat (`seatWorld`).

Player attached to seat: the sim owns the player pose while driving;
`GameLoop` mirrors it to `rt.player`; `PlayerAvatar` hides while
`vehicleSim.playerVisible` is false.

Throttle / brake / reverse / steering: `stepVehicle` — W/S/A/D. Brake held
from a standstill engages reverse; throttle out of reverse brakes first.

Speed-sensitive steering: `steeringFactor` — full authority below 2 m/s
(parking), linear taper to 0.6 at 14 m/s, then toward 0.32 at top speed.

Drag: constant rolling drag + quadratic air drag; the sedan settles at
~32.4 m/s (≈117 km/h) with drag balance.

Traction: lateral velocity decays exponentially (`grip`); position advances
along forward + right × lateral.

Handbrake: Shift — strong deceleration, reduced grip, boosted yaw, lateral
kick; brake lights on.

Wheel rotation + front-wheel steering: `wheelSpin` accumulates
`speed / wheelRadius`; the two front wheels yaw by `steerAngle` (visual in
`VehicleRig.tsx`).

Brake lights / headlights: `motion.braking` and `headlightsOn`
(clock-driven, night = 19:00–06:00), visual emissive strips.

Horn: Space while driving — one-shot `horn` event, `cityAudio.play('horn')`,
0.45 s `hornTimer` for visuals.

Chase / cockpit camera + camera collision: `vehicle-camera.ts` — chase boom
is swept against the vehicle world via `castDistance` (BVH in-game, AABB in
tests), padded and eased exactly like the walk boom; V toggles (third
person = chase, first person = cockpit).

Vehicle/world collision: swept circle move (`world.moveCircle`) with speed
bleed proportional to the blocked fraction; in-game this is the Manhattan
BVH, in tests the AABB arena.

Vehicle/traffic collision: SAT contact with minimum-translation depth,
full-depth separation, per-vehicle speed bleed; parked vehicles are static
obstacles.

Vehicle/pedestrian response: a pedestrian inside the footprint is knocked
out of it (sideways for head-on hits, along travel for side hits) in one
step, bleeds the vehicle 40% of its speed, and stays down for
`PED_DOWN_TIME` (2.5 s) — one penalty per encounter, never one per frame.

Pause: the vehicle world only steps inside the unpaused frame branch; the
existing `setRuntimePaused` key-clearing applies to vehicle inputs too.

Save/load: save format v2 (`vehicle` section, v1 → v2 migration adds `null`),
restored as PARKED at the saved pose with the player at the door.

Exit placement validation: `findExitSpot` — every door's three candidate
spots must be on solid ground, clear of the world and of every other
vehicle; on total failure the exit is refused (`exit-blocked` event) and the
player stays seated.

## Determinism

The simulation is a pure function of `(sim, world, input, dt)` with a fixed
physics substep of 1/120 s (`VEHICLE_SUBSTEP`). No wall clock, no
`Math.random` (the spawn layout uses a seeded LCG), no renderer reads inside
a step. The gate is `vehicle-replay.test.ts`: an identical recorded input
stream (20 s at 120 Hz: enter, drive, horn, pedestrian hit, head-on traffic
hit, wall hit, blocked exit, reverse, exit) is replayed twice and compared
step by step.

**Documented tolerances** (two orders of magnitude above any float noise the
platform could introduce; the implementation is expected to match exactly):

| Quantity | Tolerance |
|---|---|
| Position (3-D Euclidean) | ≤ 1e-9 m |
| Heading | ≤ 1e-9 rad |
| Speed | ≤ 1e-9 m/s |
| Collision event streams | exactly equal |

## Benchmark

`vehicle-replay.test.ts` (`benchmarks the pure step`) measures the full
orchestrated step — player car, one AI vehicle, two parked cars, a
pedestrian, camera — at the fixed 120 Hz substep, with a hard floor of
50,000 steps/s as a regression tripwire. Measured on this machine:

```
[vehicle] benchmark: 221,000–477,000 steps/s at 120 Hz fixed step
```

The step budget for 16 vehicles + 2 pedestrians at 120 Hz is roughly
5–10% of a frame, leaving the rest of the frame budget untouched.

## Controls

`W/S` throttle / brake+reverse, `A/D` steer, `Shift` handbrake, `Space`
horn, `E` enter/exit, `V` chase/cockpit camera. The walk-mode fly toggle is
disabled while driving.

## Caveats

- Lane geometry (`boulevard-loop`) is hand-authored along the midtown grid
  and is approximate until exact street centre-lines are exported; the
  sampling API is the only thing the simulation depends on, so re-authoring
  lanes is a data change, not a code change.
- Vehicle visuals are procedural placeholders (boxes + emissive strips)
  until the production vehicle families land; the sim's pose, wheel spin,
  steering and lights are all visible.
- Pedestrians are deterministic crossing schedules, not a crowd system; the
  response API is what future pedestrian systems will plug into.
- Wanted/combat systems are explicitly out of scope for this branch.
