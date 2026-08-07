// framecheck.js — dev-only visual and audio evidence checks (Phase 2O-A).
//
// House rule, HANDOFF §0: cheap proxies lie. If you have not measured it, you
// do not know it. Every check in this module reduces a claim about a rendered
// frame ("the view is fine", "the ceiling is lit") to numbers, and pass/fail
// is a threshold applied to measured numbers — never a description.
//
// The module has no imports at all, so it is importable from Node for unit
// tests (scripts/qa/framecheck.test.mjs) and from the browser (Vite serves
// it; scripts/qa/framecheck-run.mjs imports it in the page on demand). The
// scene-dependent parts take the runtime handle (window.__manhattan) as an
// argument instead of importing three.js. It is never on the boot path, so it
// cannot slow or break the app.
//
// Export contract with the vision-bridge worker (docs/qa/DEFECT_SCHEMA.md,
// 2O-A-005). These names are load-bearing — the vision side generates tests
// against them, and a rename is a contract break, not a refactor:
//
//   luminanceStddev(pixels)      per-pixel linear luminance stddev (0-1)
//   distinctColours(pixels)      quantised distinct colour count
//   occlusionFraction(pixels, maxDepth)
//                                fraction of pixels whose first hit is closer
//                                than maxDepth; needs pixels.depth (view-space
//                                metres), else returns {available:false}
//   pixelDiff(a, b)              fraction of pixels differing between frames
//   bandLuminance(pixels, band)  mean linear luminance of 'top'/'middle'/
//                                'bottom' band (20%/60%/20% of rows — the
//                                same split the unlit-surface check uses)
//
// Every pixel-taking function also accepts a raw RGBA byte array, so a caller
// that has pixels without a canvas can use it unchanged. "pixels" below means
// an ImageData-like {data, width, height} or the bare data array. A check
// that cannot be measured returns {available:false, reason} — never a faked
// number (HANDOFF §0).

// ---------------------------------------------------------------------------
// colour and luminance
// ---------------------------------------------------------------------------

const LUM = [0.2126, 0.7152, 0.0722]

// sRGB byte -> linear luminance component, exact piecewise curve, tabulated.
const SRGB2LIN = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  SRGB2LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export const srgbToLinear = (v) => SRGB2LIN[v]

// Normalise a contract "pixels" argument to a raw RGBA byte array.
function asBytes(image) {
  if (image && image.data && image.data.length) return image.data
  return image
}

// Per-channel mean and population standard deviation over RGBA bytes.
export function channelStats(data) {
  const n = data.length >> 2
  let r = 0; let g = 0; let b = 0
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]
  }
  const meanR = r / n; const meanG = g / n; const meanB = b / n
  let r2 = 0; let g2 = 0; let b2 = 0
  for (let i = 0; i < data.length; i += 4) {
    r2 += (data[i] - meanR) ** 2
    g2 += (data[i + 1] - meanG) ** 2
    b2 += (data[i + 2] - meanB) ** 2
  }
  return {
    meanR, meanG, meanB,
    stdR: Math.sqrt(r2 / n), stdG: Math.sqrt(g2 / n), stdB: Math.sqrt(b2 / n),
  }
}

// Distinct colours after quantising each channel to `bits` bits.
export function distinctColours(image, bits = 4) {
  const data = asBytes(image)
  const shift = 8 - bits
  const size = 1 << (3 * bits)
  const seen = new Uint8Array(size)
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    const k = ((data[i] >> shift) << (2 * bits)) |
      ((data[i + 1] >> shift) << bits) | (data[i + 2] >> shift)
    if (!seen[k]) { seen[k] = 1; count++ }
  }
  return count
}

// Exact (24-bit) distinct colour count.
export function distinctColoursExact(image) {
  const data = asBytes(image)
  const seen = new Set()
  for (let i = 0; i < data.length; i += 4) {
    seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
  }
  return seen.size
}

// Contract export: population standard deviation of per-pixel *linear*
// luminance, in 0-1 linear space. A flat frame measures 0; the dead-frame
// rule asserts stddev > 8 on the sRGB byte channels (channelStats), this is
// the luminance-space twin used by the vision contract.
export function luminanceStddev(image) {
  const d = asBytes(image)
  const n = d.length >> 2
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < d.length; i += 4) {
    const l = LUM[0] * SRGB2LIN[d[i]] +
      LUM[1] * SRGB2LIN[d[i + 1]] + LUM[2] * SRGB2LIN[d[i + 2]]
    s1 += l
    s2 += l * l
  }
  return Math.sqrt(Math.max(0, s2 / n - (s1 / n) ** 2))
}

