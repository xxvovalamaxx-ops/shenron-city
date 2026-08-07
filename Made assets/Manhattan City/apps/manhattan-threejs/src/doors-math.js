// doors-math.js — pure geometry for doorway cutting (Phase 3B).
//
// No three.js, no DOM, no imports: the same house pattern as framecheck.js,
// so the identical code is unit-tested in Node (scripts/qa/door-cut.test.mjs)
// and run against the real tile geometry in the browser.
//
// The idea, in one paragraph: every building wall in this world is an
// extruded-prism quad (20_buildings.py emits one quad per footprint edge per
// stage, all axis-aligned to the wall plane), and a doorway is a rectangle in
// that wall's own (u, v) frame — u along the wall, v up. Cutting the doorway
// is therefore exact 2D polygon subtraction: for every wall triangle that
// overlaps the door rect, subtract the rect in (u, v) and re-emit the
// remaining convex pieces with their original winding. No general CSG, no
// floating-point heroics, and the hole in the mesh is real — which is what
// makes the walk collider's rays pass through (controls.js probes the actual
// tile meshes, so a real hole is a real opening).

// ---------------------------------------------------------------------------
// 2D primitives
// ---------------------------------------------------------------------------

// Signed area of a polygon (positive = counter-clockwise).
export function polyArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
  }
  return a * 0.5
}

// Cross product z of (a-b) x (c-b), signed.
function crossZ(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

// Split a convex polygon by the line through p with normal n. Returns
// [outside, inside] convex polygons (n·(x-p) >= eps is outside), each keeping
// the input winding, or null where a side has fewer than 3 vertices. Points
// within eps of the line are duplicated onto both sides so pieces share exact
// boundary vertices and never leave a gap at the cut edge.
export function splitByLine(poly, p, n, eps = 1e-9) {
  const d = (q) => n[0] * (q[0] - p[0]) + n[1] * (q[1] - p[1])
  let minD = Infinity
  let maxD = -Infinity
  for (const q of poly) {
    const v = d(q)
    if (v < minD) minD = v
    if (v > maxD) maxD = v
  }
  // entirely on one side: the other side is empty
  if (minD >= -eps) return [poly, null]
  if (maxD <= eps) return [null, poly]

  const outside = []
  const inside = []
  let prev = poly[poly.length - 1]
  let prevD = d(prev)
  for (const cur of poly) {
    const curD = d(cur)
    const prevOut = prevD > eps
    const curOut = curD > eps
    if (prevOut && curOut) {
      outside.push(cur)
    } else if (!prevOut && !curOut) {
      inside.push(cur)
    } else if (prevOut !== curOut) {
      // crossing: intersect the edge with the line
      const t = prevD / (prevD - curD)
      const ix = prev[0] + (cur[0] - prev[0]) * t
      const iy = prev[1] + (cur[1] - prev[1]) * t
      if (curOut) {
        inside.push([ix, iy])
        outside.push([ix, iy])
        outside.push(cur)
      } else {
        outside.push([ix, iy])
        inside.push([ix, iy])
        inside.push(cur)
      }
    }
    prev = cur
    prevD = curD
  }
  return [outside.length >= 3 ? outside : null,
    inside.length >= 3 ? inside : null]
}

// Subtract an axis-aligned rect from a convex polygon. The rect's four
// half-plane outsides are applied one at a time; a piece that ends up fully
// outside any single rect edge is outside the whole rect and is final, and
// the piece left after all four edges is the part inside the rect, discarded.
// Returns the kept pieces (each convex, input winding), up to 4 of them.
// r = { u0, v0, u1, v1 } with u0 < u1 and v0 < v1.
export function subtractRect(poly, r) {
  const edges = [
    { p: [r.u0, r.v0], n: [-1, 0] },
    { p: [r.u1, r.v1], n: [1, 0] },
    { p: [r.u0, r.v0], n: [0, -1] },
    { p: [r.u1, r.v1], n: [0, 1] },
  ]
  let carry = [poly]
  const out = []
  for (const e of edges) {
    const next = []
    for (const piece of carry) {
      const [outside, inside] = splitByLine(piece, e.p, e.n)
      if (outside) out.push(outside)
      if (inside) next.push(inside)
    }
    carry = next
  }
  return out
}

// Axis-aligned bounding box of a polygon.
export function polyBox(pts) {
  let u0 = Infinity
  let v0 = Infinity
  let u1 = -Infinity
  let v1 = -Infinity
  for (const [u, v] of pts) {
    if (u < u0) u0 = u
    if (v < v0) v0 = v
    if (u > u1) u1 = u
    if (v > v1) v1 = v
  }
  return { u0, v0, u1, v1 }
}

// Do two axis-aligned rects overlap?
export function rectsOverlap(a, b) {
  return a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1
}

// ---------------------------------------------------------------------------
// the doorway cut, in a wall plane frame
// ---------------------------------------------------------------------------

// Cut a rectangle out of one wall triangle. `tri` is the triangle's three
// (u, v) corners (any winding); `rect` is the door rect. Returns the list of
// kept convex polygons, each in the SAME winding as the input triangle, or
// null when the triangle does not overlap the rect (caller keeps it whole).
export function cutTriangle(tri, rect) {
  const tb = polyBox(tri)
  if (!rectsOverlap(tb, rect)) return null
  const pieces = subtractRect(tri, rect)
  if (!pieces.length) return []      // fully inside the rect: remove entirely
  const sign = Math.sign(polyArea(tri)) || 1
  const out = []
  for (const piece of pieces) {
    const a = polyArea(piece)
    if (Math.sign(a) !== sign && a !== 0) piece.reverse()
    out.push(piece)
  }
  return out
}

// Fan-triangulate a convex polygon into triangles (as index triples), keeping
// the polygon winding.
export function fanTriangles(poly) {
  const tris = []
  for (let i = 1; i < poly.length - 1; i++) {
    tris.push([poly[0], poly[i], poly[i + 1]])
  }
  return tris
}

// Total area of a list of polygons — used to assert the cut conserves area.
export function piecesArea(pieces) {
  let a = 0
  for (const p of pieces) a += polyArea(p)
  return a
}

// ---------------------------------------------------------------------------
// 3D wall-frame helpers (still pure: work on plain arrays of [x, y, z])
// ---------------------------------------------------------------------------

// Outward normal of a triangle via cross product, normalised.
export function triNormal3(a, b, c) {
  const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2]
  const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const l = Math.hypot(nx, ny, nz) || 1
  return [nx / l, ny / l, nz / l]
}

