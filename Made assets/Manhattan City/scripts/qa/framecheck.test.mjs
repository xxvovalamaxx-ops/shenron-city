// framecheck.test.mjs — unit tests for apps/manhattan-threejs/src/framecheck.js
//
// node --test scripts/qa/
//
// The module under test is deliberately pure: no three.js, no DOM at import
// time, so the same file is tested here in Node and run in the browser by
// scripts/qa/framecheck-run.mjs.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  channelStats, distinctColours, distinctColoursExact, distinctColoursBits,
  pixelStats,
  signedVolume, rayAABB, rayGrid, occlusionReport, culledRays, culledReport,
  judgeDeadFrame, judgeUnlit, judgeOcclusion, judgeCulled, rms, judgeAudio,
  judgeEnclosureOcclusion,
  srgbToLinear, luminanceStddev, pixelDiff, bandLuminance,
  occlusionFraction, depthFromBuffer,
} from '../../apps/manhattan-threejs/src/framecheck.js'

// ---------------------------------------------------------------------------
// stddev / mean over ImageData
// ---------------------------------------------------------------------------

test('channelStats: mean and population stddev over RGBA bytes', () => {
  // 2x2 image: black, white, mid-grey, black
  const data = new Uint8ClampedArray([
    0, 0, 0, 255, 255, 255, 255, 255,
    128, 128, 128, 255, 0, 0, 0, 255,
  ])
  const s = channelStats(data)
  assert.equal(s.meanR, 95.75)
  assert.equal(s.meanG, 95.75)
  assert.equal(s.meanB, 95.75)
  const want = Math.sqrt(
    ((0 - 95.75) ** 2 + (255 - 95.75) ** 2 + (128 - 95.75) ** 2 +
      (0 - 95.75) ** 2) / 4)
  assert.ok(Math.abs(s.stdR - want) < 1e-9, `stdR ${s.stdR} != ${want}`)
  assert.equal(s.stdR, s.stdG)
  assert.equal(s.stdR, s.stdB)
})

test('channelStats: a flat image has zero stddev', () => {
  const data = new Uint8ClampedArray([42, 42, 42, 255, 42, 42, 42, 255])
  const s = channelStats(data)
  assert.equal(s.stdR, 0)
  assert.equal(s.meanR, 42)
})

// ---------------------------------------------------------------------------
// distinct colours
// ---------------------------------------------------------------------------

test('distinctColours: a flat image counts one colour', () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])
  assert.equal(distinctColours(data), 1)
  assert.equal(distinctColoursExact(data), 1)
})

test('distinctColours: four distinct pixels count four', () => {
  const data = new Uint8ClampedArray([
    10, 20, 30, 255, 40, 50, 60, 255,
    70, 80, 90, 255, 100, 110, 120, 255,
  ])
  assert.equal(distinctColours(data), 4)
  assert.equal(distinctColoursExact(data), 4)
})

test('distinctColours: 4-bit quantisation merges close colours', () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 1, 1, 1, 255])
  assert.equal(distinctColours(data), 1)
  assert.equal(distinctColoursExact(data), 2)
})

test('distinctColoursBits: finer quantisation counts more colours', () => {
  // values differing only in the 2 low bits merge at 4 bits and split at 6
  const data = new Uint8ClampedArray([0, 0, 0, 255, 4, 4, 4, 255,
    64, 64, 64, 255, 68, 68, 68, 255])
  assert.equal(distinctColoursBits(data, 4), 2)
  assert.equal(distinctColoursBits(data, 6), 4)
  assert.equal(distinctColoursBits(data, 8), 4)
  // a uniform frame is a handful of colours at any bit depth
  const flat = new Uint8ClampedArray([7, 7, 7, 255, 7, 7, 7, 255])
  assert.equal(distinctColoursBits(flat, 6), 1)
})

// ---------------------------------------------------------------------------
// signed volume
// ---------------------------------------------------------------------------

