# Phase 3B — doors, and walk-in interiors

Status: **the five corridor rooms pass, 4/4 doorways. Gate 1 closed.**
Evidence: `docs/qa/evidence/phase3b/doors.json` (4/4, generated 2026-08-07).

This is the plan and the ledger for Phase 3B of the roadmap in
`docs/phase2/HANDOFF.md`. The claim it replaces is the one that opened
`interiors.js`: *"Entry is an explicit action rather than walking through the
facade. The building shells are solid collision geometry with no door openings
cut into them."* That sentence is now false for four buildings and still true
for the other 56,472, and the comment says so.

## The five corridor rooms

The hero corridor's five rooms sit in four buildings (the penthouse and the
home lobby share Central Park Tower; Floor 45 shares the HQ with its lobby).
`scripts/phase2/68_build_doors.py` writes them into
`data/manhattan/doors/doors.json`; the runtime reads that file and nothing is
hard-coded. The four doorways:

| key | bid | building | kind | wall cut | glaze kept | walk-in |
|---|---|---|---|---|---|---|
| `home_lobby` | 20263 | Central Park Tower, 225 W 57th | `wall` | 2 faces | 12 tris | 43 frames, max jump 0.161 m |
| `bodega` | 14513 | mixed-use block, 6th Ave | `wall` | 2 faces | 6 tris | 43 frames, max jump 0.161 m |
| `tower_lobby` | 19990 | The Torch, 740 8th Ave | `wall` | 2 faces | 12 tris | 43 frames, max jump 0.161 m |
| `hq_lobby` | 34686 | the HQ podium | `recess` | 6 faces | 12 tris | 43 frames, max jump 0.157 m |

The bodega's OSM footprint is block-sized and overlaps an adjacent school
footprint (bid 14438), so its default street frontage is concealed by the
school's wall. The pipeline detects that (an approach-clearance ray) and
rotates the room to the next clear wall — a doorway that opens onto a
neighbour's wall is worse than no doorway. Whatever remains *inside* the
passage is cut too (§ the passage cut).

**The `recess` kind was a false premise.** The first pass took the HQ podium's
"authored entrance recess" on trust and skipped the wall cut. Measured, the
podium front is solid across the whole frontage — rays at 1 m spacing from
−4 m to +4 m along the wall all hit `HQ_tower` at the same depth, at every
height from 0.3 to 2.2 m — and it sits 0.40 m from the room origin, not the
5.0 m the code assumed. So the assembly and the crossing plane stood 4.5 m out
in the open plaza with the real wall untouched behind them. A recess is now
cut like any other wall (P2-082).

## The doorway pipeline (`apps/manhattan-threejs/src/doors.js`)

For every configured doorway, in order:

1. **The frontage.** Candidate ground-band wall faces of the building, nearest
   first, rejecting any whose approach is concealed by a neighbour. The room
   rotates to face the chosen wall, and because rotating moves the door axis
   and can change which wall is nearest, resolve-and-rotate repeats until the
   two agree (`FRONTAGE_PASSES`).
2. **The seat.** The room is shifted so its glazed wall sits `WALL_GAP` inside
   the frontage, then the wall is re-resolved **by ray, from the room's final
   position**, against the face the player will actually walk into. The
   residual is reported: 0.350 m at all three wall doorways, exactly
   `WALL_GAP`. Getting here took three separate fixes (P2-083) — the shift ran
   the wrong way along the door axis, the rotation and the shift used
   different walls, and the plane projection landed off the plane by the whole
   wall distance.
3. **The wall cut.** The building's wall faces in its baked tile mesh are
   triangles whose vertices carry the building's `_bid`. For each face that
   belongs to the building, lies within the door box and the depth band, is
   roughly parallel to the wall, and overlaps the door rect in the wall's own
   (u, v) frame, the rect is subtracted exactly (2D convex-polygon minus
   rectangle, `doors-math.js`) and the remaining pieces are re-emitted with
   their original winding. The walk collider probes the actual tile meshes
   (`controls.js` rays), so a real hole in the mesh is a real hole in the
   collision — no hit filter, no fake doorway. The cut is re-applied if the
   tile streams out and back in.
4. **The glass cut.** The same rectangle is subtracted from the room's glazed
   entrance wall, in the glaze's own (along-wall, up) frame. `interiors.place`
   clones room geometry per instance, so one cut cannot leak into another room
   that reuses the same authored mesh (the tower lobby and the HQ lobby share
   `INT_lobby`).
5. **The assembly.** Frame (jambs, header, sill, header track), an automatic
   sliding leaf (metal frame, glazed pane, push bar — slides along the wall
   and parks beside the opening, the honest version of an automatic door where
   no pocket exists in a cut opening), and a lit ceiling panel over the
   threshold. All procedural, in the authored interiors' palette: no
   third-party asset enters the build (see § Asset discipline). It hangs off a
   child group carrying the authored-frame rotation, and `_assemblyMetrics()`
   reports leaf height, leaf width and lit-panel height so "is it standing up"
   is a number, not a look.