// A wall-plane frame for a vertical wall: u = horizontal direction along the
// wall (perpendicular to both the wall normal and up), v = up. Returns
// { o, uaxis, vaxis, normal } in [x, y, z] arrays. `normal` is the wall's
// outward normal; `up` defaults to world +y.
export function wallFrame(normal, up = [0, 1, 0]) {
  const nx = normal[0]; const ny = normal[1]; const nz = normal[2]
  const ux = nz; const uy = 0; const uz = -nx   // normal x up, no normalise needed
  const ul = Math.hypot(ux, uy, uz) || 1
  return {
    o: [0, 0, 0],
    uaxis: [ux / ul, 0, uz / ul],
    vaxis: up,
    normal: [nx, ny, nz],
  }
}

// World point from a frame + (u, v).
export function framePoint(frame, u, v) {
  return [
    frame.o[0] + frame.uaxis[0] * u + frame.vaxis[0] * v,
    frame.o[1] + frame.uaxis[1] * u + frame.vaxis[1] * v,
    frame.o[2] + frame.uaxis[2] * u + frame.vaxis[2] * v,
  ]
}

// Project a world point into a frame: returns [u, v].
export function frameProject(frame, p) {
  const dx = p[0] - frame.o[0]
  const dy = p[1] - frame.o[1]
  const dz = p[2] - frame.o[2]
  const u = dx * frame.uaxis[0] + dy * frame.uaxis[1] + dz * frame.uaxis[2]
  const v = dx * frame.vaxis[0] + dy * frame.vaxis[1] + dz * frame.vaxis[2]
  return [u, v]
}
