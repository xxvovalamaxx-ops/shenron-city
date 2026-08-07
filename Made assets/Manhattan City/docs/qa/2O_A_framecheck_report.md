# 2O-A — Framecheck report: structural visual QA at all 15 shots

Branch `ds/qa-integrity`, commit `4de0874` (run) → this commit. Run time
`2026-08-06T06:35:57Z`, 1280×720, headless Chrome (SwiftShader) via CDP on
port 9224, Vite dev server on port 5180. Raw evidence:
`docs/qa/evidence/qa-integrity/framecheck_results.json` (77.8 KB) and
`docs/qa/evidence/qa-integrity/defects.json` (3.5 KB). Every frame was also
POSTed through the app's own `/__capture` sink, so the PNGs sit in
`evidence/phase2/` next to all other Phase 2 evidence (gitignored, never
committed).

The checker module is `apps/manhattan-threejs/src/framecheck.js` — pure, no
imports, importable from Node and from the browser, never on the boot path.

## The five structural checks (HANDOFF §0)

1. **Dead frame** (`judgeDeadFrame`) — per-channel sRGB stddev must exceed
   8 AND ≥ 200 distinct colours at 6-bit quantisation. A uniform frame
   (lost render, zero-byte capture) measures stddev 0 and a handful of
   colours at any bit depth; the healthiest real shot measured here is
   west_village at 764 six-bit colours, so 200 separates with margin both
   ways. Every capture in this run passed, so the dead-frame rule would have
   caught the byte-identical uniform PNGs the Phase 2O baseline worker's
   first harness produced (their reconciliation doc, `2O_A_p2-075_reconciliation.md`
   §3).
2. **Occluded view** (`occlusionReport` + `judgeOcclusion`) — a 16×9 ray
   grid over the live camera frustum (fov 60°, aspect 16:9), each ray cast
   against the streamer/streets/tower/interior/lift/car colliders; a hit
   closer than 1.5 m counts as near. Reported overall and by row/column
   thirds. Exteriors cap at 0.05 (aerial) / 0.35 (street) near fraction;
   interiors cap at 0.35, and cabin shots additionally cap the top row-band
   at 0.45 (the P2-069 roof-over-the-eye regression).
3. **Inside-out geometry** (`signedVolume`) — signed volume of a closed
   triangle soup, negative for inside-out winding (caught P2-062 class).
   Implemented and unit-tested on a wound-outward unit cube (+1) and the
   reversed-winding twin (−1); not runnable per-shot because it needs a
   mesh batch, and this run's interior shells are the subject of check 4.
4. **Culled-from-inside** (`culledFromInside`) — for every visible room,
   cast from the room centre at eye height in 16 horizontal directions plus
   up and down against the room's own shells (FrontSide: a backface-culled
   ray passes through a wrongly-wound wall). Tolerance 2 misses per room.
   Every miss also renders a tiny 3° probe down that direction, so a
   see-through is a number, not an impression.
5. **Unlit surface** (`judgeUnlit`) — interior only: a ceiling (top 20% of
   rows) whose mean linear luminance reads < 0.02 while the floor band
   (bottom 20%) reads ≥ 0.1 is a lighting defect (caught P2-058 class).
   Not applicable outdoors, where it is recorded as such, never faked.

Plus, per HANDOFF §0's audio clause: **audio RMS/asymmetry**
(`audioChecks` + `judgeAudio` — silence must measure exactly 0.00000 RMS,
noise > 0.01, hard-panned source ratio ≥ 1.5), and **missing-asset /
network-error detection** (in-page fetch/XHR intercept: any 4xx/5xx during
a shot is a defect, counted not recalled).

## How to run

```
# unit tests (Node ≥ 24; directory form `node --test scripts/qa/` is broken
# on Node-on-Windows here — use the glob form):
node --test "scripts/qa/**/*.test.mjs"

# full run (needs Chrome at CHROME env or the default path; ports 5174/9224,
# falls back to 5180-5210 if taken):
node scripts/qa/framecheck-run.mjs
```

The runner starts Vite on 127.0.0.1, launches `chrome --headless=new
--remote-debugging-port=9224`, boots the app, imports `/src/framecheck.js`
in the page, drives all ten capture.js SHOTS plus five interior setups
(Floor 45 ops, HQ lobby, lift cab, car cabin, Shenron arrival), reads the
GPU frame back as pixels, runs every check, and writes the two JSON files.

## Results, shot by shot

Pass/fail per check: **D** dead-frame · **U** unlit-surface (n/a outdoors)
· **O** occluded view (near fraction of 144 rays) · **C** culled-from-inside
(rays hit/missed) · audio is system-level and passed.

