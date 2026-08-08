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
- [ ] **0C** One facade / sky / weather / lighting authority — OPUS-003.
      First step is an audit that reports which material system is bound to
      each streamed tier at runtime, because that is currently unknown
- [ ] **0D** Runtime resource defects — `VehicleRig.tsx` per-frame allocation,
      shared-resource disposal, leak and repeated-entry tests
- [x] **0E.1** Gate missing texture dependencies — `e83c49a38`
      · 442 models scanned, 0 unresolvable; exit 1 on a rebuilt pre-fix model
      · verified in the running game: 5 console errors → 0
- [ ] **0E.2** Extend audit coverage to tiles, street tiles, LOD files, every
      runtime URL referenced from source, and hero-cell assets
- [ ] **0E.3** Fail on raw placeholder primitives visible in a hero scene
- [ ] **0F** Full CI green including `npm audit` and the browser smoke test.
      Locally green now: typecheck, lint, 335 tests, asset verify, build

## Stage 1 — hero-cell architecture

Not started. Building-ID override layer; suppression confined to the correct
streaming cell; authored LOD0/LOD1 in the lot; removal restores the original;
collision, traffic, navigation, address metadata and save state stay coherent.

## Stage 2 — production assets

Not started. Hero vehicle (original unbranded sportback, 4 LODs, interior,
animated doors/wheels/lights, audio); near-field character tier; four hero
characters; thirteen hero environments authored in Blender.

## Stage 3 — route-level Manhattan quality

Not started. ~120 m either side of the chosen corridor: facade depth, window
reveals, entrances, storefronts, roof equipment, kerbs, crossings, signals,
clutter — placed from Manhattan data, not scattered.

## Stage 4 — atmosphere and sound

Not started. Five presets; wetness, spray, glass and clearcoat; continuous
spatial audio across every zone of the route.

## Mission Control

Not started. Four explicit screen states (ONLINE / CONNECTING / OFFLINE /
SIMULATION). The standing project rule stands: never fabricate live state.

## Current blockers

None external. The work is sequenced, not blocked.
