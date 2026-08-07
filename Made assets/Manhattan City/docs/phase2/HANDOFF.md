# Handoff — Manhattan / Shenron City

Written for the next model to pick this up cold. Read this file first, then
`docs/phase2/LICENSING.md`, then `docs/qa/PHASE2_BUG_LEDGER.csv`.

Branch: `phase2/living-city`. Last commit: `0c660b7`.

---

## 0. Read this if you cannot see images

You probably can't look at a screenshot. **That is much less of a handicap on
this project than it sounds**, because almost nothing here was ever verified
by looking. Of the 76 defects in the ledger, the large majority were found by
writing something that counted occurrences across the whole dataset, or that
read actual GPU/audio output back as numbers. A few examples of the house
style:

| Claim | How it was proven |
|---|---|
| The walk cycle animates | Control render differed by **0 px**; phase-only advance differed by **1,338 px** with positions provably frozen |
| Props sit on the pavement | Raycast down, compare surface height: **400/400** |
| The State Plane projection is right | **99.9%** of 808 converted points landed within 25 m of a LION street, median 0.7 m |
| LOD tiers align with full detail | Raycast height error median/p90/max all **0.00 m** over 390 samples |
| Silence is silent | Rendered the real audio graph into an OfflineAudioContext: **0.00000 RMS** |
| The hidden building is hidden on the GPU | Rendered the same frame twice, suppression on and off: **17,436 px** changed |
| The corridor drives on roads | 210 samples at 25 m spacing, worst offset **0.00 m** from a drivable centreline |

**Keep doing that.** A number you can diff is worth more than a picture, and
it survives a context window. The rule that produced most of this work:

> Cheap proxies lie. If you have not measured it, you do not know it.

### The five things that *were* caught by eye — and how to catch them blind

This is the real gap. Build these checks before you write new features; they
are your substitute for looking, and each one corresponds to a defect that
actually shipped.

These were written for `framecheck.js` in the Manhattan reference app, which
has been removed — the runtime is now the game, at the repo root. The checks
themselves are unchanged and still owed; the game's equivalents live under
`scripts/visual-qa/` (`frame-analysis.mjs` covers 1 and 2). All of them read
pixels back with
`renderer.getContext().readPixels(...)` — the same trick `hq.verify()`
already uses, so copy that method's structure.

1. **Dead frame** (caught P2-071: the corridor's final capture was 1280×720 of
   uniform dark blue, camera stuck inside a wall).
   Compute per-channel standard deviation and the count of distinct quantised
   colours. A real frame has stddev > 8 and > 300 distinct colours. Assert it
   on **every** capture before you accept the PNG. This alone would have
   caught P2-032 (0-byte captures) and P2-071.