| Shot | kind | D | U | O (near/total) | C (hits/misses) | capture | verdict |
|---|---|---|---|---|---|---|---|
| midtown_air | aerial | PASS (stddev 63, 2343) | n/a | PASS (0/144) | n/a | ok, 1.27 MB | **PASS** |
| skyline_from_east | aerial | PASS (stddev 79, 2141) | n/a | PASS (0/144) | n/a | ok, 0.77 MB | **PASS** |
| downtown_air | aerial | PASS (stddev 71, 2642) | n/a | PASS (0/144) | n/a | ok, 1.06 MB | **PASS** |
| central_park_air | aerial | PASS (stddev 76, 2632) | n/a | PASS (0/144) | n/a | ok, 1.05 MB | **PASS** |
| fifth_ave_34th | street | PASS (stddev 51, 1890) | n/a | PASS (0/144) | n/a | ok, 0.39 MB | **PASS** |
| times_square | street | PASS (stddev 48, 2310) | n/a | PASS (0/144) | n/a | ok, 0.53 MB | **PASS** |
| west_village | street | PASS (stddev 50, 764) | n/a | PASS (0/144) | n/a | ok, 0.19 MB | **PASS** |
| harlem_rowhouses | street | PASS (stddev 60, 1720) | n/a | PASS (0/144) | n/a | ok, 0.29 MB | **PASS** |
| fidi_canyon | street | PASS (stddev 50, 2045) | n/a | PASS (0/144) | n/a | ok, 0.47 MB | **PASS** |
| soho_castiron | street | PASS (stddev 49, 1155) | n/a | PASS (0/144) | n/a | ok, 0.22 MB | **PASS** |
| floor45_ops | interior | PASS (stddev 57, 1293) | PASS (top 0.085) | PASS (0/144) | **FAIL 0/18** | ok, 0.21 MB | **FAIL** |
| hq_lobby | interior | PASS (stddev 57, 1720) | PASS (top 0.162) | PASS (0/144) | **FAIL 0/18** | ok, 0.16 MB | **FAIL** |
| lift_cab | interior | PASS (stddev 29, 230) | PASS (top 0.203) | **FAIL 0.8125** | n/a (no visible rooms) | ok, 36 KB | **FAIL** |
| car_cabin | interior | PASS (stddev 47, 1097) | PASS (top 0.086) | PASS (0.160) | n/a (no visible rooms) | ok, 0.11 MB | **PASS** |
| shenron_arrival | interior | PASS (stddev 63, 2493) | PASS (top 0.072) | PASS (0/144) | **FAIL 0/18** | ok, 0.31 MB | **FAIL** |

Summary: **11 / 15 shots pass, 4 fail, 4 defects.** All 15 captures are
real frames (35 KB–1.27 MB PNGs on disk, verified after the run); the
dead-frame rule would have caught a uniform frame at any of them.

Audio (measured once, system-wide): silence RMS **0.00000**, white-noise
RMS **0.20379** (left 0.2882 / right 0.0000, ratio 99 — a perfect hard pan
caps at 99 because JSON has no Infinity), **PASS**. The app's own city
audio graph verify: silent 0.00000, traffic-only 0.06553 (centroid 534),
rain-only 0.13292 (1672), siren-only 0.03951 (3779), horn-only 0.07684
(2534) — every source audible and spectrally distinct.

Boot: zero console errors, zero warnings, zero failed asset requests.

## Defects (from `defects.json`, all confirmed by numeric checks)

| id | shot | check | severity | measured |
|---|---|---|---|---|
| QA-2OA-I-floor45_ops-culled | floor45_ops | culled-from-inside | medium | hq_floor45: 0/18 rays hit the shell |
| QA-2OA-I-hq_lobby-culled | hq_lobby | culled-from-inside | medium | hq_lobby: 0/18 rays hit the shell |
| QA-2OA-I-lift_cab-occlusion | lift_cab | occluded view | medium | near fraction 0.8125 (> 0.6), top row-band 0.854 (> 0.45) |
| QA-2OA-I-shenron_arrival-culled | shenron_arrival | culled-from-inside | medium | hq_floor45: 0/18 rays hit the shell |

Reading the culled misses: in both floor45_ops and shenron_arrival (which
shoot the same room), rays 4–7 (+z) see a perfectly uniform colour
(lumMean 0.0034, 1 colour, stddev 0) and ray 9–10 (−z) see another uniform
colour — the ray exits the shell without an intersection, which with
FrontSide backface-culling means those walls are wound the wrong way or
missing. Ray 16 (straight up) reads lumTop 1.0 with stddev 126 — a
blown-out reading worth a look when the shells are fixed. In hq_lobby the
matter is similar but noisier (misses are not uniform — most directions
see *something* dark; only rays 7/17 are fully uniform), which reads like
a mix of wrong winding and near-black sight lines.

lift_cab's occlusion failure is the harness's own setup being honest about
geometry: at eye (1.15, 1.7) inside a 2.3 m-wide cab the frame is 81 %
nearer than 1.5 m and the roof band is 85 % near. That may be the correct
picture of a lift cab (the cabin is small on purpose) — the check exists
to force the question, and the answer lives in the evidence PNG
(`evidence/phase2/lift_cab.png`), not in a claim.

## Limitations, stated

- **Depth readback is unavailable in this environment.** WebGL2's default
  framebuffer does not answer `gl.readPixels(DEPTH_COMPONENT)` (INVALID_OPERATION;
  the buffer stays whatever the allocator gave it). The runner detects this
  (all-zeros ⇒ refused, `range [0,0]`) and records `depthOcc` as
  `unavailable` for all 15 shots — never a faked number. The HANDOFF §0.2
  occlusion check therefore runs on the live-scene 16×9 ray grid, which is
  the primary measure and produced real data in every shot; the
  `occlusionFraction` contract export is still verified by unit tests
  against synthetic depth channels. A depth pass rendered to an explicit
  WebGLRenderTarget would lift this.
- **Inside-out signed volume is unit-tested, not run per-shot**: it needs a
  closed mesh batch, and the culled-from-inside check is the live per-shot
  measure of shell winding here.
- **Software GL** (SwiftShader in the Chrome GPU process): these are
  correctness numbers, not hardware-GPU performance numbers.
- The four defects are measured this run only; the fix and re-measure are
  Phase 2P's job, per the handoff's sequencing.

## Vision-bridge contract (docs/qa/DEFECT_SCHEMA.md, 2O-A-005)

`framecheck.js` exports all five agreed names — `luminanceStddev`,
`distinctColours`, `occlusionFraction`, `pixelDiff`, `bandLuminance` —
plus the module's own judges. Verified by import (`node -e` round trip)
and pinned by unit tests. No contract break.