// A unit cube centred on the origin, wound outward (CCW seen from outside
// each face, two triangles per face). The origin must not lie on any face —
// signed volume sums pyramids from the origin, and a pyramid over a face the
// origin sits in is degenerate.
const CUBE_FACES = [
  // +x
  [0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5],
  [0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5],
  // -x
  [-0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5],
  [-0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5],
  // +y
  [-0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  // -y
  [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5],
  [-0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5],
  // +z
  [-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5],
  [-0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5],
  // -z
  [-0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5],
  [-0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5],
]

test('signedVolume: outward cube is positive, +1 for the unit cube', () => {
  const positions = new Float32Array(CUBE_FACES.flat())
  assert.ok(Math.abs(signedVolume(positions, null) - 1) < 1e-9)
})

test('signedVolume: reversed winding flips the sign (inside-out defect)', () => {
  // (a,b,c) -> (c,b,a) per triangle; reversing the flat array would scramble
  // each vertex's own coordinates instead of flipping winding.
  const positions = new Float32Array(
    CUBE_FACES.flatMap((t) => [t[6], t[7], t[8], t[3], t[4], t[5],
      t[0], t[1], t[2]]))
  assert.ok(Math.abs(signedVolume(positions, null) - (-1)) < 1e-9)
})

test('signedVolume: indexed triangles give the same result', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
  // outward-wound tetrahedron: volume = |det| / 6 = 1/6, positive
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 2, 3])
  // tetrahedron volume = |det| / 6 = 1/6; sign from winding
  assert.ok(Math.abs(signedVolume(positions, indices)) - 1 / 6 < 1e-9)
})

// ---------------------------------------------------------------------------
// ray vs AABB
// ---------------------------------------------------------------------------

const BOX = { min: [2, -1, -1], max: [4, 1, 1] }

test('rayAABB: hit from outside reports entry t, axis and tExit', () => {
  const r = rayAABB([0, 0, 0], [1, 0, 0], BOX.min, BOX.max)
  assert.deepEqual(r, { t: 2, axis: 0, tExit: 4 })
})

test('rayAABB: origin inside the box reports t = 0 and the exit', () => {
  const r = rayAABB([3, 0, 0], [1, 0, 0], BOX.min, BOX.max)
  assert.deepEqual(r, { t: 0, axis: 0, tExit: 1 })
})

test('rayAABB: pointing away misses', () => {
  assert.equal(rayAABB([0, 0, 0], [-1, 0, 0], BOX.min, BOX.max), null)
})

test('rayAABB: parallel miss misses', () => {
  assert.equal(rayAABB([0, 5, 0], [1, 0, 0], BOX.min, BOX.max), null)
  assert.equal(rayAABB([0, 0, 0], [0, 1, 0], BOX.min, BOX.max), null)
})

// ---------------------------------------------------------------------------
// luminance bands and the 20/20 quantiles
// ---------------------------------------------------------------------------

// 10 rows x 4 cols: top 2 rows dark, middle 6 mid, bottom 2 rows bright.
function bandedImage() {
  const w = 4
  const h = 10
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const v = y < 2 ? 5 : y >= 8 ? 230 : 128
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

test('pixelStats: spatial bands split top dark from bottom bright', () => {
  const m = pixelStats(bandedImage())
  assert.equal(m.width, 4)
  assert.equal(m.height, 10)
  assert.ok(m.lumTop < 0.01, `lumTop ${m.lumTop}`)
  assert.ok(m.lumBot > 0.6, `lumBot ${m.lumBot}`)
  assert.ok(m.lumBot > m.lumTop * 100)
  assert.ok(m.lumTop < m.lumMid && m.lumMid < m.lumBot)
})

test('pixelStats: lo20/hi20 track the dimmest/brightest 20% of pixels', () => {
  const m = pixelStats(bandedImage())
  // 40 px: 8 dark, 24 mid, 8 bright — exactly 20% dark and 20% bright
  assert.ok(m.lumLo20 < 0.01, `lumLo20 ${m.lumLo20}`)
  assert.ok(m.lumHi20 > 0.7, `lumHi20 ${m.lumHi20}`)
  assert.ok(m.lumHi20 > m.lumLo20 * 100)
})

test('pixelStats: linear-space luminance uses the sRGB piecewise curve', () => {
  assert.ok(Math.abs(srgbToLinear(230) - 0.7912) < 0.001)
  assert.ok(Math.abs(srgbToLinear(5) - 0.001517) < 0.0001)
  assert.ok(Math.abs(srgbToLinear(255) - 1) < 1e-6)
})

// ---------------------------------------------------------------------------
// the two pixel judges
// ---------------------------------------------------------------------------

test('judgeDeadFrame: a uniform frame is a dead frame', () => {
  const data = new Uint8ClampedArray(16 * 16 * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 40; data[i + 1] = 40; data[i + 2] = 60; data[i + 3] = 255
  }
  const m = pixelStats({ data, width: 16, height: 16 })
  assert.equal(judgeDeadFrame(m).pass, false)
})

test('judgeDeadFrame: a varied frame passes', () => {
  // 64x64 = 4096 px covering every 4-bit colour key exactly once
  const n = 64
  const data = new Uint8ClampedArray(n * n * 4)
  let k = 0
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (k >> 8) << 4
    data[i + 1] = ((k >> 4) & 15) << 4
    data[i + 2] = (k & 15) << 4
    data[i + 3] = 255
    k++
  }
  const m = pixelStats({ data, width: n, height: n })
  assert.ok(m.colours >= 300, `colours ${m.colours}`)
  assert.ok(m.colours6 >= 200, `colours6 ${m.colours6}`)
  assert.ok(m.stdR > 8, `stdR ${m.stdR}`)
  assert.equal(judgeDeadFrame(m).pass, true)
})

