# Phase 2 evidence

Screenshots here are **actual GPU output** from the Three.js runtime, captured
from inside the running app and written to disk by a dev-server middleware.
They are not renders from Blender and not descriptions of what the build looks
like.

The PNGs are git-ignored because they are large and regenerated on every visual
change. To recreate the whole set:

```bash
npm --prefix apps/manhattan-threejs run dev
```

Then in the browser console at <http://localhost:5173>:

```js
await window.__capture.all()
```

Each shot is defined in [capture.js](../../apps/manhattan-threejs/src/capture.js)
as a real latitude and longitude, projected at capture time. Positions written
as raw local metres are how the first pass photographed the East River and
labelled it Harlem.

## The set

| Shot | Where | Shows |
|---|---|---|
| `midtown_air` | 40.7570, -73.9855 · 500 m | the grid, archetype colour variation, river |
| `skyline_from_east` | 40.7480, -73.9500 · 380 m | Midtown skyline across the East River |
| `downtown_air` | 40.7100, -74.0100 · 430 m | Financial District cluster |
| `central_park_air` | 40.7810, -73.9660 · 320 m | the park and its wall of buildings |
| `fifth_ave_34th` | 40.7484, -73.9857 · eye | avenue canyon, storefront band |
| `times_square` | 40.7580, -73.9855 · eye | postwar slab, deco setback tower |
| `west_village` | 40.7320, -74.0030 · eye | low-rise brick, narrow streets |
| `harlem_rowhouses` | 40.8090, -73.9480 · eye | pre-war masonry apartments |
| `fidi_canyon` | 40.7069, -74.0100 · eye | narrow downtown street |
| `soho_castiron` | 40.7240, -74.0010 · eye | cast-iron loft district |

## Measured render cost

Timed with `render()` followed by `gl.finish()`, 30 frames per position,
1280×720, device pixel ratio 1, RTX 5070, all 119 tiles resident:

| Position | ms/frame | triangles | draw calls |
|---|---|---|---|
| times_square | 0.53 | 1,698,206 | 208 |
| midtown_air | 0.61 | 1,698,206 | 208 |
| fifth_ave_34th | 0.64 | 2,064,920 | 254 |
| downtown_air | 0.72 | 2,779,431 | 352 |
| fidi_canyon | 0.73 | 2,778,421 | 342 |

Read these as *there is a large amount of headroom*, not as a frame rate. The
tab was not compositing during the measurement, so there is no vsync and no
present cost in these numbers, and `requestAnimationFrame` is throttled in a
hidden tab — a real frame rate has to be measured with the window visible.

What the numbers do establish: the whole island at one LOD costs well under a
millisecond of render time, so vehicles, pedestrians and real LOD geometry have
room to be added before anything needs optimising.