// Quantised colour count at an explicit bit depth. distinctColours() is the
// contract export (4 bits, fixed); the dead-frame judge uses this at 6 bits,
// where a real rendered frame keeps hundreds of palette entries while a dead
// frame (one colour, or a 0-byte capture) still measures a handful.
export function distinctColoursBits(image, bits) {
  const data = asBytes(image)
  const shift = 8 - bits
  const size = 1 << (3 * bits)
  const seen = new Uint8Array(size)
  let count = 0
  for (let i = 0; i < data.length; i += 4) {
    const k = ((data[i] >> shift) << (2 * bits)) |
      ((data[i + 1] >> shift) << bits) | (data[i + 2] >> shift)
    if (!seen[k]) { seen[k] = 1; count++ }
  }
  return count
}

// Contract export: fraction of pixels whose RGB triple differs between two
// frames. Same size required; a mismatch is unavailable, never a made-up
// number. (Used by the vision side to reduce "the hidden building is still
// visible" to a diff, the P2-049 measurement pattern.)
export function pixelDiff(a, b) {
  const da = asBytes(a)
  const db = asBytes(b)
  if (!da || !db || da.length !== db.length) {
    return { available: false, reason: 'frames differ in size' }
  }
  const n = da.length >> 2
  let diff = 0
  for (let i = 0; i < da.length; i += 4) {
    if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) {
      diff++
    }
  }
  return diff / n
}

// Contract export: mean linear luminance of a horizontal screen band. The
// bands are 20% of rows top, 60% middle, 20% bottom — the same split the
// unlit-surface check (judgeUnlit) uses, so bandLuminance(image, 'top') and
// the module's own ceiling reading can never disagree.
export function bandLuminance(image, band) {
  const m = pixelStats(image)
  const key = band === 'top' ? 'lumTop'
    : band === 'middle' ? 'lumMid'
    : band === 'bottom' ? 'lumBot' : null
  if (!key) return { available: false, reason: `unknown band "${band}"` }
  return m[key]
}

// Luminance of one RGBA pixel, in linear space.
function pixelLum(data, i) {
  return LUM[0] * SRGB2LIN[data[i]] +
    LUM[1] * SRGB2LIN[data[i + 1]] + LUM[2] * SRGB2LIN[data[i + 2]]
}

// Mean luminance of the dimmest and brightest `frac` of pixels, from a
// luminance histogram, plus the frame mean.
function quantileMeans(hist, total, frac) {
  const k = Math.max(1, Math.round(total * frac))
  const binLum = (b) => (b + 0.5) / 255
  let acc = 0; let sum = 0
  for (let b = 0; b < 256 && acc < k; b++) {
    const c = hist[b]
    if (acc + c > k) { sum += (k - acc) * binLum(b); acc = k }
    else { sum += c * binLum(b); acc += c }
  }
  const lo = sum / k
  acc = 0; sum = 0
  for (let b = 255; b >= 0 && acc < k; b--) {
    const c = hist[b]
    if (acc + c > k) { sum += (k - acc) * binLum(b); acc = k }
    else { sum += c * binLum(b); acc += c }
  }
  const hi = sum / k
  return { lo, hi }
}

// The full pixel measurement used by the dead-frame and unlit-surface checks.
// image: ImageData or {data, width, height}; data is RGBA bytes.
export function pixelStats(image) {
  const { width: w, height: h, data } = image
  const n = w * h
  const hist = new Uint32Array(256)
  const ch = channelStats(data)
  const colours = distinctColours(data)
  const colours6 = distinctColoursBits(data, 6)
  const coloursExact = distinctColoursExact(data)

  // spatial bands: top 20% of rows (a ceiling in an interior), middle 60%,
  // bottom 20% (a floor)
  const topRows = Math.max(1, Math.floor(h * 0.2))
  const botRows = Math.max(1, Math.floor(h * 0.2))
  const midTop = topRows
  const midBot = h - botRows
  let lumTop = 0; let lumMid = 0; let lumBot = 0; let sum = 0
  let i = 0
  for (let y = 0; y < h; y++) {
    const band = y < topRows ? 0 : y >= midBot ? 2 : 1
    for (let x = 0; x < w; x++, i += 4) {
      const lum = pixelLum(data, i)
      sum += lum
      hist[Math.min(255, Math.floor(lum * 255))]++
      if (band === 0) lumTop += lum
      else if (band === 2) lumBot += lum
      else lumMid += lum
    }
  }
  const topArea = w * topRows
  const botArea = w * botRows
  const midArea = w * (midBot - midTop)
  const q = quantileMeans(hist, n, 0.2)
  return {
    width: w, height: h, pixels: n,
    ...ch,
    colours, colours6, coloursExact,
    lumMean: sum / n,
    lumTop: lumTop / topArea,
    lumMid: lumMid / midArea,
    lumBot: lumBot / botArea,
    lumLo20: q.lo, lumHi20: q.hi,
    hist: Array.from(hist),
  }
}