6. **The state machine.** `closed → opening → open → closing → closed`, driven
   by a trigger volume spanning −5.0 to +2.6 m about the door plane — the
   street side *and* the room side, because a door that only senses the street
   shuts behind whoever walked in. Leaf travel is 1.1 s open / 1.6 s close
   (1.6 m/s), which beats a walking player across the sensor's reach. Plus a
   dwell after the player leaves, an obstruction test (a closing door that
   would hit the player reopens), a pause freeze (`document.hidden`), and
   persisted state in `localStorage` (`manhattan.doors.v1`) restored on boot.
7. **The crossing.** When the player walks through the wall plane inside the
   bay, `interiors.inside` flips physically — the camera never jumps. Walking
   back out reverses it. Rooms with a doorway no longer answer the E key (a
   teleport standing next to a real door is a lie).
8. **Interior zone preloading.** Within 9 m of the threshold the room group
   becomes visible and the interior lamp ramps up before the player crosses,
   so the opening frames a lit interior, never a black void.
9. **Lift links are rides.** E at a lift bank rides the corridor's own cab
   between the rooms (lobby ↔ Floor 45, home lobby ↔ penthouse) instead of
   teleporting.

### The room frame, and why it is worth a section

`doors.js` is written in the **authored** room frame — `+x` into the room,
`+y` left along the entrance wall, `+z` up — the frame `60_interiors.py`
builds in and HANDOFF §4 documents. That is *not* the room group's own local
frame: the glTF exporter maps Blender `(x, y, z) → (x, z, -y)`, so the group's
axes are `(x into, y up, z along the wall)`, and `interiors.place()` keeps the
conversion in exactly one place, `room.local()`.

The first pass of this phase applied that swap **zero** times — P2-056 again.
Measured on all six rooms, `room.local(0,0,1.7)` and
`group.localToWorld(0,0,1.7)` differ by exactly **1.70 m of height**, so "1.7 m
up" became 1.7 m sideways: every walk-in approached the wall 1.70 m to the
side of a 2.20 m opening, 0.60 m past its edge, and was stopped by uncut wall.
Nothing behavioural caught it — the doors still cycled, the triggers still
fired, the interior still preloaded.

Authored coordinates now cross into group space through `authToLocal()` and
back through `localToAuth()`, and nowhere else; the assembly gets the same
swap as one `-90°` rotation about x. `scripts/qa/door-cut.test.mjs` guards it
with pure arithmetic — including the assertion that the two readings differ by
exactly the eye height at every yaw the corridor rooms use.

### The passage cut

Some footprints in the OSM data overlap their neighbours by a metre or more,
so the doorway volume may contain another building's wall just inside the
target's own. The sweep applies the same exact rect subtraction, in the same
wall frame, to the *other* buildings' faces — inflated by 0.15 m so a
non-parallel neighbour leaves no slivers — plus a containment sweep for faces
that cannot be rect-subtracted.

It used to be a blunt AABB-overlap sweep, which is far too coarse against
merged tile geometry: a neighbour's wall quad runs ground to roof, so whole
facades went, and the four exact pieces around the fresh hole have AABBs
touching the box too, so the careful cut was immediately blown out (P2-087). A
depth band and a per-triangle AABB keep the cut local — without the band the
wall frame is an infinite plane, and since Manhattan's facades are all
parallel, a door rect punches phantom doorways down the whole block.

At the market: 4 faces of the neighbouring school cut, 1 contained triangle
removed, nothing else. Probe blocked 15/15 rays → 0/15.

## Interior audio transition (`audio.js`)

The layer sum runs through a room bus: a low-pass and a gain that follow the
player's indoor blend (0 outdoors, 1 in a room, 0..1 in a threshold), plus a
low HVAC hum that only exists indoors, plus a synthesized door swish for the
automatic doors. All still oscillators and noise — nothing to license.

Measured on the last run, through the real audio graph in an
OfflineAudioContext: **RMS 0.05844 → 0.02645** outdoors → indoors (a 55% drop),
**spectral centroid 744 → 659 Hz**. The single-bin 1.5 kHz magnitude is *not* a
reliable signal — it moved 3.411 → 4.237 on this run and the other way on
others, because the street mix is stochastic and one FFT bin of it is noise.
An earlier draft of this document claimed a tyres-band cut; the RMS and
centroid numbers are the ones that hold up.

## Asset discipline

The HANDOFF's rules apply unchanged, plus the owner's standing instruction for
Phase 3: *use approved interior assets only after asset-registry and visual
review; do not choose final hero art without approval.*