2. **Occluded view** (caught P2-069: the car's headlining overhung the
   windscreen and blacked out the top quarter of the driver's view).
   Depth-based: render, read the depth buffer or raycast a 16×9 grid of screen
   rays, and report the fraction of the frame whose first hit is closer than
   1.5 m. For an in-vehicle or in-room camera, anything over ~35% means
   geometry is in your face. Report the fraction *by screen band* (top third,
   middle, bottom) so you can tell a dashboard from a roof.

3. **Inside-out geometry** (caught P2-062: `Builder.box()` was wound inward in
   five authoring scripts; every near face was backface-culled and you were
   looking at the inside of the far one).
   Pure arithmetic, no render needed. For any closed mesh, compute signed
   volume `Σ dot(v0, cross(v1-v0, v2-v0))/6`. Negative means inside-out. Add
   this to every `Builder.to_object()` in `scripts/phase2/` as an assertion.
   **Do this first — it is ten lines and it is the single highest-value check
   in this list.**

4. **Culled-from-inside** (caught P2-067: the lift cab's three walls faced
   outward, so the ride showed open sky).
   For each room mesh, cast rays from the room's centre at eye height in 16
   horizontal directions plus straight up and down, with `material.side =
   FrontSide`. Every ray must hit within the room's bounding box. A miss means
   that wall is wound the wrong way.

5. **Unlit surface** (caught P2-058: every interior ceiling rendered pure
   black because the HemisphereLight's ground colour lights down-facing
   surfaces).
   Render the room, read pixels, and report mean luminance for the top 20% and
   bottom 20% of frame separately. A ceiling reading below 0.02 linear when
   the floor reads 0.3 is a lighting bug, not a style choice.

### Delegating vision

If you have a vision-capable model available, use it as a **second opinion on
a specific question**, never as the primary check. Ask it narrow, falsifiable
things — "is there a horizontal black band across the top of this frame, and
roughly what fraction of the height?" — not "does this look good". Then encode
whatever it tells you as one of the numeric checks above, so the next run
catches it without asking anyone.

**No model's self-report counts as proof.** That includes yours and mine.

---

## 1. What exists

A streaming Three.js runtime over a Blender-authored Manhattan, built from
official data. Phases 2A–2N are done and committed.

```
scripts/phase2/          the build pipeline (Blender + pure-stdlib Python)
  40_fetch_nyc_open_data.py   Socrata ingest, 8 datasets
  41..46                      registry, classification, districts, cells, tiles
  47_build_streets.py         LION -> street graph
  48_build_walk.py            sidewalk survey -> 14,675 walk lanes, 112,418 props
  49_build_demand.py          PLUTO + DOT counts -> pedestrian/vehicle demand
  50,52,54                    streets, vehicle fleet, street furniture (Blender)
  56_build_lods.py            L2/L3/L4 massing (Blender)
  58_weather.py               sky, cloud, rain (Blender)
  60_interiors.py             lobby, penthouse, market (Blender)
  62_hq.py + 63_hq_site.py    HQ tower + Floor 45, and the lot it stands on
  64_corridor.py              lift cab, car interior, Shenron form (Blender)
  66_subway.py + 67_build_subway.py   entrances, and the footfall they generate

<repo root>/src/city/            the runtime
  city, streamer, lod, facade, traffic, pedestrians, props, demand, weather,
  interiors, hq, doors, doors-math, subway, sky
```

The Manhattan reference app that used to live in `apps/manhattan-threejs/` is
gone. It was a second runnable world rendering the same city, and the repo is
meant to hold one game; its runtime modules are the list above, ported into
`src/city/` and driven by `src/world/ManhattanCity.tsx`. Two things did not
come across: `corridor.js`, a scripted camera tour, and `controls.js`, whose
raycast walk controller the game replaces with
`src/world/manhattan-collision.ts`. The authoring pipeline — every script in
`scripts/phase2/`, and `data/`, `exports/`, `blend/` — is untouched and is
still where the world comes from.

Run it: `npm run dev` at the repo root, port 5173. The world data is served
from `public/models/manhattan/` rather than mounted out of this project, so a
rebuilt export has to be copied across.

Keys: `WASD` move, `F` fly/walk, `E` enter/leave, `M` mute, `H` hide overlays.

**Measured performance** (RTX 5070, 1280×720): resident tile payload 67.8 MB →
10–16 MB after LOD; street-life CPU ~0.4 ms/frame. See §3 for why the
triangle/draw-call figures are **not** trustworthy.

---

## 2. Hard rules — carry these forward verbatim

These came from the project owner and are not negotiable. They are the reason
every asset in this repo is generated rather than sourced.

- Never use ripped assets from GTA, Forza, Need for Speed, BeamNG, commercial
  simulators, or leaked marketplace packs.
- Do not scrape or redistribute geometry or imagery from Google Maps, Google
  Earth, Apple Maps, Bing 3D, commercial games, paid 3D map providers, or
  unlicensed street-view sources.
- Do not extract copyrighted facade photographs and ship them as textures
  without rights.
- Real branded cars may be used **only** where the specific model licence
  explicitly permits game use, modification, redistribution, repository use and
  final distribution.
- **Do not fabricate Mission Control state while offline.** Floor 45's video
  wall and all 28 monitors are authored dark for exactly this reason. Do not
  put invented telemetry on them.
- Do not let Blender MCP file-loading overwrite an unrelated open file. Every
  authoring script runs `blender -b --factory-startup --python ...` and saves
  to its own `blend/manhattan_*.blend`. Keep it that way.
- **Do not misrepresent the build as photoreal or game-ready.** It is a
  city-scale massing model with procedural facades, street life and interiors.
  The runtime says so itself under `L`. Keep that honest as things improve.
- No subagent self-report counts as proof.

Two more that this session added, and that must survive:

- **`SHENRON_form` is an original abstract form** — coiling ribbons around a
  faceted core, no face, no eyes, no scales, no horns. It is deliberately not
  a reproduction of any existing character design. If a licensed character is
  wanted there, that is a rights decision to be paid for, not a modelling job.
- **No MTA marks.** The subway kiosks carry no roundel, route bullet, wordmark
  or lettering. The sign is a blank panel.

The frozen Phase 1 world is the geographic source of truth. **Do not
regenerate Manhattan.** Exactly one building is substituted (the HQ, on
registry id 34686 — no name, no address, height modelled from zoning), it is
suppressed at runtime rather than deleted from the tiles, and it is documented
in `LICENSING.md`. Any further substitution gets the same treatment.

---

## 3. Roadmap

### P0 — Phase 2O: optimization. The only unstarted phase.

**Start with the honesty problem, not the profiler.**

`P2-075`: the performance figures reported through Phases 2C–2N ("Times Square
939,647 tris / 89 draws / 0.27 ms") were measured at a camera position labelled
Times Square that was actually **Lincoln Square, 1.8 km away and materially
less dense**. The constant is fixed (`TIMES_SQUARE = { x: -1476, y: -2433 }` in
`main.js`) but nothing has been re-measured. Until it is, treat every published
performance number in this repo as optimistic and unverified.

1. **Build a benchmark harness** — `scripts/qa/bench.js` or a runtime method,
   driven headless. Fixed camera list (at minimum: Times Square street level,
   Times Square at 620 m, Floor 45 interior, mid-drive on the corridor, Battery
   at 1,500 m, Harlem street level). For each: triangles, draw calls, CPU frame
   ms, GPU frame ms via `EXT_disjoint_timer_query_webgl2`, resident MB, and the
   frame-check numbers from §0. Emit JSON. **Commit the baseline before
   optimizing anything** so every later change has something to diff against.
2. Re-measure and publish corrected numbers. Update any doc that quotes the
   old ones.
3. Then optimize, in this order of likely payoff:
   - **Draw-call merging** across resident tiles (currently one draw per tile
     per material).
   - **Instanced props culling** — `props.js` rebuilds instance matrices on a
     20 m camera-move threshold; profile whether that or the per-frame LOD
     retry in `lod.js` dominates.
   - **Frustum culling for the LOD layer** (`frustumCulled = false` is set in
     several places for correctness; check which can be turned back on).
   - **Texture/material dedup** — count distinct materials at runtime.
   - **Draco settings**: position quantization 20, generic 24. Lower is
     smaller but broke `_BID` before (P2-022/P2-023); re-tune only with the
     bench in place.

**Definition of done:** committed baseline JSON, corrected numbers in the docs,
and a measured before/after for each optimization. No optimization lands
without a diff showing it helped.

### P1 — Close the ledger's open items

Six remain open in `docs/qa/PHASE2_BUG_LEDGER.csv`:

- `P2-013` **medium** — condominium BBLs don't join PLUTO, so recent towers
  lose lot attributes. Fix: fall back to the billing BBL, or join via
  `mappluto_bbl` from the building footprint dataset. Highest value of the six;
  it silently degrades the demand field in exactly the dense areas that matter.
- `P2-026` **medium** — Javits Center classified as prewar masonry apartment.
  Symptom of the classifier having no use-code input for large civic sheds.
- `P2-008` **low** — 270 buildings outside every NTA polygon.
- `P2-009` **low** — buildings classified by geometry alone, no city data.
- `P2-043` **wontfix** — DOT pedestrian counts (`2de2-6x2h`) return 114 empty
  objects on JSON, CSV and `$query=SELECT *`. Re-check occasionally; it would
  let you validate the demand field against ground truth.
- `P2-048` **wontfix** — LOD on the 1400 m tile grid rather than the 800 m
  sector grid.

### P2 — Phase 3: from demo to game

Phase 2's brief ends at 2O. Everything below is **beyond** that brief, so
confirm the shape with the owner before committing to it — but this is the
honest ordering, with what each one depends on and what "done" means.

The gap to close: today you can *move through* a convincing city. You cannot
yet *do* anything in it. The items below are ordered so that each one makes
the next one possible, and so the earliest ones remove the most obviously fake
interactions.

---

**3A — Drive the car for real.** *Depends on: 2O (frame budget). Largest
single step from demo to game.*

`corridor.js` already solves routes over the LION graph and positions a car
along them; `traffic.js` already simulates ~23,500 lanes of AI vehicles;
`CAR_cabin` already exists and is sized to `VEH_sedan`. What is missing is
player input driving a vehicle instead of a spline.

Build in this order: (1) a vehicle body with throttle/brake/steer against the
existing walk collider, (2) lane-snapping assistance so it stays on the
carriageway, (3) collision against `traffic.js` vehicles — they currently do
not know the player exists, (4) enter/exit at the kerb.

*Done when:* the player can drive the full corridor route unaided, a scripted
input replay produces the same end position twice (determinism), and AI
traffic yields rather than driving through the player. **Update the comment in
`corridor.js` that currently says "the car is a ride, not a drive" — it is
there to stop the code overclaiming, and it stops being true here.**

---

**3B — Doors, and walk-in interiors.** *Depends on: nothing. Independent of
3A, can run in parallel.*

Entry is `E` at a marked threshold because the building shells are solid with
no openings cut. This is the most visible remaining piece of honesty debt —
the code says so in `interiors.js`.

Do not cut 56,476 doorways. Cut them for the buildings the corridor touches
(5), then for the ~660 with subway entrances or retail ground floors. The
footprint data has the frontage; a doorway is a rectangular hole in the
extrusion at ground level on the street-facing wall.

*Done when:* the player walks into the HQ lobby and the market without a
keypress, the frame-check occlusion test (§0.2) shows no geometry in the
camera's face at the threshold, and the collider has a real opening — verified
by the walk test in `controls.js`, not by looking.

---

**3C — Night, and lit windows.** *Depends on: 2O. Highest visual return per
hour of work in this list.*

`weather.js` has a 9-key time-of-day table and `facade.js` has a `uNight`
uniform that is barely used. At night a Manhattan facade is a sparse grid of
lit windows, not a dark wall. That is a shader change plus a per-building
random seed — the seed already exists in the building data texture.

Add: lit-window density varying by archetype (offices empty by 22:00,
residential does not), streetlight pools, vehicle headlights, the HQ crown
beacon already authored in `62_hq.py`.

*Done when:* a render at 02:00 and one at 14:00 differ by >40% of pixels, mean
frame luminance at night is between 0.04 and 0.15 linear, and the per-band
luminance check (§0.5) shows the ground plane lit by streetlights rather than
by ambient.

---

**3D — An objective layer.** *Depends on: 3A and 3B. This is where it becomes
a game rather than a sandbox.*

There is currently no state, no goal and no persistence. The minimum: a
mission definition format (start location, waypoints, completion test), a
runtime that tracks progress, and save/load in `localStorage`.

The hero corridor is already the first mission — it has 11 legs, entry
conditions and a terminus. Generalise `corridor.js` from a hard-coded array
into a data-driven mission runner and the corridor becomes mission 1 rather
than a special case.

*Done when:* two missions exist, defined in data rather than code; progress
survives a reload; and a headless run can complete a mission and assert the
end state.

---

**3E — Crowds that react.** *Depends on: 3A (something to react to).*

14,675 walk lanes carry pedestrians who ignore everything. Give them: avoidance
of the player and of vehicles, queueing at crossings against the existing
signal props, and entering/leaving buildings and subway entrances (the
footfall field from 2N already says where they should come from).

*Done when:* a measured collision count between walkers and the player over a
fixed 60-second replay drops to near zero without walkers freezing, and
walker density at a station entrance measurably exceeds the block average.

---

**3F — Positional audio.** *Depends on: nothing. Small.*

`audio.js` is fully synthesised and already verified by RMS and spectral
centroid. It is currently non-positional. Add a `PannerNode` per source
category, plus interior occlusion (low-pass when indoors — the room state is
already tracked in `interiors.inside`).

*Done when:* the OfflineAudioContext verification is extended to assert
left/right asymmetry for an off-centre source, and indoor spectral centroid is
measurably lower than outdoor for the same scene.

---

**3G — Mission Control, when there is something real.** *Depends on: a real
data source existing.*

Floor 45's video wall and all 28 monitors are dark by rule — see §2. **Do not
put invented telemetry on them.** If a live source appears, drive them from
it and keep an explicit, visible offline state. This item may correctly stay
undone forever.

---

**3H — Ship it.** *Depends on: 2O.*

There is no production build path. `vite.config.js` serves world data straight
out of the repo via a dev-only middleware, and the `/__capture` evidence sink
is dev-only too. A real deploy needs: an asset bundling step, a CDN-shaped
directory layout, a load-time budget, and a first-paint strategy better than
the current boot bar.

*Done when:* `npm run build` produces a deployable directory, measured
time-to-interactive on a cold cache is recorded, and the ODbL attribution is
verified present in the production bundle — that is a licence obligation, not
a nicety.

---

**Suggested order for a single worker:** 2O → 3C → 3B → 3A → 3D → 3E → 3F →
3H. That front-loads the two cheapest visual wins (night, doors), then the
expensive one that everything else needs (driving), then the layer that turns
it into a game.

### P3 — Data gaps worth filling, at any time

- **Bus stops.** Shelters are currently placed by a carriageway-width proxy
  (`SHELTER_MIN_W = 17.5`). MTA GTFS `stops.txt` would place them properly.
- **Building heights for the 270 NTA-orphans** and the zoning-modelled ones.
- **Citywide expansion** beyond Manhattan is *not* started. The outer boroughs
  exist as context massing only (`source_data/context_buildings.json`, 93 MB) —
  no streets, walk network, props, crowd or traffic. LION (`inkn-q76z`) covers
  all five boroughs, so the pipeline would extend, but it is a large job and
  the owner has not asked for it yet. **Do not start it without asking.**

---

## 4. Conventions and traps

Hard-won. Ignoring these will cost you hours.

**Coordinates.** Local tangent plane, `LAT0=40.7800`, `LON0=-73.9680`,
`M_LAT=110574.0`, `M_LON=111320·cos(LAT0)≈84335`. Blender→glTF maps
`(x,y,z)_blender → (x, z, -y)_gltf`. In the browser: `world.x = x_m`,
`world.y = height`, `world.z = -y_m`. **Apply that swap exactly once, through
an object's own matrix** — hand-derived trig put a camera outside a building
facing away (P2-056). Every placer uses a `local(bx,by,bz)` helper for this;
copy it, don't reinvent it.

**Authored room frame.** Origin on the floor at the middle of the entrance
wall, `+x` into the space, `+y` left, `+z` up. Vehicles differ: origin on the
road surface at the middle of the car, `+x` forward.

**Ground planes.** `LAND_LEVEL = 12.0`, `ROAD_Z = 12.05`, `KERB_H = 0.15`,
`WALK_Z = 12.20`. Tile 1400 m, sector 800 m, cell 200 m.

**Traps that have already bitten:**

- `mesh.validate()` silently drops duplicate and degenerate faces, so per-loop
  colour arrays written before it end up the wrong length. Every `to_object()`
  has an explicit guard — keep it.
- The glTF exporter **flips V**: `v_gltf = 1 - v_blender`.
- `COLOR_0` alpha is the paint mask (1 = tint per instance, 0 = keep authored
  rgb), but three multiplies it into opacity when `USE_COLOR_ALPHA` is
  defined — alpha 0 makes a mesh invisible in a transparent material (P2-049).
- Draco quantises `_BID`, so it decodes as `34686.0039`. Always `Math.round()`
  before using it as a key (P2-060).
- `oneway` in the street graph is **tri-state**: `1` = a→b, `-1` = b→a, `0` =
  both. Treating it as a boolean strands 4,271 of 11,395 drivable edges
  (P2-066).
- Manhattan's grid is ~29° off the world axes. Anything that pushes along
  world axes instead of surface normals will be wrong (P2-061), and anything
  that picks by distance-to-centre instead of distance-to-nearest-edge will be
  wrong (P2-045, P2-065).
- An oscillator connected to an AudioParam is **summed** into it, not
  multiplied — use a series gain node (P2-052).
- `export_texcoords=True` is required or the limb rig is dropped;
  `export_attributes=True` or `_BID` is dropped.
- `.gitignore`'s `exports/*.glb` is single-level and does not reach
  subdirectories.
- No `pyproj`, no `numpy`. Pure stdlib Python by design. `scripts/phase2/nysp.py`
  inverts EPSG:2263 by hand and round-trips to 2×10⁻⁸ m.

**Disk.** The E: drive filled to 0 bytes during this session and truncated a
data file mid-write. Check `df -h .` before any large build. `blend/`,
`playblasts/`, `renders/`, `archive/` and `exports/*.glb` are all gitignored
and regenerable; the two 302 MB `manhattan_world*.blend` files are the
expensive ones.

---

## 5. Working agreement

The owner's standing instruction across this whole project has been: **work in
Blender, and actually finish the prompt.** Concretely, that has meant every
iteration includes real authoring work in Blender rather than only runtime
code, and that phases get completed rather than sampled.

Each unit of work has landed as: author in Blender → wire into the runtime →
**verify by measurement** → capture evidence → append to
`docs/qa/PHASE2_BUG_LEDGER.csv` → commit with the measurements in the message.
The ledger is the project's memory; a defect that isn't in it didn't happen.

Report what is true. If tests fail, say so with the output. If a phase is
unstarted, name it. The build's own credits panel calls it "not photoreal and
not a finished game" — that sentence should stay accurate at every commit.