// Check 1 — dead frame. A real frame has per-channel stddev > 8 and more
// than 300 distinct colours (HANDOFF §0.1; caught P2-071, P2-032). The
// colour count is taken at 6-bit quantisation: at 4 bits a real city render
// measures as few as 74 (measured across all 15 Phase 2O shots), while a
// dead frame is a handful at any bit depth. Measured healthy range at 6 bits:
// 294-2659 across the same shots, so >= 200 separates with margin both ways.
export function judgeDeadFrame(m) {
  const stdMax = Math.max(m.stdR, m.stdG, m.stdB)
  const pass = stdMax > 8 && m.colours6 >= 200
  return {
    pass,
    measured: {
      stddev: [+m.stdR.toFixed(3), +m.stdG.toFixed(3), +m.stdB.toFixed(3)],
      stddevMax: +stdMax.toFixed(3),
      distinctColours: m.colours,
      distinctColours6bit: m.colours6,
      distinctColoursExact: m.coloursExact,
      meanLuminance: +m.lumMean.toFixed(5),
    },
    threshold: 'stddev > 8 per channel AND >= 200 distinct colours (6-bit quantised)',
  }
}

// Check 5 — unlit surface. Interior only: a ceiling band reading below 0.02
// linear while the floor band reads lit is a lighting defect, not a style
// choice (HANDOFF §0.5; caught P2-058). The lo20/hi20 pixel quantiles are
// reported alongside so the ceiling/floor story can be checked against both
// readings.
export function judgeUnlit(m, applicable) {
  const defect = applicable && m.lumTop < 0.02 && m.lumBot >= 0.1
  return {
    pass: applicable ? !defect : null,
    applicable,
    measured: {
      lumTopBand: +m.lumTop.toFixed(5),
      lumBottomBand: +m.lumBot.toFixed(5),
      lumMiddleBand: +m.lumMid.toFixed(5),
      lumMean: +m.lumMean.toFixed(5),
      dimmest20Mean: +m.lumLo20.toFixed(5),
      brightest20Mean: +m.lumHi20.toFixed(5),
    },
    threshold: 'interior: top-band mean < 0.02 linear while bottom band >= 0.1',
  }
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

// Signed volume of a triangle soup: sum dot(v0, cross(v1-v0, v2-v0)) / 6.
// Negative for an inside-out closed mesh (HANDOFF §0.3; caught P2-062).
// positions: Float32Array of xyz; indices: Uint16/Uint32 array or null.
export function signedVolume(positions, indices) {
  const n = indices ? indices.length : positions.length / 3
  let vol = 0
  for (let t = 0; t < n; t += 3) {
    const i0 = indices ? indices[t] : t
    const i1 = indices ? indices[t + 1] : t + 1
    const i2 = indices ? indices[t + 2] : t + 2
    const ax = positions[i0 * 3]; const ay = positions[i0 * 3 + 1]
    const az = positions[i0 * 3 + 2]
    const ux = positions[i1 * 3] - ax; const uy = positions[i1 * 3 + 1] - ay
    const uz = positions[i1 * 3 + 2] - az
    const vx = positions[i2 * 3] - ax; const vy = positions[i2 * 3 + 1] - ay
    const vz = positions[i2 * 3 + 2] - az
    vol += (uy * vz - uz * vy) * ax +
      (uz * vx - ux * vz) * ay +
      (ux * vy - uy * vx) * az
  }
  return vol / 6
}

// Count of edges that belong to exactly one triangle. A closed mesh has 0;
// anything above 0 means an opening, and signed volume is then not defined.
export function boundaryEdges(positions, indices) {
  const n = indices ? indices.length : positions.length / 3
  const count = new Map()
  for (let t = 0; t < n; t += 3) {
    const i0 = indices ? indices[t] : t
    const i1 = indices ? indices[t + 1] : t + 1
    const i2 = indices ? indices[t + 2] : t + 2
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = a < b ? a + ':' + b : b + ':' + a
      count.set(k, (count.get(k) || 0) + 1)
    }
  }
  let open = 0
  for (const c of count.values()) if (c === 1) open++
  return open
}

export function meshAABB(positions) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a]
      if (v < min[a]) min[a] = v
      if (v > max[a]) max[a] = v
    }
  }
  return { min, max }
}

