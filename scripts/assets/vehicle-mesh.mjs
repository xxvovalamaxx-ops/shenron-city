/**
 * Generating an original sportback, as real geometry.
 *
 * Stage 2's first asset. Blender is the intended tool and is not reachable over
 * MCP right now, so this authors the car in code instead — which is a normal
 * production pipeline, not a shortcut, provided the output is genuinely
 * modelled. It has to be: exporting nine boxes into a GLB would pass
 * placeholdercheck (a loaded GLB arrives as BufferGeometry) while being exactly
 * the thing the gate exists to catch. That would not be a clever way past the
 * check, it would be breaking the check.
 *
 * So the body is lofted. A car silhouette is a sequence of cross-sections along
 * its length — a low pointed nose, a rising bonnet, a windscreen leaning back
 * into a cabin, a fastback roofline falling to a short deck — and each section
 * is a closed loop whose width, height, shoulder radius and roof width vary
 * from station to station. Bridging consecutive loops with quads gives a
 * continuous surface with real curvature. Wheels are revolved profiles with a
 * separate rim. Nothing here is a box.
 *
 * The design is original: proportions chosen from generic segment norms
 * (4.6 m long, 1.87 m wide, 1.38 m tall, 2.75 m wheelbase), no marque cues, no
 * badge, no reference to any manufacturer's model. The brief bans branded
 * supercars and ripped content; an original silhouette avoids both by
 * construction.
 *
 * Axes match the runtime: +x right, +y up, +z forward (the direction of
 * travel), origin on the ground between the wheels — the frame VehicleRig
 * already positions entities in.
 */

/** Metres. Generic segment proportions; no marque cues. */
export const SPORTBACK = {
  length: 4.6,
  width: 1.87,
  height: 1.38,
  wheelbase: 2.75,
  wheelRadius: 0.34,
  wheelWidth: 0.245,
  trackHalf: 0.79,
  groundClearance: 0.13,
}

/**
 * Longitudinal stations, nose to tail.
 *
 * `z` is metres from the origin (positive forward). `y0`/`y1` are the section's
 * bottom and top. `hw` is half-width at the shoulder, `roof` the half-width of
 * the flat top, `shoulder` how far down the tumblehome starts.
 *
 * These numbers are the design. The nose sits low and narrow, the section
 * swells over the front axle, peaks through the cabin, and tapers into a
 * fastback tail with a lip.
 */
function sportbackStations(spec) {
  const { length, width, height, groundClearance: gc } = spec
  const hw = width / 2
  const nose = length / 2
  return [
    { z: nose, y0: gc + 0.06, y1: 0.62, hw: hw * 0.62, roof: hw * 0.34, round: 0.5 },
    { z: nose - 0.28, y0: gc, y1: 0.74, hw: hw * 0.86, roof: hw * 0.52, round: 0.46 },
    { z: nose - 0.75, y0: gc, y1: 0.86, hw: hw * 0.97, roof: hw * 0.66, round: 0.4 },
    { z: nose - 1.35, y0: gc, y1: 1.02, hw, roof: hw * 0.74, round: 0.34 },
    // Windscreen base into the cabin.
    { z: nose - 1.95, y0: gc, y1: height * 0.94, hw, roof: hw * 0.6, round: 0.3 },
    { z: nose - 2.45, y0: gc, y1: height, hw, roof: hw * 0.56, round: 0.3 },
    { z: nose - 3.05, y0: gc, y1: height * 0.985, hw, roof: hw * 0.54, round: 0.3 },
    // Fastback fall.
    { z: nose - 3.6, y0: gc, y1: height * 0.87, hw: hw * 0.99, roof: hw * 0.62, round: 0.34 },
    { z: nose - 4.05, y0: gc + 0.02, y1: 0.98, hw: hw * 0.95, roof: hw * 0.72, round: 0.4 },
    { z: nose - 4.42, y0: gc + 0.08, y1: 0.9, hw: hw * 0.86, roof: hw * 0.66, round: 0.46 },
    { z: nose - length, y0: gc + 0.16, y1: 0.84, hw: hw * 0.66, roof: hw * 0.46, round: 0.5 },
  ]
}

/**
 * One closed cross-section loop, counter-clockwise seen from the front.
 *
 * Built from a rounded-rectangle sweep so the roof, shoulder, flank and sill
 * blend rather than meeting at hard corners. `segments` controls the tessellation
 * and is what the LOD tiers vary.
 */
function section(station, segments) {
  const { y0, y1, hw, roof, round } = station
  const points = []
  const h = y1 - y0
  const shoulderY = y0 + h * (1 - round)
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    // Parametric loop: top arc across the roof, down the flank, along the sill.
    const c = Math.cos(t)
    const s = Math.sin(t)
    // Superellipse gives flat-ish roof and flanks with rounded corners, which
    // is what a car section actually looks like; a plain ellipse reads as a
    // tube and a rectangle reads as a crate.
    const n = 3.2
    const ax = Math.sign(c) * Math.abs(c) ** (2 / n)
    const ay = Math.sign(s) * Math.abs(s) ** (2 / n)
    const widthAt = s > 0 ? roof + (hw - roof) * (1 - s) : hw
    const x = ax * widthAt
    const y = s > 0 ? shoulderY + ay * (y1 - shoulderY) : shoulderY + ay * (shoulderY - y0)
    points.push([x, y])
  }
  return points
}

