# Task board — Opus takeover

Branch `opus/hero-corridor-v1`. Order is the brief's: Stage 0 must be committed
and green before hero content begins.

Status vocabulary: **done** means measured, with an evidence path. **partial**
means some of it is measured and the rest is named below. Everything else is
not started, and no claim is made about it.

## Stage 0 — repair the current truth

- [x] **0A.1** Fix the low-FPS percentile bug — `5fee2dd07`
      · proof `evidence/opus/performance/percentile-bug-proof.json`
      · 14 tests `scripts/benchmarks/lib/stat.test.mjs`
- [x] **0A.2** Invalidate the old low fields in code and baseline (44 renamed)
- [ ] **0A.3** Regenerate the baseline against current HEAD — needs a real
      benchmark run per preset; nothing may quote a low until this lands
- [ ] **0A.4** Archive the retired-HQ benchmark scenarios properly. The
      `manhattan` arm of `run.cjs` throws with an explanation and the 12 stale
      runs are flagged in the baseline; the scenario definitions themselves
      (`elevator`, `zone`) still sit in `lib/locations.cjs`
- [x] **0B.1** Ordered simulation authority, declared stages — `52dae450e`
      · 19 tests `src/gameplay/simulation.test.ts`
- [x] **0B.2** City advances from the authority's `city` stage — `ee58bf966`
      · A/B headless, 3x500 frames: 100.1 -> 100.0 avg fps, 86.5 -> 86.1 1% low
- [x] **0B.3** One frame clamp; six hand-written copies retired — `b18c5dddd`
- [ ] **0B.4** Move the remaining nine useFrame callbacks onto declared stages.
      Their order is still JSX mount order
- [x] **0B.5** Promotion/demotion between the two representations — `ed675d9b0`
      · 23 tests incl. a differential test against the shipping renderer
      · one live representation at a time, asserted by countRepresentations
      · NOT a merged registry: LION's lane-space form is correct for 700 cars
        and Phase 3A's world-pose form is correct for the one being driven
- [ ] **0B.6** Wire the handoff into the enter/exit path in vehicle-control.ts.
      Until this lands, entering a city car still spawns a duplicate
- [x] **0C.0** Audit — `docs/opus/LIGHTING_AUDIT.md`, commit `b5457c074`
- [x] **0C.1** Clock-aware `scene.environment`; one shared night curve —
      `18b38e540` · measured 0 at midday, 0.1 at dusk, 0.2 at night
- [x] **0C.2** Runtime assertion — `1a71a930a` · `window.__materialCensus()`
      · 382 meshes, 14 tiers, 0 errors; 18 errors when the road bug is put back
      · 17 tests; checks the material/geometry contract, not just bindings
- [x] **0C.3** SkyRig deleted (unreferenced, superseded); ManhattanCity's
      `mode` default flipped from the dead `'full'` path to `'tiles'`.
      `getBuildingNightMaterial` kept — it belongs to the `'full'` fallback,
      which is not the same as dead
- [x] **0D** Runtime resource defects in VehicleRig — `e182db3ae`
      · per-frame geometry/material construction inside useFrame, removed
      · shared pedestrian pair disposed per mesh, killing survivors' buffers
      · vehicle despawn leaked ~8 geometries + ~6 materials per car
      · 13 tests incl. 100 spawn/despawn cycles and repeated entry/exit
- [x] **0D.2** Crowd and props presentation — `78a607ef5`
      · `pedestrians.js _render()` built an Object3D + Color every frame
      · `props.js` the same pair per rebuild
      · `vehicles.js` checked and left alone — its allocation is in `load()`
      · `traffic.js` has the same shape but belongs to OPUS-007; reported only
- [x] **0D.3** `scripts/qa/leakcheck.mjs` — samples WebGLRenderer.info.memory
      · 2000 frames, geometries 181→181, textures 33→33, 0 console errors
      · control-validated: a per-frame leak gives 1111→2234, exactly 1/frame
- [x] **0E.1** Gate missing texture dependencies — `e83c49a38`
      · 442 models scanned, 0 unresolvable; exit 1 on a rebuilt pre-fix model
      · verified in the running game: 5 console errors → 0
- [x] **0E.2** Every runtime URL gated — `5cda60045`
      · 496 URLs: 250 from source, 426 from generated manifests
        (246 LOD + 119 building tiles + 61 street tiles)
      · control-validated: hiding one street tile and one LOD file fails it
      · 2 runtime-built URLs reported as unresolvable rather than implied
      · found OPUS-010: manhattan-tiles.ts is generated and imported by nothing