// Ray vs axis-aligned box, slab method. origin/dir/min/max are [x,y,z]
// arrays. Returns { t, axis, tExit } of the entry point (t = 0 when the
// origin is inside the box; tExit = the distance the ray leaves the box),
// or null for a miss.
export function rayAABB(origin, dir, min, max) {
  let tmin = 0
  let tmax = Infinity
  let axis = 0
  for (let a = 0; a < 3; a++) {
    const o = origin[a]
    const d = dir[a]
    if (Math.abs(d) < 1e-12) {
      if (o < min[a] || o > max[a]) return null
    } else {
      let t1 = (min[a] - o) / d
      let t2 = (max[a] - o) / d
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
      if (t1 > tmin) { tmin = t1; axis = a }
      if (t2 < tmax) tmax = t2
      if (tmin > tmax) return null
    }
  }
  return { t: tmin, axis, tExit: tmax }
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

// A cols x rows grid of unit ray directions matching the camera frustum,
// row-major from the top-left of the screen. fwd/right/up are world basis
// vectors of the camera (all unit, fwd = where it looks).
export function rayGrid(fwd, right, up, fovYDeg, aspect, cols, rows) {
  const tanY = Math.tan((fovYDeg * Math.PI) / 360)
  const tanX = tanY * aspect
  const dirs = []
  for (let ry = 0; ry < rows; ry++) {
    const v = 1 - (2 * (ry + 0.5)) / rows
    for (let rx = 0; rx < cols; rx++) {
      const u = (2 * (rx + 0.5)) / cols - 1
      dirs.push(norm3([
        fwd[0] + right[0] * u * tanX + up[0] * v * tanY,
        fwd[1] + right[1] * u * tanX + up[1] * v * tanY,
        fwd[2] + right[2] * u * tanX + up[2] * v * tanY,
      ]))
    }
  }
  return dirs
}

// Convert a WebGL depth-buffer readback (0 at the near plane, 1 at far) to
// view-space depth in metres for a perspective camera. This is the inverse of
// the NDC mapping the projection matrix applies: z_ndc = (f+n)/(f-n) -
// 2fn/((f-n) z_view), and the buffer stores z_ndc * 0.5 + 0.5.
export function depthFromBuffer(buffer, near, far) {
  const out = new Float32Array(buffer.length)
  const a = far + near
  const b = far - near
  for (let i = 0; i < buffer.length; i++) {
    const ndc = buffer[i] * 2 - 1
    out[i] = (2 * near * far) / (a - ndc * b)
  }
  return out
}

// Contract export: fraction of the frame whose first depth hit is closer than
// maxDepth. Needs the caller's pixels.depth (view-space metres, e.g. from
// depthFromBuffer after a real render); a PNG alone has no depth channel, so
// without it this reports unavailable rather than guessing. This is the
// HANDOFF §0.2 occlusion measure in depth form; the runner also reports the
// 16x9 ray-grid version (occlusionReport) from the live scene.
export function occlusionFraction(image, maxDepth) {
  const depth = image && image.depth
  if (!depth) {
    return { available: false, reason: 'no depth channel (pixels.depth, view-space metres)' }
  }
  const d = asBytes(image)
  const n = d.length >> 2
  const m = depth.length
  if (n && m !== n) {
    return { available: false, reason: `depth length ${m} != pixel count ${n}` }
  }
  let near = 0
  for (let i = 0; i < m; i++) if (depth[i] < maxDepth) near++
  return near / m
}

// Check 2 — occluded view (HANDOFF §0.2; caught P2-069). hits is the per-ray
// result of the caller's cast (true if the first hit is closer than
// nearDist), row-major, cols x rows. Fraction reported overall and by screen
// band: row thirds (top/middle/bottom) and column thirds (left/centre/right).
export function occlusionReport(hits, cols, rows, nearDist) {
  const t = Math.floor(rows / 3)
  const m = Math.floor((2 * rows) / 3)
  const lb = Math.floor(cols / 3)
  const rb = Math.floor((2 * cols) / 3)
  const band = { top: 0, middle: 0, bottom: 0 }
  const col = { left: 0, centre: 0, right: 0 }
  let near = 0
  for (let i = 0; i < hits.length; i++) {
    if (!hits[i]) continue
    near++
    const r = Math.floor(i / cols)
    const c = i % cols
    band[r < t ? 'top' : r >= m ? 'bottom' : 'middle']++
    col[c < lb ? 'left' : c >= rb ? 'right' : 'centre']++
  }
  const n = hits.length
  const thirds = Math.max(1, t)
  const colThird = Math.max(1, lb)
  return {
    nearFraction: near / n,
    nearHits: near,
    total: n,
    byRowBand: {
      top: band.top / (thirds * cols),
      middle: band.middle / ((m - t) * cols),
      bottom: band.bottom / ((rows - m) * cols),
    },
    byColBand: {
      left: col.left / (rows * colThird),
      centre: col.centre / (rows * (rb - lb)),
      right: col.right / (rows * Math.max(1, cols - rb)),
    },
  }
}

export function judgeOcclusion(measured, expectation) {
  const max = expectation && expectation.maxNearFraction != null
    ? expectation.maxNearFraction : 0.35
  const maxTop = expectation && expectation.maxNearTop != null
    ? expectation.maxNearTop : Infinity
  const top = measured.byRowBand.top
  const pass = measured.nearFraction <= max && top <= maxTop
  return {
    pass,
    measured,
    threshold: `near-field (first hit < 1.5 m) fraction <= ${max}` +
      (isFinite(maxTop)
        ? ` and top row-band <= ${maxTop} (a roof over the eye blacks out the top of the frame)`
        : '') + ` for this shot kind`,
  }
}

// Check 2b — occluded view in an *enclosed interior* (a lift cab, a car
// cabin): the near-field fraction of such a shot is not a defect signal by
// itself, because the enclosure legitimately fills the frame — in the 2.1 x
// 2.3 x 2.6 m lift cab with the eye at 1.7 m, the ceiling is 0.9 m above the
// eye and the walls 1.05-1.15 m away, so ~0.85 of the frame is nearer than
// 1.5 m by construction. The fixed caps the street-level rule implies
// (0.35) and even the cabin caps (0.6/0.45) can never pass there, so they
// would either fail forever or be tuned to a number no one measures. The
// honest rule for an enclosed shot is to compare the frame against what the
// enclosure's own geometry predicts:
//
//   near <= min(nearCap, geomNear + nearMargin)  and
//   top  <= min(topCap,  geomTop  + topMargin)
//
// where geom is the same 16 x 9 grid cast against the enclosure's own meshes
// only, from the same camera. A healthy shot measures at or below its own
// enclosure (the measured lift_cab frame: 0.8125 near vs 0.847 enclosure;
// top 0.854 vs 0.875). Anything materially above the enclosure's own near
// field means geometry sits between the camera and the enclosure it should
// be inside (an embedded camera, an obstruction, a roof pushed down over the
// eye -- the P2-069 class). The caps stay as an absolute backstop: a frame
// that is 95%+ nearer than 1.5 m has the camera inside something opaque.
export function judgeEnclosureOcclusion(measured, geom, margins = {}) {
  const nearMargin = margins.nearMargin ?? 0.10
  const topMargin = margins.topMargin ?? 0.10
  const nearCap = margins.nearCap ?? 0.95
  const topCap = margins.topCap ?? 0.95
  const nearBudget = Math.min(nearCap, geom.nearFraction + nearMargin)
  const topBudget = Math.min(topCap, geom.byRowBand.top + topMargin)
  const pass = measured.nearFraction <= nearBudget &&
    measured.byRowBand.top <= topBudget
  return {
    pass,
    measured: {
      ...measured,
      enclosure: {
        nearFraction: +geom.nearFraction.toFixed(4),
        nearHits: geom.nearHits,
        byRowBand: geom.byRowBand,
        byColBand: geom.byColBand,
        nearBudget: +nearBudget.toFixed(4),
        topBudget: +topBudget.toFixed(4),
        rule: 'the frame must not exceed the enclosure\'s own near field plus ' +
          `margin (near +${nearMargin}, top +${topMargin}), capped at ` +
          `${nearCap}/${topCap}`,
      },
    },
    threshold: 'enclosed interior: near-field occlusion must stay within the ' +
      'enclosure\'s own geometry-derived near field plus margin',
  }
}

// 16 equally spaced unit directions in the horizontal plane, plus up and
// down, for the culled-from-inside check (HANDOFF §0.4; caught P2-067).
export function culledRays(n = 16) {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI
    out.push([Math.cos(a), 0, Math.sin(a)])
  }
  out.push([0, 1, 0])    // up
  out.push([0, -1, 0])   // down
  return out
}