test('judgeDeadFrame: rich-but-palette-constrained frames pass at 6 bits', () => {
  // a real city render at 4-bit quantisation can sit at ~150 colours while
  // holding tens of thousands of exact colours (measured across all 15
  // Phase 2O shots); the judge must not call that dead. 250 distinct 4-bit
  // keys, each split into two 6-bit values by bit 2 (which survives 6-bit
  // quantisation and not 4-bit).
  const w = 500
  const h = 1
  const data = new Uint8ClampedArray(w * h * 4)
  for (let x = 0; x < w; x++) {
    const key = x >> 1 // 250 distinct 4-bit keys
    const lo = (x & 1) << 2
    const i = x * 4
    data[i] = ((key & 15) << 4) | lo
    data[i + 1] = (((key >> 4) & 15) << 4) | lo
    data[i + 2] = lo
    data[i + 3] = 255
  }
  const m = pixelStats({ data, width: w, height: h })
  assert.ok(m.colours < 300, `colours ${m.colours}`)
  assert.ok(m.colours6 >= 200, `colours6 ${m.colours6}`)
  assert.ok(m.stdR > 8, `stdR ${m.stdR}`)
  assert.equal(judgeDeadFrame(m).pass, true)
  assert.ok(judgeDeadFrame(m).measured.distinctColours6bit != null)
})

test('judgeUnlit: dark ceiling over lit floor is a defect; outdoors it is not applicable', () => {
  const darkTop = pixelStats(bandedImage()) // top dark, bottom bright
  assert.equal(judgeUnlit(darkTop, true).pass, false)
  assert.equal(judgeUnlit(darkTop, false).pass, null)
  assert.equal(judgeUnlit(darkTop, false).applicable, false)

  const brightTop = pixelStats({ // 10x4 all-bright image
    data: new Uint8ClampedArray(4 * 10 * 4).fill(200).map((v, i) =>
      i % 4 === 3 ? 255 : v),
    width: 4, height: 10,
  })
  assert.equal(judgeUnlit(brightTop, true).pass, true)
})

// ---------------------------------------------------------------------------
// occlusion: ray grid and the per-band report
// ---------------------------------------------------------------------------

test('rayGrid: rays are unit length and span the frustum', () => {
  const dirs = rayGrid([0, 0, 1], [1, 0, 0], [0, 1, 0], 60, 16 / 9, 3, 2)
  assert.equal(dirs.length, 6)
  for (const d of dirs) {
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-9)
  }
  // centre sample in the *bottom* row points straight forward in x
  assert.ok(Math.abs(dirs[4][0]) < 1e-9 && dirs[4][2] > 0)
  assert.ok(dirs[4][1] < 0, 'bottom row points down')
  // top-left has up and left components
  assert.ok(dirs[0][1] > 0, 'top row points up')
  assert.ok(dirs[0][0] < 0, 'left column points left')
})