This phase adds **zero** new assets. The door frames, leaves, track and lit
panel are procedural boxes in the same palette the interiors are already
authored in, and the only glazed material is the runtime's existing interior
glass. No third-party kit, no scanned geometry, no photographed textures, so
there is nothing to take to asset review and no hero art has been chosen.

When exterior door art is replaced with reviewed production assets, it drops
into `_buildAssembly` without touching the cut, the collider or the state
machine — `_assemblyMetrics()` is the check that a swapped-in leaf is still
the right way up. That swap is a separate decision and needs the owner's
approval and a registry entry first.

## The expansion path (~660 buildings)

The HANDOFF's "approximately 660" is the **subway tranche**: 658 entrance
kiosks in `data/manhattan/subway/subway.json`, and every registry building
within 30 m of one. Measured: **631 buildings** (284 at 20 m, 480 at 25 m,
1,053 at 40 m). That is the number the HANDOFF is approximating and it is what
`68_build_doors.py --expansion` emits by default.

The retail-ground-floor set is a different, much larger tranche — 12,834
buildings, union 13,125 — so it sits behind `--include-retail` rather than
being folded in. Emitting 13,125 rows under a heading that says "~660" is how a
20× scope overrun gets waved through (P2-090).

Each entry carries the building id, the world anchor the runtime would resolve
a wall from, the frontage yaw measured off the street graph (631/631 have
one), the distance to the nearest kiosk and the ground-floor archetype.

**It is not wired into the runtime, and it cannot be by accident.** It writes
to `doors_expansion.json`, not the `doors.json` the runtime reads, and it is
stamped `runtimeEnabled: false`, which `doors.load()` refuses outright. An
entry with no interior room cuts nothing either way — an entrance with no room
behind it is a hole into a solid building. (Both modes used to write the same
file; generating the expansion set would have handed the runtime ~660 such
holes — P2-089.)

The gate for switching it on:

1. the corridor doorways pass their acceptance checks — **done, 4/4**;
2. the interior pipeline produces ground-floor rooms for a first batch of
   subway-adjacent retail buildings — **not started**;
3. the runtime's `entrance` kind resolves an interior when one exists and
   stays a closed door when it does not — the "stays closed" half is done and
   measured; the "resolves an interior" half waits on (2).

Do not attempt the 631 before (2).

## Acceptance checks (what "done" means)

The headless runner `scripts/qa/doorcheck-run.mjs` drives the real app in
headless Chrome over CDP and measures, per doorway. Last run: **4/4 passed,
0 console errors, 0 failed requests, 92 s.**

| check | threshold | measured |
|---|---|---|
| the opening is real (render) | 0 of 15 rays blocked | 0/15 at all four |
| the walk collider lets the player through | crossed, and inside | 43 frames, inside at all four |
| no teleport on the way in | max per-frame jump < 0.5 m | 0.157 – 0.161 m |
| reverse traversal exits | crossed, and outside | true at all four |
| the door cycles and reopens on obstruction | 2 opens, 1 close, reopen | true at all four |
| the interior preloads | room visible, lamp > 0.2 | visible, 0.55 |
| the threshold frame is not dead | stddev > 8, colours > 100 | stddev 47.2 – 65.9, colours 1,629 – 5,586 |
| no black void | mean luminance > 0.04 | 0.068 – 0.122 |
| nothing in the camera's face | near-field fraction ≤ 0.35 | 0.00 at all four |
| the walk is deterministic | identical trace under fixed dt | identical, twice, at all four |
| pause freezes the machine | progress unchanged | 0.20 → 0.20 |
| door state survives a reload | restored from localStorage | 2 doors restored open |
| the audio transition is real | RMS and centroid drop indoors | RMS 0.058 → 0.026, centroid 744 → 659 Hz |

Two honest caveats:

- The reverse-traversal check asserts crossing and exit but **not** the 0.5 m
  jump budget the forward walk is held to. The HQ's reverse walk measures
  0.623 m, which is the step down off its 0.60 m podium plinth. Real, and
  within `STEP`, but it would fail the forward budget.
- The `dead-frame` rule's 200-colour floor (6-bit) was calibrated on wide city
  shots; a doorway close-up is a deliberately narrow view, so the frame
  judgement uses the rule's other signals plus a luminance floor. That
  substitution is the runner's, and it is spelled out in `frameOk`.

Unit tests for the cut math live in `scripts/qa/door-cut.test.mjs`
(`node --test scripts/qa/door-cut.test.mjs`, 26/26). Three of them are
geometry-level: they raycast the rebuilt BufferGeometry rather than checking
polygons, because the polygon math was correct and unit-tested throughout
while the index bookkeeping that turned it back into a mesh was not — that bug
(P2-079) scattered garbage triangles back across every opening and was worth
3 of the 4 doorway failures on its own.