// results: per-ray boolean hit in the same order as culledRays().
export function culledReport(results) {
  const misses = []
  results.forEach((hit, i) => { if (!hit) misses.push(i) })
  return { hits: results.length - misses.length, misses: misses.length, missedDirs: misses }
}

// A miss means a wall is wound the wrong way, or missing; more than a couple
// (tolerance, per the handoff) means the room is not culled correctly from
// inside.
export function judgeCulled(measured, tolerance = 2) {
  return {
    pass: measured.misses <= tolerance,
    measured,
    threshold: `misses <= ${tolerance} of ${measured.hits + measured.misses} rays`,
  }
}

// RMS of a float sample array. Pure and exported so the silence-vs-noise
// assertion is testable from Node without an OfflineAudioContext.
export function rms(samples) {
  if (!samples || !samples.length) return 0
  let s = 0
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i]
  return Math.sqrt(s / samples.length)
}

// ---------------------------------------------------------------------------
// audio
// ---------------------------------------------------------------------------

// Check — audio health, measured in an OfflineAudioContext (P2-052's method:
// silence must measure exactly 0.00000 RMS). Three readings: an empty graph
// (silence), white noise panned hard left (audible + left/right asymmetry).
export async function audioChecks() {
  const hasWindow = typeof window !== 'undefined'
  const OAC = hasWindow && (window.OfflineAudioContext ||
    window.webkitOfflineAudioContext)
  if (!OAC) return { available: false, reason: 'no OfflineAudioContext' }

  const SR = 44100
  const SECS = 0.5
  const N = Math.ceil(SR * SECS)
  const rmsOf = (buf) => rms(buf.getChannelData(0))

  const silent = new OAC(2, N, SR)
  const sbuf = await silent.startRendering()
  const silenceRms = rmsOf(sbuf)

  const ctx = new OAC(2, N, SR)
  const wb = ctx.createBuffer(1, N, SR)
  const wd = wb.getChannelData(0)
  for (let i = 0; i < N; i++) wd[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = wb
  const g = ctx.createGain()
  g.gain.value = 0.5
  const pan = ctx.createStereoPanner()
  pan.pan.value = -1
  src.connect(g).connect(pan).connect(ctx.destination)
  src.start()
  const nbuf = await ctx.startRendering()
  const left = rmsOf(nbuf)
  const rightR = (() => {
    const d = nbuf.getChannelData(1)
    let s = 0
    for (let i = 0; i < d.length; i++) s += d[i] * d[i]
    return Math.sqrt(s / d.length)
  })()
  const noiseRms = Math.hypot(left, rightR) / Math.SQRT2
  // Left/right ratio of the panned source. A perfect hard pan puts all the
  // energy in one channel (rightR == 0); JSON has no Infinity, so the ratio
  // is capped at 99 — a number you can diff is worth more than one you cannot
  // serialise. null only when both channels measure silence.
  const asym = rightR > 0 ? Math.min(99, left / rightR)
    : left > 0 ? 99 : null

  return {
    available: true,
    silenceRms: +silenceRms.toFixed(5),
    noiseRms: +noiseRms.toFixed(5),
    leftRms: +left.toFixed(5),
    rightRms: +rightR.toFixed(5),
    asymRatio: asym,
  }
}

export function judgeAudio(m) {
  const silent = m.silenceRms === 0
  const audible = m.noiseRms > 0.01
  const panned = m.asymRatio != null && m.asymRatio >= 1.5
  return {
    pass: silent && audible && panned,
    measured: m,
    threshold: 'silence RMS exactly 0.00000; noise RMS > 0.01; panned-source left/right ratio >= 1.5',
  }
}

// ---------------------------------------------------------------------------
// the two entry points
// ---------------------------------------------------------------------------

function resolveImage(image) {
  if (image && image.data && image.width && image.height) return image
  if (image && image.getContext) {
    // a canvas: snapshot it first
    const w = image.width; const h = image.height
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(image, 0, 0)
    return g.getImageData(0, 0, w, h)
  }
  return image // ImageData has data/width/height
}

// Pixel + audio checks for one frame. options.kind: 'aerial' | 'street' |
// 'interior' (controls the unlit-surface applicability). options.audio: true
// to measure OfflineAudioContext here, or a pre-measured audioChecks() result.
export async function runChecks(image, options = {}) {
  const { kind = 'street' } = options
  const img = resolveImage(image)
  const px = pixelStats(img)
  const dead = judgeDeadFrame(px)
  const unlit = judgeUnlit(px, kind === 'interior')
  let audio = null
  if (options.audio === true || options.audio == null) {
    const m = await audioChecks()
    audio = m.available ? { ...m, ...judgeAudio(m) }
      : { ...m, pass: null, unavailable: true }
  } else if (options.audio) {
    audio = { ...options.audio, ...judgeAudio(options.audio) }
  }
  return {
    size: { width: img.width, height: img.height, pixels: img.width * img.height },
    checks: {
      'dead-frame': { id: 'dead-frame', ...dead },
      'unlit-surface': { id: 'unlit-surface', ...unlit },
    },
    audio: audio ? { id: 'audio', ...audio } : null,
  }
}

// Check 4 — culled-from-inside (HANDOFF §0.4; caught P2-067). For every
// visible room, cast from the room's centre at eye height in 16 horizontal
// directions plus straight up and down, against the room's own shells. The
// room materials are FrontSide, and three's raycaster backface-culls
// FrontSide triangles, so a wall wound the wrong way does not answer a ray
// from inside: that ray sails out through the room instead.
//
// All of the geometry lives in the room's own local space, so the exit
// distances are computed against the geometry's local AABB with the ray
// transformed into local space — a world-space AABB of a yawed room is a
// bigger, rotated box and its faces do not sit where the walls are. The
// glass is included in the coverage set (it is DoubleSide, so it always
// answers a ray): a direction is only a miss when *nothing visible* is
// inside the room's box — the wall wound the wrong way, or a designed hole.
// The handoff tolerance is 2 misses a room; every miss also records what a
// tiny 3-degree render sees down that direction (sight), so a see-through
// is a number, not an impression.
export function culledFromInside(manhattan, THREE, renderer) {
  const m = manhattan
  if (!m || !THREE || !m.interiors || !m.interiors.rooms) {
    return { id: 'culled-from-inside', unavailable: true,
      reason: 'no interiors runtime' }
  }
  const raycaster = new THREE.Raycaster()
  const origin = new THREE.Vector3()
  const originLocal = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const dirLocal = new THREE.Vector3()
  const p = new THREE.Vector3()
  const out = { id: 'culled-from-inside', rooms: [], pass: true }

  for (const room of m.interiors.rooms) {
    if (!room.group || !room.group.visible) continue
    const children = room.group.children.filter((o) => o.isMesh)
    const shells = children.filter((o) => !o.userData.glaze)
    if (!shells.length) continue
    const glass = children.filter((o) => o.userData.glaze)

    const geo = shells[0].geometry
    geo.computeBoundingBox()
    const bb = geo.boundingBox
    const minL = [bb.min.x, bb.min.y, bb.min.z]
    const maxL = [bb.max.x, bb.max.y, bb.max.z]

    // room centre at eye height, in world and local space
    const aMin = [Infinity, Infinity, Infinity]
    const aMax = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z)
      shells[0].localToWorld(p)
      const pv = [p.x, p.y, p.z]
      for (let a = 0; a < 3; a++) {
        if (pv[a] < aMin[a]) aMin[a] = pv[a]
        if (pv[a] > aMax[a]) aMax[a] = pv[a]
      }
    }
    const cx = (aMin[0] + aMax[0]) * 0.5
    const cz = (aMin[2] + aMax[2]) * 0.5
    const cy = Math.min(aMin[1] + 1.7, aMax[1] - 0.2)
    // The room's own frame is the shell geometry's local space, so the world
    // centre has to be mapped back through the *full* matrixWorld inverse.
    // The rooms are positioned and yawed on their group, not on the shell
    // mesh, so the mesh's own quaternion is identity and a quaternion-only
    // inverse leaves originLocal in world coordinates -- for a room a mile
    // from the origin that is nowhere near the local AABB, every ray reports
    // "no local aabb exit", and the room measures 0/18 (the measured 2O-A
    // result for all three rooms, with tExit undefined on every ray).
    const invMatrix = shells[0].matrixWorld.clone().invert()

    const rays = culledRays(16)
    const results = rays.map((d) => {
      origin.set(cx, cy, cz)
      dir.set(d[0], d[1], d[2])
      originLocal.copy(origin).applyMatrix4(invMatrix)
      dirLocal.copy(dir).transformDirection(invMatrix)
      // the centre in local space is (bb.min+bb.max)/2 with the local eye
      // height, so the ray origin sits inside the local box by construction
      const exit = rayAABB(
        [originLocal.x, originLocal.y, originLocal.z],
        [dirLocal.x, dirLocal.y, dirLocal.z], minL, maxL)
      if (!exit) return { hit: false, reason: 'no local aabb exit' }
      raycaster.set(origin, dir)
      raycaster.far = exit.tExit + 0.05
      const shellHit = raycaster.intersectObjects(shells, false)
      const glassHit = glass.length
        ? raycaster.intersectObjects(glass, false)
        : []
      const first = shellHit.length && glassHit.length
        ? (shellHit[0].distance <= glassHit[0].distance ? shellHit : glassHit)
        : shellHit.length ? shellHit : glassHit
      return {
        hit: first.length > 0 && first[0].distance <= exit.tExit + 0.05,
        shell: shellHit.length > 0 && shellHit[0].distance <= exit.tExit + 0.05,
        glass: glassHit.length > 0 && glassHit[0].distance <= exit.tExit + 0.05,
        distance: first.length ? +first[0].distance.toFixed(2) : null,
        tExit: +exit.tExit.toFixed(2),
      }
    })
    const rep = culledReport(results.map((r) => r.hit))

    const judged = judgeCulled(rep)
    const missDetails = results.flatMap((r, i) =>
      r.hit ? [] : [{ ray: i, dir: rays[i], tExit: r.tExit,
        sight: probeMissDirection(m, THREE, renderer, [cx, cy, cz], rays[i]) }])
    const roomOut = {
      room: room.key,
      label: room.label || room.key,
      hits: rep.hits,
      misses: rep.misses,
      missedDirs: rep.missedDirs,
      glassCovered: results.filter((r) => r.glass && !r.shell).length,
      pass: judged.pass,
      measured: judged.measured,
      threshold: judged.threshold,
      missDetails,
      aabb: {
        min: aMin.map((v) => +v.toFixed(1)),
        max: aMax.map((v) => +v.toFixed(1)),
      },
    }
    out.rooms.push(roomOut)
    if (!judged.pass) out.pass = false
  }

  if (!out.rooms.length) {
    out.unavailable = true
    out.reason = 'no visible rooms at this camera'
    delete out.pass
  } else {
    const totalHits = out.rooms.reduce((s, r) => s + r.hits, 0)
    const totalMisses = out.rooms.reduce((s, r) => s + r.misses, 0)
    out.measured = {
      rooms: out.rooms.map((r) => ({
        room: r.room, hits: r.hits, misses: r.misses,
        glassCovered: r.glassCovered,
      })),
      totalHits, totalMisses,
      hitsOfRays: `${totalHits}/${totalHits + totalMisses}`,
    }
    out.threshold = 'per room: misses <= 2 of 18 rays (16 horizontal + up + down)'
  }
  return out
}

