# Shenzhen City

[![CI](https://github.com/xxvovalamaxx-ops/shenron-city/actions/workflows/ci.yml/badge.svg)](https://github.com/xxvovalamaxx-ops/shenron-city/actions/workflows/ci.yml)

Shenzhen City is a standalone browser-based 3D city built with Three.js and
React Three Fiber.

One world, one game: a **streamed Manhattan island**. Spawn in midtown, walk
the grid among tens of thousands of buildings, fly up to the skyline, spawn
vehicles and props from the dev tools, and make the city yours. This build is
intentionally a game only: it does not connect to Mission Control, the
filesystem, local services, model providers, telemetry, or any external host.

The player is a realistic CC3 rigged character (Sketchfab, CC-BY) driven by
locomotion clips retargeted offline from the CC0 Quaternius 65-joint motion
library (`scripts/retarget/bake-retarget.py`).

## Run it

```bat
start.bat
```

or

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:9122>.

## Controls

| Input | Action |
|---|---|
| `W A S D` | Move (camera-relative) / drive |
| Mouse | Orbit camera (right mouse: aim / tighter shoulder view) |
| `Shift` | Sprint / handbrake |
| `Space` | Jump / handbrake while driving |
| `Space` (double) | Fly / land |
| `E` or `F` | Take any car (parked, or slow traffic) / get out |
| `H` | Horn |
| `C` | Look behind while driving |
| `L` | Police lightbar (in a cruiser) |
| `V` | First / third person |
| `Esc` | Pause: city map (click to set a GPS waypoint) and settings |
| `F2` | Dev tools (teleport, spawns, wanted level, time, rain) |
| `F3` | Performance overlay |

Click **ENTER MANHATTAN** to capture the mouse. The cinematic intro flies you
down to a 5th Avenue sidewalk, then hands control to the player.

## Gameplay

- **Steal and drive.** Walk up to a parked car or any slow car in traffic and
  take it. Six original, fictional cars (Oriel Sedan, Oriel Cab, Oriel
  Pursuit, Brannock XT, Haulden Courier, Sabrecat GT) with engine and gearbox
  audio, body roll, skid marks, tyre smoke and crash knock-back.
- **Wanted level.** Carjacks, hitting people and ramming cars or cruisers add
  heat; 1-5 stars. Police cruisers spawn on the street graph and chase you
  (leading, ramming, reversing out of walls). Break line of sight, leave the
  search area and stay hidden to lose them. Get caught on foot: **BUSTED**.
- **Jobs.** Yellow coronas near the spawn start missions laid out on the real
  streets: *Wheels* (deliver a stolen car to a chop shop), *Midtown Sprint*
  (checkpoint race), *Heat* (get two stars, then lose them) and *Night Fare*
  (taxi pick-up and drop-off). Objective text, a job clock, a GPS route on the
  radar and cash on MISSION PASSED.
- **HUD.** GTA-style radar with the real LION streets, health/armor, money,
  wanted stars, clock, district and street, vehicle name and speed.

## The world

The island is exported as a `manhattan_base.glb` (land, water, bridges,
landmarks) plus per-tile chunks that stream in around the camera
(`public/models/manhattan/`), driven by `src/world/ManhattanCity.tsx`. Walking
collision uses per-tile BVHs (`src/world/manhattan-collision.ts`) so you can
walk the streets and bounce off buildings in real time. The game loop, HUD and
save system live in `src/gameplay/` and `src/ui/`.

## Dev tools (F2)

- **Teleport** to Times Square, Central Park, the Statue of Liberty and more.
- **Spawn** sedans, taxis, police cars, ambulances, pedestrians and trees.
- **World** sliders for time of day, rain, speed multiplier and volume.

## Standalone boundary

- The former Mission Control network client is removed.
- Vite has no `/api` or WebSocket proxy.
- The browser policy uses `connect-src 'self' blob:` (blob is required for
  embedded GLB texture decoding).
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

## Asset provenance

Every runtime asset is recorded in
[`docs/Assets/ASSET_MANIFEST.json`](docs/Assets/ASSET_MANIFEST.json) with
source, creator, license and redistribution status. The 204-pack public
library (70,399 files) lives in `SourceAssets/PublicLibrary/` with receipts
and SHA-256 hashes in `ASSET_MANIFEST.json` + `download-receipts.json`;
technical validation, scores and preview evidence are under
`docs/Assets/ASSET_TECHNICAL_*.md/json` and `evidence/assets/`.