test('occlusionReport: fractions by row and column bands', () => {
  const cols = 4
  const rows = 3
  const hits = [
    true, true, true, true,
    false, false, false, false,
    false, false, false, false,
  ]
  const m = occlusionReport(hits, cols, rows, 1.5)
  assert.equal(m.nearFraction, 4 / 12)
  assert.equal(m.byRowBand.top, 1)
  assert.equal(m.byRowBand.middle, 0)
  assert.equal(m.byRowBand.bottom, 0)
  // 4 cols split 1/1/2 (left 0, centre 1, right 2-3), one hit in each third
  assert.ok(Math.abs(m.byColBand.left - 1 / 3) < 1e-9)
  assert.ok(Math.abs(m.byColBand.centre - 1 / 3) < 1e-9)
  assert.ok(Math.abs(m.byColBand.right - 1 / 3) < 1e-9)
})

test('occlusionReport: every band fraction stays <= 1 even when a band is entirely near', () => {
  // 16x9 grid (the real runner geometry), every ray near
  const cols = 16
  const rows = 9
  const allNear = new Array(cols * rows).fill(true)
  const m = occlusionReport(allNear, cols, rows, 1.5)
  assert.equal(m.nearFraction, 1)
  for (const v of Object.values(m.byColBand)) {
    assert.ok(v <= 1 + 1e-9, `col band ${v} > 1`)
    assert.ok(Math.abs(v - 1) < 1e-9, `col band ${v} != 1`)
  }
  for (const v of Object.values(m.byRowBand)) {
    assert.ok(v <= 1 + 1e-9, `row band ${v} > 1`)
  }
})

test('judgeOcclusion: near-fraction cap and the top-band roof rule', () => {
  const measured = {
    nearFraction: 0.2,
    byRowBand: { top: 0.9, middle: 0.1, bottom: 0.1 },
  }
  assert.equal(judgeOcclusion(measured, { maxNearFraction: 0.35 }).pass, true)
  assert.equal(
    judgeOcclusion(measured, { maxNearFraction: 0.35, maxNearTop: 0.45 })
      .pass, false)
})

// ---------------------------------------------------------------------------
// enclosure-aware occlusion (2O-B: the lift-cab rule)
// ---------------------------------------------------------------------------

// The measured lift_cab frame vs the cab's own geometry-derived baseline
// (2O-A run vs the same 16x9 grid cast on LIFT_cab's own meshes).
test('judgeEnclosureOcclusion: a healthy enclosed shot passes against its own enclosure', () => {
  const frame = {
    nearFraction: 0.8125,
    byRowBand: { top: 0.8541666666666666, middle: 0.875, bottom: 0.7083333333333334 },
  }
  const geom = {
    nearFraction: 0.8472222222222222,
    byRowBand: { top: 0.875, middle: 0.875, bottom: 0.7916666666666666 },
  }
  const j = judgeEnclosureOcclusion(frame, geom)
  assert.equal(j.pass, true)
  assert.equal(j.measured.enclosure.nearFraction, 0.8472)
  assert.ok(j.measured.enclosure.rule.includes('margin'))
})

test('judgeEnclosureOcclusion: an embedded/obstructed camera exceeds the enclosure near field', () => {
  const frame = {
    nearFraction: 1.0, // camera inside something opaque
    byRowBand: { top: 1.0, middle: 1.0, bottom: 1.0 },
  }
  const geom = {
    nearFraction: 0.8472222222222222,
    byRowBand: { top: 0.875, middle: 0.875, bottom: 0.7916666666666666 },
  }
  assert.equal(judgeEnclosureOcclusion(frame, geom).pass, false)
})

test('judgeEnclosureOcclusion: a roof pushed down over the eye fails the top-band rule', () => {
  const frame = {
    nearFraction: 0.9,
    byRowBand: { top: 0.98, middle: 0.9, bottom: 0.8 },
  }
  const geom = {
    nearFraction: 0.8472222222222222,
    byRowBand: { top: 0.875, middle: 0.875, bottom: 0.7916666666666666 },
  }
  assert.equal(judgeEnclosureOcclusion(frame, geom).pass, false)
})