// Render a tiny 64x64 frame from origin along dir and report what is there,
// so a culled-check miss can be told apart from a deliberate opening. Returns
// a JSON-safe reading, or null when no renderer is available.
function probeMissDirection(m, THREE, renderer, origin, dir) {
  if (!renderer || !m.camera) return null
  const camera = m.camera
  const keep = {
    pos: camera.position.clone(), quat: camera.quaternion.clone(),
    aspect: camera.aspect, fov: camera.fov, near: camera.near, far: camera.far,
  }
  try {
    const target = new THREE.WebGLRenderTarget(64, 64, { depthBuffer: true })
    const probe = new THREE.PerspectiveCamera(3, 1, 0.5, 5000)
    probe.position.set(origin[0], origin[1], origin[2])
    probe.lookAt(origin[0] + dir[0], origin[1] + dir[1], origin[2] + dir[2])
    probe.updateMatrixWorld(true)
    renderer.setRenderTarget(target)
    renderer.render(m.scene, probe)
    const buf = new Uint8Array(64 * 64 * 4)
    renderer.readRenderTargetPixels(target, 0, 0, 64, 64, buf)
    renderer.setRenderTarget(null)
    target.dispose()
    const px = pixelStats({ data: buf, width: 64, height: 64 })
    return {
      lumMean: +px.lumMean.toFixed(4),
      lumTop: +px.lumTop.toFixed(4),
      lumBot: +px.lumBot.toFixed(4),
      distinctColours6bit: px.colours6,
      stddevMax: +Math.max(px.stdR, px.stdG, px.stdB).toFixed(2),
    }
  } catch (e) {
    return { error: String(e.message || e) }
  } finally {
    camera.position.copy(keep.pos)
    camera.quaternion.copy(keep.quat)
    camera.aspect = keep.aspect
    camera.fov = keep.fov
    camera.near = keep.near
    camera.far = keep.far
    camera.updateProjectionMatrix()
  }
}