- [ ] **0E.3** Fail on raw placeholder primitives visible in a hero scene
- [ ] **0F** Full CI green including `npm audit` and the browser smoke test.
      Locally green now: typecheck, lint, 335 tests, asset verify, build

## Stage 1 — hero-cell architecture

Complete. A named building id can be replaced by authored geometry, and every
claim in the brief is measured rather than argued.

  Building-ID override layer — `src/world/hero-cells.ts`, 42 unit tests.
  Suppression confined to the correct streaming cell — a tile is several meshes
    (`BLD_<tier>_<tx>_<ty>_<part>`) and a building spans more than one, so the
    tile is parsed from the mesh name. Measured: 88 of 88 other meshes
    untouched.
  Authored LOD0/LOD1 in the lot — `src/world/hero-cell-loader.ts`, 16 tests.
    Load, place, register collision, and only then mark ready; suppression
    skips anything not ready, so a 404 leaves the generated building standing
    instead of leaving a hole. LOD switching runs on the presentation stage
    with 10% hysteresis.
  Removal restores the original — the pre-suppression index is kept on the
    geometry's own userData. Measured: 626 triangles -> 0 -> 626.
  Coherence, all five measured across a swap:
    collision      buildingTopAt 230 m at the tower centre; the lot itself
                   null -> 8.175 m; 96 -> 100 colliders
    navigation     212,288 ground triangles, unchanged
    traffic        25,468 LION lanes, unchanged
    address        name and address resolve identically
    save state     the persisted bytes are byte-for-byte identical
  Acceptance harness — `scripts/qa/herocellcheck.mjs`, target chosen by reading
    loaded geometry, with a missing-asset control that must change nothing.

Verified end to end against real authored geometry (`/models/manhattan/hq.glb`,
4 meshes, 4,682 triangles) standing in building 31416's lot.

## Stage 2 — production assets

In progress. The hero vehicle is most of the way there; the character and
environment tiers have not been started.

Hero vehicle — original unbranded sportback, authored in Blender, no branded or
ripped source anywhere in its history:

- [x] Four LOD tiers on disk, `public/models/vehicles/sportback_lod{0..3}.glb`
- [x] Runtime contract written before the art — `src/world/vehicle-asset.ts`
      (`VEH_` prefix, wheel/steering/door slots, `applyVehicleState`)
- [x] Pool with shared geometry and per-car materials — `vehicle-asset-pool.ts`
- [x] Orientation and tier agreement gated — `scripts/qa/vehicleassetcheck.mjs`
      · found the Blender car facing backwards, and LOD1 silently missing all
        four wheels to `GLTFLoader`'s name sanitisation (`.001` → `001`)
- [x] Door contract: hinge at the origin, swing derived from geometry
- [x] Engine audio — speed- and throttle-driven note, six-ratio gearbox,
      overrun, gated by `scripts/qa/enginecheck.mjs`
      · the gate drives a real car: real KeyE, real KeyW, no `setEngine` of its
        own. The probe that *did* call `setEngine` was overwritten by
        GameLoop's on the next frame and read a perfect pitch curve off a
        silent bus.
      · measured, on foot vs driving at 9 m/s from the same spot:
        engine level 0.0006 → 0.192, master RMS 0.0083 → 0.0268
      · control-validated by reintroducing the bug: `level` stays 0.186 and
        `placeGain` drops to 0 — an engine nobody can hear, which is why
        `placeGain` is in `diagnostics()` and why `level` alone is not a gate
- [ ] Door art in Blender (apertures + panels) — deferred, OPUS-021
- [ ] Interior

Not started: near-field character tier; four hero characters; thirteen hero
environments authored in Blender.

## Stage 3 — route-level Manhattan quality

Not started. ~120 m either side of the chosen corridor: facade depth, window
reveals, entrances, storefronts, roof equipment, kerbs, crossings, signals,
clutter — placed from Manhattan data, not scattered.

## Stage 4 — atmosphere and sound

Not started. Five presets; wetness, spray, glass and clearcoat; continuous
spatial audio across every zone of the route.

One piece of it landed early, because the engine bus could not be verified
without it: the mix now follows the listener while driving. `GameLoop` skipped
`cityAudio.update` entirely in a car, which froze the zone crossfade, the reverb
send and both tone controls at whatever street the player set off from — drive
from the boulevard to the park and the boulevard came with you. Footsteps were
what the gate was really for and are now suppressed the way a jump suppresses
them.

## Mission Control

Not started. Four explicit screen states (ONLINE / CONNECTING / OFFLINE /
SIMULATION). The standing project rule stands: never fabricate live state.

## Current blockers

None external. The work is sequenced, not blocked.