test('judgeEnclosureOcclusion: the near cap is an absolute backstop', () => {
  const frame = {
    nearFraction: 0.96, // cap 0.95 even though geom near + margin is lower
    byRowBand: { top: 0.9, middle: 1.0, bottom: 0.9 },
  }
  const geom = {
    nearFraction: 0.5,
    byRowBand: { top: 0.8, middle: 0.8, bottom: 0.5 },
  }
  assert.equal(judgeEnclosureOcclusion(frame, geom).pass, false)
  // ...and a frame inside the cap and margins passes
  const ok = {
    nearFraction: 0.55,
    byRowBand: { top: 0.85, middle: 0.5, bottom: 0.4 },
  }
  assert.equal(judgeEnclosureOcclusion(ok, geom).pass, true)
})

test('judgeEnclosureOcclusion: margins are configurable', () => {
  const frame = {
    nearFraction: 0.95,
    byRowBand: { top: 0.95, middle: 0.9, bottom: 0.8 },
  }
  const geom = {
    nearFraction: 0.8472222222222222,
    byRowBand: { top: 0.875, middle: 0.875, bottom: 0.7916666666666666 },
  }
  // tight margins reject what default margins accept
  assert.equal(judgeEnclosureOcclusion(frame, geom, { nearMargin: 0.05, topMargin: 0.05 }).pass, false)
  assert.equal(judgeEnclosureOcclusion(frame, geom, { nearMargin: 0.15, topMargin: 0.15 }).pass, true)
})

// ---------------------------------------------------------------------------
// culled-from-inside helpers
// ---------------------------------------------------------------------------

test('culledRays: 16 horizontal rays plus up and down', () => {
  const dirs = culledRays(16)
  assert.equal(dirs.length, 18)
  for (let i = 0; i < 16; i++) {
    assert.ok(Math.abs(dirs[i][1]) < 1e-12, `ray ${i} is horizontal`)
    assert.ok(Math.abs(Math.hypot(...dirs[i]) - 1) < 1e-9)
  }
  assert.deepEqual(dirs[16], [0, 1, 0])
  assert.deepEqual(dirs[17], [0, -1, 0])
})

test('culledReport and judgeCulled: a couple of misses are tolerated', () => {
  const allHit = new Array(18).fill(true)
  assert.equal(judgeCulled(culledReport(allHit)).pass, true)
  const oneMiss = new Array(18).fill(true)
  oneMiss[3] = false
  assert.equal(judgeCulled(culledReport(oneMiss)).pass, true)
  const threeMiss = new Array(18).fill(true)
  threeMiss[0] = threeMiss[5] = threeMiss[17] = false
  const rep = culledReport(threeMiss)
  assert.equal(rep.misses, 3)
  assert.equal(judgeCulled(rep).pass, false)
})

// ---------------------------------------------------------------------------
// the vision-bridge contract exports (docs/qa/DEFECT_SCHEMA.md, 2O-A-005)
// ---------------------------------------------------------------------------

test('luminanceStddev: flat frame measures 0, black/white mix measures its expected value', () => {
  const flat = new Uint8ClampedArray([42, 42, 42, 255, 42, 42, 42, 255])
  assert.equal(luminanceStddev(flat), 0)
  // one black and one white pixel: stddev of {0, 1} = 0.5 exactly
  const bw = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
  assert.ok(Math.abs(luminanceStddev(bw) - 0.5) < 1e-9)
  // accepts an ImageData-like object as well as a bare array
  assert.ok(Math.abs(
    luminanceStddev({ data: bw, width: 2, height: 1 }) - 0.5) < 1e-9)
})

test('distinctColours: accepts an ImageData-like object', () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
  assert.equal(distinctColours({ data, width: 2, height: 1 }), 2)
  assert.equal(distinctColoursExact({ data, width: 2, height: 1 }), 2)
})

test('pixelDiff: identical frames 0, disjoint frames 1, half differs 0.5', () => {
  const a = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
  assert.equal(pixelDiff(a, a.slice()), 0)
  const swapped = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
  assert.equal(pixelDiff(a, swapped), 1)
  const half = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255])
  assert.equal(pixelDiff(a, half), 0.5)
})

