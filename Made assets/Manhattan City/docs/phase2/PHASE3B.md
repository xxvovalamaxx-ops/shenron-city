# Phase 3B — doors, and walk-in interiors

Status: **in progress — the five corridor doorways, pipeline gate 1.**

This is the plan and the ledger for Phase 3B of the roadmap in
`docs/phase2/HANDOFF.md`. The claim it replaces is the one that opens
`interiors.js`: *"Entry is an explicit action rather than walking through the
facade. The building shells are solid collision geometry with no door openings
cut into them."* That sentence stops being true here, per doorway, in the
order this document describes.

## The five corridor buildings

The hero corridor's five rooms sit in four buildings (the penthouse and the
home lobby share Central Park Tower; Floor 45 shares the HQ with its lobby).
`scripts/phase2/68_build_doors.py` writes them into
`data/manhattan/doors/doors.json`; the runtime reads that file and nothing is
hard-coded. The four doorways:

| key | bid | building | kind | what the doorway does |
|---|---|---|---|---|
| `home_lobby` | 20263 | Central Park Tower, 225 W 57th | `wall` | cut a 2.2 × 2.5 m opening in the street-facing tower wall |
| `bodega` | 14513 | mixed-use block, 6th Ave | `wall` | cut the corner-market storefront |
| `tower_lobby` | 19990 | The Torch, 740 8th Ave | `wall` | cut the hotel's avenue frontage |
| `hq_lobby` | 34686 | the HQ podium | `recess` | the authored podium recess is already a real opening; only the assembly and the crossing logic are added |

The bodega's OSM footprint is block-sized and overlaps an adjacent school
footprint (bid 14438), so its default street frontage is concealed by the
school's wall. The pipeline detects that (an approach-clearance ray) and
rotates the room to the next clear wall — a doorway that opens onto a
neighbour's wall is worse than no doorway.

## The doorway pipeline (`apps/manhattan-threejs/src/doors.js`)

For every configured doorway, in order:

1. **The wall cut.** The building's wall faces in its baked tile mesh are
   triangles whose vertices carry the building's `_bid`. For each face that
   (a) belongs to the building, (b) faces the street, and (c) overlaps the
   door rect in the wall's own (u, v) frame, the rect is subtracted exactly
   (2D convex-polygon minus rectangle, `doors-math.js`) and the remaining
   pieces are re-emitted with their original winding. The rebuild keeps
   position/normal/`_bid`/colour attributes and re-indexes the mesh. The walk
   collider probes the actual tile meshes (`controls.js` rays), so a real
   hole in the mesh is a real hole in the collision — no hit filter, no
   fake doorway. The cut is re-applied if the tile streams out and back in.
2. **The glass cut.** The same rectangle is punched out of the room's glazed
   entrance wall (a box-AABB removal), at the mullion-free bay between the
   authored 2 m mullion grid. `interiors.place` clones room geometry per
   instance, so one cut cannot leak into another room that reuses the same
   authored mesh (the tower lobby and the HQ lobby share `INT_lobby`).
3. **The room is seated.** The room group is shifted so its glazed wall sits
   just inside the cut (WALL_GAP), or the walk-in would land the player
   inside solid building mass. If the frontage had to change, the room is
   rotated and every camera position derived from it (`eyeWorld`, `lookAt`,
   `door`, `shot`, lift links) is rebased — `interiors.rebase`.
4. **The assembly.** Frame (jambs, header, sill, header track), an automatic
   sliding leaf (metal frame, glazed pane, push bar — slides +y and parks
   against the wall beside the opening, the honest version of an automatic
   door where no pocket exists in a cut opening), and a lit ceiling panel
   over the threshold. All procedural, in the authored interiors' palette:
   no third-party asset enters the build (see §Asset discipline).
5. **The state machine.** `closed → opening → open → closing → closed`,
   driven by a trigger volume around the threshold, with a dwell after the
   player leaves, an obstruction test (a closing door that would hit the
   player reopens), a pause freeze (`document.hidden`), and persisted state
   in `localStorage` (`manhattan.doors.v1`) restored on boot.
6. **The crossing.** When the player walks through the wall plane inside the
   bay, `interiors.inside` flips physically — the camera never jumps. Walking
   back out reverses it (reverse traversal). Rooms with a doorway no longer
   answer the E key (a teleport standing next to a real door is a lie).
7. **Interior zone preloading.** Within 9 m of the threshold the room group
   becomes visible and the interior lamp ramps up before the player crosses,
   so the opening frames a lit interior, never a black void.
8. **Lift links are rides.** E at a lift bank rides the corridor's own cab
   between the rooms (lobby ↔ Floor 45, home lobby ↔ penthouse) instead of
   teleporting.

## Interior audio transition (`audio.js`)

The layer sum runs through a room bus: a low-pass and a gain that follow the
player's indoor blend (0 outdoors, 1 in a room, 0..1 in a threshold), plus a
low HVAC hum that only exists indoors, plus a synthesized door swish for the
automatic doors. All still oscillators and noise — nothing to license.
Measured: the same street mix indoors cuts the 1.5 kHz tyres band and drops
RMS (see the headless evidence).

## Asset discipline

The HANDOFF's rules apply unchanged, plus the owner's standing instruction
for Phase 3: *use approved interior assets only after asset-registry and
visual review; do not choose final hero art without approval.* This phase
adds **zero** new assets: the door frames, leaves and track are procedural
boxes in the same palette the interiors are already authored in, and the
only glazed material is the runtime's existing interior glass. No third-party
kit, no scanned geometry, no photographed textures. When the exterior door
art is replaced with reviewed production assets (the automatic-door leaf from
the shenron-city production pass is the approved candidate), it drops into
`_buildAssembly` without touching the cut, the collider or the state machine.

## The expansion path (~660 buildings)

The HANDOFF's "approximately 660" is the subway-entrance count: 658
entrances in `data/manhattan/subway/subway.json`, i.e. every registry
building within 30 m of an entrance point (631 measured) plus the buildings
with a retail ground floor (`storefront_row`/`storefront_tall`/
`storefront_wide`/`glass_lobby`; 12,856 with the entrance set).

`68_build_doors.py --expansion` generates entrance-treatment entries with
explicit world anchors from the registry (`x_m`, `y_m`, entrance yaw) under
a `kind: "entrance"` schema — the data path for the next gate. It is **not**
wired into the runtime: an entrance with no interior room behind it would be
a hole into a solid building. The gate is:

1. the five corridor doorways pass their acceptance checks (below);
2. the interior pipeline produces ground-floor rooms for a first batch of
   subway-adjacent retail buildings;
3. the runtime's `entrance` kind resolves an interior when one exists and
   stays a closed door when it does not.

Do not attempt the 660 before (1) passes.

## Acceptance checks (what "done" means)

The headless runner `scripts/qa/doorcheck-run.mjs` drives the real app and
measures, per doorway:

- the opening is real — rays through the cut rect pass where the wall used
  to be (render) and the walk collider lets the player through (walk test in
  `controls.js`, not by looking);
- no teleport — per-frame camera jumps stay under 0.5 m through the walk-in
  and the reverse traversal;
- the door cycles open/closed and reopens on obstruction;
- the interior preloads (visible room + lamp before the threshold);
- the threshold frame is not a dead frame and not a black void;
- the walk is deterministic under a fixed dt;
- pause freezes the machine; door state survives a reload;
- the audio verify measures the indoor transition (1.5 kHz band cut, RMS
  drop).

Unit tests for the cut math live in `scripts/qa/door-cut.test.mjs`
(`node --test scripts/qa/door-cut.test.mjs`).
