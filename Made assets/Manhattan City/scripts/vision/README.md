# Vision bridge — Phase 2O-A (2O-A-005)

The project is proceeding without a vision model. The vision bridge is the
tooling that substitutes for "looking": fixed-camera captures are reviewed by
a human or an external critic, and every finding that survives review is
reduced to a numeric check that runs forever after.

> Cheap proxies lie. If you have not measured it, you do not know it.

The pipeline, end to end:

```
capture (GPU output, /__capture sink)
   → evidence/phase2/*.png
   → contact-sheet.mjs           (human/external-critic review surface)
   → docs/qa/vision/contact_sheet_sample.html
   → reviewer writes findings    (schema: docs/qa/DEFECT_SCHEMA.md)
   → docs/qa/evidence/vision/defects.json
   → defect-to-test.mjs          (confirmed defects only)
   → scripts/vision/generated/defects.test.mjs
   → node --test                 (numeric regression, forever)
```

## 1. Capture

Screenshots are real GPU output, written by the dev-server `/__capture` sink.
Nothing in this pipeline uses a description of the city as evidence.

```bash
npm run dev -- --port 5175 --strictPort   # in apps/manhattan-threejs
```

Port 5175 is the default, but any free port works (`--port 5176` etc.);
what matters is that the dev server runs through `vite.config.js`, because
that is what mounts the world data and the `/__capture` sink. On a machine
where another worker holds 5175, pick another port rather than touching
their process.

then, headless or in a browser console:

```js
await window.__capture.all()                       // the 10 fixed SHOTS
await window.__capture.shoot('probe', SHOTS.times_square)   // one shot
```

Captures land in `evidence/phase2/` (git-ignored by design — PNGs are
regenerable). Never start the dev server except through `vite.config.js`:
it mounts the world data and the capture sink.

## 2. Contact sheet

```bash
node scripts/vision/contact-sheet.mjs evidence/phase2 \
  --out docs/qa/vision/contact_sheet_sample.html \
  --info docs/qa/vision/sample_manifest.json
```

- Self-contained HTML: every image embedded as a base64 data URL, grid layout,
  each card labelled with name, size and mtime. Opens offline in any browser.
- `--info` renders a build-info table in the header (commit, capture command,
  viewport, reviewer notes).
- Also writes `scripts/vision/contact-sheet.md`, a plain-text index
  (name → file → size → mtime) for non-visual review.

This is the surface a human or external critic reviews. Ask it narrow,
falsifiable questions — "is there a horizontal black band across the top
quarter of this frame?" — not "does it look good".

## 3. Defect records

Reviewer findings are written as JSON records, one file per round under
`docs/qa/evidence/vision/` (e.g. `defects.json`). The schema is
`scripts/vision/defect-schema.json`, documented in `docs/qa/DEFECT_SCHEMA.md`.

Every record names the image it refers to, a severity and category, and —
for confirmed findings — a `check`: a framecheck-style numeric measurable
(a function exported by `apps/manhattan-threejs/src/framecheck.js`, e.g.
`luminanceStddev`, `occlusionFraction`, `pixelDiff`) plus an operator and a
proposed threshold.

`framecheck.js` is built in parallel by the qa-integrity worker. This branch
does not depend on it: the export contract is written down in
`docs/qa/DEFECT_SCHEMA.md`, the converter warns if the file is missing, and
the generated tests fail with a clear message until it lands.

## 4. Regression tests

```bash
node scripts/vision/defect-to-test.mjs               # reads docs/qa/evidence/vision/defects.json
node --test scripts/vision/generated/defects.test.mjs
```

The converter emits one `node:test` case per **confirmed** defect, calling the
named framecheck function and asserting the threshold. Non-confirmed records
are skipped and reported. Set `FRAMECHECK_PATH` to point the generated tests
at a framecheck module elsewhere.

## The round-trip rule

**A defect that cannot be reduced to a numeric check stays open and is not
silently closed.**

- `open` — reported, no numeric reduction yet. An open record is a promise to
  measure.
- `confirmed` — the check exists and has been seen to fail; it becomes a
  regression test.
- `rejected` — checked numerically and shown to be a false positive, with the
  numbers in `notes`.

No reviewer's or model's self-report counts as proof that anything is fixed;
only the numeric check passing counts. A confirmed record with no `check`
is refused by the converter with a warning — the round-trip rule made
machinery.

## Files

| File | Role |
|---|---|
| `scripts/vision/contact-sheet.mjs` | builds the reviewable HTML + textual index |
| `scripts/vision/defect-schema.json` | JSON Schema of a defect record |
| `scripts/vision/defect-to-test.mjs` | confirmed defects → node:test regression file |
| `scripts/vision/README.md` | this file |
| `scripts/vision/contact-sheet.md` | textual index of the committed sample evidence |
| `docs/qa/DEFECT_SCHEMA.md` | the contract, in prose |
| `docs/qa/vision/contact_sheet_sample.html` | committed sample sheet |
| `scripts/vision/generated/defects.test.mjs` | generated, not committed |

All scripts are zero-dependency Node (built-ins only); the generated tests
use `node:test` (built-in). Regenerable artifacts (the PNGs, the
`generated/defects.test.mjs` file) are not committed; the sample contact
sheet HTML **and** its textual index are committed because they are the
reviewable record of the evidence.