// Scene checks against the live runtime handle (window.__manhattan). Uses
// manhattan.THREE, so it only runs in the browser; guarded otherwise.
// options.occlusion: { maxNearFraction } expectation for this shot.
export function sceneChecks(manhattan, options = {}) {
  const THREE = manhattan && manhattan.THREE
  if (!THREE || !manhattan.camera) {
    return { unavailable: true, reason: 'no runtime handle' }
  }
  const out = {}
  out.occlusion = occlusionFromCamera(manhattan, THREE, options)
  out.culled = culledFromInside(manhattan, THREE, manhattan.renderer)
  return out
}

function occlusionFromCamera(m, THREE, options) {
  const cols = 16; const rows = 9; const nearDist = 1.5
  const camera = m.camera
  const mat = camera.matrixWorld.elements
  const right = [mat[0], mat[1], mat[2]]
  const up = [mat[4], mat[5], mat[6]]
  const fwd = [-mat[8], -mat[9], -mat[10]]
  const dirs = rayGrid(fwd, right, up, camera.fov, camera.aspect, cols, rows)

  const colliders = []
  for (const o of m.streamer.pickables()) colliders.push(o)
  for (const o of m.streets.pickables()) colliders.push(o)
  if (m.hq && m.hq.tower) colliders.push(m.hq.tower.children[0])
  for (const r of m.interiors.rooms) {
    if (r.group.visible) colliders.push(r.group)
  }
  if (m.doors && m.doors.pickables) {
    for (const g of m.doors.pickables()) colliders.push(g)
  }
  if (m.corridor.lift && m.corridor.lift.visible) colliders.push(m.corridor.lift)
  if (m.corridor.car && m.corridor.car.visible) colliders.push(m.corridor.car)

  const raycaster = new THREE.Raycaster()
  raycaster.far = nearDist
  const origin = camera.position
  const hits = new Array(cols * rows).fill(false)
  for (let i = 0; i < dirs.length; i++) {
    raycaster.set(origin, new THREE.Vector3(...dirs[i]))
    const hit = raycaster.intersectObjects(colliders, true)
    hits[i] = hit.length > 0
  }
  const measured = occlusionReport(hits, cols, rows, nearDist)

  // An enclosed-interior shot (options.occlusion.enclosure is the rig the
  // camera sits inside): judge the frame against the enclosure's own near
  // field, measured from the same camera with the same grid, rather than
  // against a fixed cap the enclosure cannot meet.
  const expectation = options.occlusion
  if (expectation && expectation.enclosure) {
    const enclosureHits = new Array(cols * rows).fill(false)
    for (let i = 0; i < dirs.length; i++) {
      raycaster.set(origin, new THREE.Vector3(...dirs[i]))
      const hit = raycaster.intersectObjects([expectation.enclosure], true)
      enclosureHits[i] = hit.length > 0
    }
    const geom = occlusionReport(enclosureHits, cols, rows, nearDist)
    return {
      id: 'occluded-view',
      ...judgeEnclosureOcclusion(measured, geom, expectation.enclosureMargins),
    }
  }
  return { id: 'occluded-view', ...judgeOcclusion(measured, expectation) }
}