/** Bridge two loops of equal length into quads. */
function bridge(indices, ringA, ringB, count) {
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count
    const a0 = ringA + i
    const a1 = ringA + j
    const b0 = ringB + i
    const b1 = ringB + j
    indices.push(a0, b0, b1, a0, b1, a1)
  }
}

/** Smooth normals by area-weighted accumulation over the faces. */
function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let t = 0; t < indices.length; t += 3) {
    const [ia, ib, ic] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3]
    const ux = positions[ib] - positions[ia]
    const uy = positions[ib + 1] - positions[ia + 1]
    const uz = positions[ib + 2] - positions[ia + 2]
    const vx = positions[ic] - positions[ia]
    const vy = positions[ic + 1] - positions[ia + 1]
    const vz = positions[ic + 2] - positions[ia + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const i of [ia, ib, ic]) {
      normals[i] += nx
      normals[i + 1] += ny
      normals[i + 2] += nz
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= len
    normals[i + 1] /= len
    normals[i + 2] /= len
  }
  return [...normals]
}

/**
 * The body shell.
 *
 * `segments` is the loop tessellation and `stationStep` thins the stations —
 * together they give the LOD tiers without re-authoring the shape, so every
 * tier is the same car rather than four cars that resemble each other.
 */
export function buildBody(spec = SPORTBACK, { segments = 24, stationStep = 1 } = {}) {
  const all = sportbackStations(spec)
  const stations = all.filter((_, i) => i % stationStep === 0 || i === all.length - 1)
  const positions = []
  const indices = []
  const ringStarts = []

  for (const station of stations) {
    ringStarts.push(positions.length / 3)
    for (const [x, y] of section(station, segments)) positions.push(x, y, station.z)
  }
  for (let i = 0; i < ringStarts.length - 1; i++) {
    bridge(indices, ringStarts[i], ringStarts[i + 1], segments)
  }

  // Cap the two ends with a fan to the section centre, so the shell is closed.
  for (const [ring, station, flip] of [
    [ringStarts[0], stations[0], false],
    [ringStarts[ringStarts.length - 1], stations[stations.length - 1], true],
  ]) {
    const centre = positions.length / 3
    positions.push(0, (station.y0 + station.y1) / 2, station.z)
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments
      if (flip) indices.push(centre, ring + j, ring + i)
      else indices.push(centre, ring + i, ring + j)
    }
  }

  return { positions, indices, normals: computeNormals(positions, indices) }
}

/**
 * A wheel: revolved tyre profile plus a dished rim face.
 *
 * The profile is a rounded tyre cross-section revolved about the x axis, which
 * is the axis the runtime spins the wheel on.
 */
export function buildWheel(spec = SPORTBACK, { radial = 20, profile = 6 } = {}) {
  const { wheelRadius: R, wheelWidth: W } = spec
  const rimR = R * 0.62
  const positions = []
  const indices = []

  // Tyre cross-section: outer tread with a shoulder radius, inner wall to rim.
  const outline = []
  for (let i = 0; i <= profile; i++) {
    const t = i / profile
    const a = -Math.PI / 2 + t * Math.PI
    outline.push([Math.sin(a) * (W / 2), R - (1 - Math.cos(a)) * (R * 0.06)])
  }
  outline.push([W / 2, rimR], [-W / 2, rimR])

  const ringStarts = []
  for (const [x, r] of outline) {
    ringStarts.push(positions.length / 3)
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2
      positions.push(x, Math.sin(a) * r, Math.cos(a) * r)
    }
  }
  for (let i = 0; i < ringStarts.length - 1; i++) {
    bridge(indices, ringStarts[i], ringStarts[i + 1], radial)
  }
  // Close the loop back to the first ring so the tyre is a solid.
  bridge(indices, ringStarts[ringStarts.length - 1], ringStarts[0], radial)

  // Rim faces, one per side, as a fan.
  for (const [x, flip] of [
    [W / 2, false],
    [-W / 2, true],
  ]) {
    const ring = positions.length / 3
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2
      positions.push(x, Math.sin(a) * rimR, Math.cos(a) * rimR)
    }
    const centre = positions.length / 3
    positions.push(x, 0, 0)
    for (let i = 0; i < radial; i++) {
      const j = (i + 1) % radial
      if (flip) indices.push(centre, ring + j, ring + i)
      else indices.push(centre, ring + i, ring + j)
    }
  }

  return { positions, indices, normals: computeNormals(positions, indices) }
}

/**
 * A light lens: a shallow curved patch, not a slab.
 *
 * Generated as a grid bent around the body's shoulder radius so it sits on the
 * surface rather than floating in front of it.
 */
export function buildLens(
  { halfWidth = 0.34, halfHeight = 0.075, z = 0, y = 0.72, bulge = 0.05, cols = 8, rows = 3 } = {},
) {
  const positions = []
  const indices = []
  for (let r = 0; r <= rows; r++) {
    const v = r / rows
    for (let c = 0; c <= cols; c++) {
      const u = c / cols
      const x = (u * 2 - 1) * halfWidth
      const yy = y + (v * 2 - 1) * halfHeight
      // Bow the patch forward in the middle so it follows the nose.
      const k = 1 - (u * 2 - 1) ** 2
      positions.push(x, yy, z + k * bulge)
    }
  }
  const stride = cols + 1
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * stride + c
      indices.push(a, a + stride, a + stride + 1, a, a + stride + 1, a + 1)
    }
  }
  return { positions, indices, normals: computeNormals(positions, indices) }
}

/** Triangle count of a generated part, for LOD budgeting. */
export function triangleCount(part) {
  return part.indices.length / 3
}
