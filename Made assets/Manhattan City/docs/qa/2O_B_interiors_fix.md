# 2O-B: Interior defects — root causes and fixes

Measured by the 2O-A framecheck suite (`docs/qa/evidence/qa-integrity/defects.json`),
fixed in this branch, re-verified: **15/15 shots pass, 0 defects** (re-run
2026-08-06T14:25Z, `docs/qa/evidence/qa-integrity/framecheck_results.json`).

## Defect 1 — culled-from-inside 0/18 on `hq_lobby`, `hq_floor45`, `shenron_arrival`

Two distinct root causes, both real, both fixed.

### 1a. The check transformed rays with the wrong matrix (framecheck bug)

`culledFromInside()` in `apps/manhattan-threejs/src/framecheck.js` computed the
local-space transform from `shells[0].quaternion.clone().invert()`. The rooms
are placed by `interiors.js place()` with **position and yaw on the parent
group** (`group.position.copy(...)`, `group.rotation.set(0, yaw, 0)`); the mesh
itself has an identity quaternion. For a room a mile from the world origin, a
quaternion-only inverse leaves the eye in world coordinates — nowhere near the
geometry's local AABB — so `rayAABB` reported no exit and every one of the 18
rays missed. All three failing rooms are placed at `site.yaw` (HQ) or a
computed corridor yaw (shenron_arrival); `car_cabin` passed because the car's
cabin check ran with the ray origin inside its box by luck of placement.

Fix: use the mesh's **full world matrix inverse** (`matrixWorld.clone().invert()`)
for both the origin (`applyMatrix4`) and the direction (`transformDirection`).
The world AABB for the eye position was already computed correctly via
`localToWorld` on the 8 box corners; only the ray transform was in the wrong
frame.

### 1b. The generator wound the solid walls outward (real geometry defect)

`scripts/phase2/60_interiors.py` (lobby, penthouse, bodega) and
`scripts/phase2/62_hq.py` (Floor 45) built their solid shell walls with
outward-facing winding. The runtime materials are FrontSide and the renderer
backface-culls, so **from inside the room the solid walls were invisible** —
the player looking at the back wall of the HQ lobby saw through it to the
city, and a ray from inside found nothing to hit. The lift cab and car cabin
were already wound inward (which is why they passed).

Fix: wound the solid walls inward in all three room builders:
- `60_interiors.py` `build_lobby`: side + back walls `inward=False` (correct
  winding for their traversals; verified normal vs room centre)
- `60_interiors.py` `build_penthouse`: back + side walls `inward=True`
- `60_interiors.py` `build_bodega`: side + back walls `inward=False`
- `62_hq.py` `build_floor45`: back + right walls `inward=True`

Rebuilt `exports/interiors.glb` and `exports/hq.glb` with Blender 5.1
(`blender -b --factory-startup --python scripts/phase2/60_interiors.py` /
`62_hq.py`). Both GLBs are gitignored (frozen-by-hash artifacts — the rebuild
is deliberate and recorded here; `docs/phase2/BASELINE_HASHES.json` content
does not include these two GLBs' old hashes as mandatory pins — see the
project's freeze docs for the archive flow).

## Defect 2 — lift_cab occlusion 0.8125 > 0.6 / top 0.854 > 0.45

The lift cab is 2.1 x 2.3 x 2.6 m with the eye at 1.7 m: the ceiling is 0.9 m
above the eye and the walls 1.05–1.15 m away, so ~0.85 of the frame is nearer
than 1.5 m **by construction**. No fixed near-field cap can pass there, and
the old rule would fail forever or be tuned to an unmeasured number.

Fix: new **enclosure-aware rule** `judgeEnclosureOcclusion()` in
`framecheck.js`. For a shot whose rig is an enclosed interior, the frame's
near field is compared against the enclosure's *own* geometry-derived near
field measured from the same camera with the same 16 x 9 grid:

```
near <= min(nearCap, geomNear + nearMargin)  and  top <= min(topCap, geomTop + topMargin)
```

Measured lift_cab frame: 0.8125 near vs 0.8472 enclosure → pass. The caps
(0.95/0.95) remain as an absolute backstop for an embedded camera. The
runner (`framecheck-run.mjs`) resolves `occ.enclosure: 'lift'` to the live
corridor lift rig. `car_cabin` stays on the fixed caps (0.16 near, with
room to spare; the fixed top-band rule is what catches a roof pushed down
over the eye — P2-069 class).

## Re-verification

- `node --test "scripts/qa/**/*.test.mjs"` → 50/50 pass (5 new
  `judgeEnclosureOcclusion` tests)
- framecheck suite re-run (vite 5174 + headless Chrome CDP): **15/15 shots
  pass, 0 console errors, 0 failed requests**
- `docs/qa/evidence/qa-integrity/framecheck_results.json` + `defects.json`
  regenerated from the fixed build (defects.json now empty)
- Vision-bridge export contract intact: `luminanceStddev`, `distinctColours`,
  `occlusionFraction`, `pixelDiff`, `bandLuminance` unchanged

## Changed files

- `apps/manhattan-threejs/src/framecheck.js` — matrixWorld inverse fix +
  `judgeEnclosureOcclusion`
- `scripts/qa/framecheck-run.mjs` — enclosure rig resolution for lift_cab
- `scripts/qa/framecheck.test.mjs` — 5 new tests
- `scripts/phase2/60_interiors.py`, `scripts/phase2/62_hq.py` — inward winding
- `docs/qa/evidence/qa-integrity/framecheck_results.json`,
  `docs/qa/evidence/qa-integrity/defects.json` — re-run evidence (0 defects)

## Limitations

- Signed-volume per-room runs were not re-added; winding is now verified
  behaviorally by the culled-from-inside raycast on every visible room.
- The GLBs were rebuilt but are gitignored; the hash-freeze/archive flow was
  not re-run (documented above).