test('pixelDiff: mismatched sizes are unavailable, not a faked number', () => {
  const out = pixelDiff(new Uint8ClampedArray(8), new Uint8ClampedArray(16))
  assert.equal(out.available, false)
  assert.ok(out.reason)
})

test('bandLuminance: top/middle/bottom bands and the unknown-band guard', () => {
  const img = bandedImage() // top 20% dark, bottom 20% bright
  const px = pixelStats(img)
  assert.ok(bandLuminance(img, 'top') < 0.01)
  assert.ok(bandLuminance(img, 'bottom') > 0.6)
  // identical to the module's own band readings by construction
  assert.equal(bandLuminance(img, 'top'), px.lumTop)
  assert.equal(bandLuminance(img, 'middle'), px.lumMid)
  assert.equal(bandLuminance(img, 'bottom'), px.lumBot)
  const out = bandLuminance(img, 'centre')
  assert.equal(out.available, false)
})

test('occlusionFraction: measures from a depth channel; unavailable without one', () => {
  const noDepth = { data: new Uint8ClampedArray(16), width: 2, height: 2 }
  const out = occlusionFraction(noDepth, 1.5)
  assert.equal(out.available, false)

  // 4 pixels, view depths [1, 1, 5, 5]; two closer than 1.5
  const depth = new Float32Array([1, 1, 5, 5])
  const img = { data: new Uint8ClampedArray(16), width: 2, height: 2, depth }
  assert.equal(occlusionFraction(img, 1.5), 0.5)

  // depth length mismatching pixel count is a refused measurement
  const bad = { data: new Uint8ClampedArray(16), width: 2, height: 2,
    depth: new Float32Array(3) }
  assert.equal(occlusionFraction(bad, 1.5).available, false)
})

test('depthFromBuffer: inverts the perspective NDC mapping at near, mid, far', () => {
  const near = 12
  const far = 45000
  const z = depthFromBuffer(new Float32Array([0, 0.5, 1]), near, far)
  assert.ok(Math.abs(z[0] - near) < 1e-3, `near ${z[0]}`)
  const mid = (2 * near * far) / (near + far)
  assert.ok(Math.abs(z[1] - mid) < 1e-3, `mid ${z[1]}`)
  assert.ok(Math.abs(z[2] - far) < 1e-2, `far ${z[2]}`)
})

// ---------------------------------------------------------------------------
// audio RMS on synthetic buffers
// ---------------------------------------------------------------------------

test('rms: silence measures exactly 0.00000', () => {
  assert.equal(rms([0, 0, 0, 0, 0]), 0)
  assert.equal(rms(new Float32Array(100)), 0)
})

test('rms: a square wave at amplitude 0.5 measures 0.5', () => {
  const buf = new Float32Array(1000)
  for (let i = 0; i < buf.length; i++) buf[i] = i % 2 ? 0.5 : -0.5
  assert.ok(Math.abs(rms(buf) - 0.5) < 1e-9)
})

test('rms: white noise lands near its theoretical RMS', () => {
  const buf = new Float32Array(100000)
  for (let i = 0; i < buf.length; i++) buf[i] = Math.random() * 2 - 1
  const r = rms(buf)
  assert.ok(r > 0.5 && r < 0.62, `rms ${r}`)
  assert.ok(r > 0.01, 'noise is audible')
})

test('judgeAudio: silence 0, noise audible, hard pan asymmetric', () => {
  assert.equal(judgeAudio({
    silenceRms: 0, noiseRms: 0.3, asymRatio: 4,
  }).pass, true)
  // a perfect hard pan (right channel exactly 0) measures 99 (capped, JSON
  // has no Infinity) and must pass, not fail
  assert.equal(judgeAudio({
    silenceRms: 0, noiseRms: 0.3, asymRatio: 99,
  }).pass, true)
  assert.equal(judgeAudio({
    silenceRms: 0.0004, noiseRms: 0.3, asymRatio: 4,
  }).pass, false)
  assert.equal(judgeAudio({
    silenceRms: 0, noiseRms: 0.001, asymRatio: 4,
  }).pass, false)
  assert.equal(judgeAudio({
    silenceRms: 0, noiseRms: 0.3, asymRatio: 1.1,
  }).pass, false)
})
