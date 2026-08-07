# Vision defect record — JSON contract (2O-A-005)

The schema of a **visual review finding**. One file per review round is a JSON
array of these objects, or an object with a `defects` array; the machine
contract lives in `scripts/vision/defect-schema.json`. Files live under
`docs/qa/evidence/vision/` (e.g. `defects.json`).

This is the *vision side* of the QA contract. The qa-integrity worker builds
numeric structural checks in `apps/manhattan-threejs/src/framecheck.js` and
emits its own defect records under `docs/qa/evidence/qa-integrity/defects.json`
with a schema it owns. The two sides meet here: **a visual finding is only
closed when it has been reduced to a numeric check that framecheck-style
functions can measure.** The vision side does not depend on framecheck.js
existing; the generated tests fail with a clear message until it lands, and
the converter says so when it runs.

## Fields

| Field | Required | Type | Meaning |
|---|---|---|---|
| `id` | yes | string | Stable id, `V-` + number. Never reused for a different finding. |
| `source` | yes | string | Where it was found: contact sheet file, shot name, reviewer label. |
| `image` | yes | string | PNG the finding refers to, repo-root-relative (e.g. `evidence/phase2/times_square.png`). |
| `captured_at` | yes | string | ISO 8601 capture date/time of that PNG. |
| `severity` | yes | enum | `critical` (breaks the shot), `major` (visibly wrong), `minor` (cosmetic). |
| `category` | yes | enum | `occlusion`, `culling`, `unlit`, `z-fighting`, `pop-in`, `clipping`, `missing geometry`, `texture`, `audio`, `other`. |
| `description` | yes | string | Narrow and falsifiable: "horizontal black band across the top quarter of the frame", not "looks bad". |
| `check` | no | object | The numeric reduction (below). Absent on `open` findings. |
| `status` | yes | enum | `open` / `confirmed` / `rejected` (below). |
| `confirmed_by` | no | string | Reviewer name, model id, or numeric run. Required when `status = confirmed`. |
| `notes` | no | string | Anything that changes the reading (intermittency, conditions). |

## The check object

The suggested numeric check must reference a *framecheck-style measurable*:
a function exported by `apps/manhattan-threejs/src/framecheck.js` — the module
the qa-integrity worker is building in parallel, per HANDOFF §0. The assumed
export contract (agreed with the qa-integrity worker, and listed here so the
two sides cannot drift silently):

| Function | Measures | Unit |
|---|---|---|
| `luminanceStddev(pixels)` | per-channel luminance standard deviation | linear 0–1 |
| `distinctColours(pixels)` | count of quantised distinct colours | count |
| `occlusionFraction(pixels, maxDepth)` | fraction of frame whose first hit is closer than `maxDepth` | fraction |
| `pixelDiff(a, b)` | fraction of pixels differing between two frames | fraction |
| `bandLuminance(pixels, band)` | mean luminance of a screen band (`top`/`middle`/`bottom`) | linear 0–1 |

If the parallel module exports different names, the generated tests fail with
an explicit "does not export X" message rather than a silent wrong result —
that is a contract break, not a crash.

Fields of `check`:

| Field | Required | Meaning |
|---|---|---|
| `fn` | yes | Export name in framecheck.js, e.g. `luminanceStddev`. |
| `args` | no | Array passed to the function. `"$IMAGE"` → absolute path of this defect's PNG; `"$IMAGE_DIR"` → its directory. Default `["$IMAGE"]`. |
| `operator` | yes | `lt`, `lte`, `gt`, `gte`, `eq`, `neq`, or `approx` (relative tolerance 5%). |
| `threshold` | yes | The proposed threshold, in `unit`. |
| `unit` | no | Unit, e.g. `luminance stddev (linear)`, `fraction of frame`. |
| `ref` | no | Basis: HANDOFF section, ledger id, framecheck doc section. |

## Status lifecycle

- `open` — reported by a reviewer; **no numeric reduction exists yet**. An
  open defect is a promise to measure, not a done task. Round-trip rule: *a
  defect that cannot be reduced to a numeric check stays open and is not
  silently closed.*
- `confirmed` — the numeric check exists and has been observed to fail
  (or the defect is a known-good baseline for regression). Only `confirmed`
  defects are converted to tests by `scripts/vision/defect-to-test.mjs`.
- `rejected` — checked numerically and shown to be a false positive, with
  `notes` saying what measured what.

No reviewer's or model's self-report counts as proof of a fix; only the
numeric check passing counts.

## Example

```json
{
  "id": "V-0007",
  "source": "contact_sheet_2026-08-05.html",
  "image": "evidence/phase2/vision_bridge_probe.png",
  "captured_at": "2026-08-05T21:12:04Z",
  "severity": "major",
  "category": "unlit",
  "description": "Ceiling of the street-level shot reads pure black: top band mean luminance 0.005 while the floor band reads 0.22.",
  "check": {
    "fn": "bandLuminance",
    "args": ["$IMAGE", "top"],
    "operator": "lt",
    "threshold": 0.02,
    "unit": "mean luminance (linear)",
    "ref": "HANDOFF §0 item 5 (unlit surface)"
  },
  "status": "confirmed",
  "confirmed_by": "numeric run docs/qa/evidence/vision/run-01.json",
  "notes": "Ceiling-only fixture; see P2-058 for the same class of bug."
}
```
