// door-cut.test.mjs — unit tests for the Phase 3B doorway cut math.
//
// Run: node --test scripts/qa/
//
// The module under test is pure (apps/manhattan-threejs/src/doors-math.js):
// no three.js, no DOM, so the identical code that cuts the real tile walls
// in the browser is proven here in Node. The invariants that matter:
//
//   * subtracting a rect from a convex polygon tiles the polygon exactly —
//     the kept pieces have the same total area and never overlap the rect;
//   * winding survives the cut, so the rebuilt mesh keeps culling outward;
//   * the triangle-level cut conserves area and keeps pieces coplanar.
//
// The second half covers the room frame. doors.js works in the *authored*
// room frame (+x into the room, +y left, +z up); the room group's own local
// frame is (x into, y up, z along the wall), because the glTF exporter maps
// Blender (x, y, z) -> (x, z, -y). Applying that swap zero times shipped in
// the first pass of Phase 3B and no behavioural check caught it: the doors
// still cycled, the triggers still fired, and every walk-in approached the
// wall 1.70 m to the side of a 2.20 m opening. These tests are the cheap
// guard — pure arithmetic, no browser.

import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'

import {
  polyArea, splitByLine, subtractRect, polyBox, rectsOverlap,
  cutTriangle, fanTriangles, piecesArea,
  triNormal3, wallFrame, framePoint, frameProject,
} from '../../apps/manhattan-threejs/src/doors-math.js'
import {
  authToLocal, localToAuth, AUTHORED_ROT_X, cutGlazeRect, cutContained,
} from '../../apps/manhattan-threejs/src/doors.js'

// ---------------------------------------------------------------------------
// 2D primitives
// ---------------------------------------------------------------------------

test('polyArea: CCW positive, CW negative, zero for degenerate', () => {
  const ccw = [[0, 0], [2, 0], [2, 2], [0, 2]]
  const cw = [[0, 0], [0, 2], [2, 2], [2, 0]]
  assert.ok(Math.abs(polyArea(ccw) - 4) < 1e-9)
  assert.ok(Math.abs(polyArea(cw) + 4) < 1e-9)
  assert.equal(polyArea([[0, 0], [1, 0], [2, 0]]), 0)
})

test('splitByLine: a quad split down the middle gives two quads of equal area',
  () => {
    const quad = [[0, 0], [4, 0], [4, 4], [0, 4]]
    const [left, right] = splitByLine(quad, [2, 0], [1, 0])
    assert.ok(left && right)
    assert.ok(Math.abs(polyArea(left) - 8) < 1e-9)
    assert.ok(Math.abs(polyArea(right) - 8) < 1e-9)
    // both keep the input (CCW) winding
    assert.ok(polyArea(left) > 0 && polyArea(right) > 0)
  })

test('splitByLine: entirely one side leaves the other null', () => {
  const quad = [[0, 0], [4, 0], [4, 4], [0, 4]]
    .map(([x, y]) => [x, y + 10])
  const [outside, inside] = splitByLine(quad, [0, 0], [0, 1])
  assert.equal(outside, quad)
  assert.equal(inside, null)
})

test('subtractRect: rect fully inside a quad tiles it into 4 pieces, area '
  + 'conserved, none overlapping the rect', () => {
  const quad = [[0, 0], [8, 0], [8, 8], [0, 8]]
  const rect = { u0: 2, v0: 2, u1: 6, v1: 6 }
  const pieces = subtractRect(quad, rect)
  assert.equal(pieces.length, 4)
  assert.ok(Math.abs(piecesArea(pieces) - (64 - 16)) < 1e-9)
  for (const p of pieces) {
    const b = polyBox(p)
    // no piece may reach into the rect
    assert.ok(b.u1 <= rect.u0 + 1e-9 || b.u0 >= rect.u1 - 1e-9 ||
      b.v1 <= rect.v0 + 1e-9 || b.v0 >= rect.v1 - 1e-9)
    assert.ok(polyArea(p) > 0, 'piece winding preserved (CCW)')
  }
})

test('subtractRect: rect fully covering the polygon leaves nothing', () => {
  const tri = [[0, 0], [2, 0], [1, 2]]
  const pieces = subtractRect(tri, { u0: -1, v0: -1, u1: 5, v1: 5 })
  assert.deepEqual(pieces, [])
})

test('subtractRect: a rect beyond the polygon tiles it without loss', () => {
  const quad = [[0, 0], [4, 0], [4, 4], [0, 4]]
  const rect = { u0: 6, v0: 6, u1: 10, v1: 10 }
  const pieces = subtractRect(quad, rect)
  assert.ok(Math.abs(piecesArea(pieces) - 16) < 1e-9)
})

test('subtractRect: rect overlapping a corner leaves the L as two convex '
  + 'pieces, area conserved', () => {
  const quad = [[0, 0], [4, 0], [4, 4], [0, 4]]
  const rect = { u0: 2, v0: 2, u1: 8, v1: 8 }
  const pieces = subtractRect(quad, rect)
  assert.equal(pieces.length, 2)
  assert.ok(Math.abs(piecesArea(pieces) - (16 - 4)) < 1e-9)
  for (const p of pieces) assert.ok(polyArea(p) > 0)
})

// ---------------------------------------------------------------------------
// the doorway cut
// ---------------------------------------------------------------------------

test('cutTriangle: no overlap returns null (caller keeps the face whole)', () => {
  const tri = [[0, 0], [4, 0], [4, 4]]
  assert.equal(cutTriangle(tri, { u0: 10, v0: 10, u1: 12, v1: 12 }), null)
})

test('cutTriangle: fully inside the rect removes the face', () => {
  const tri = [[0, 0], [2, 0], [1, 2]]
  assert.deepEqual(cutTriangle(tri, { u0: -1, v0: -1, u1: 5, v1: 5 }), [])
})

test('cutTriangle: a door rect crossing a wall triangle conserves area and '
  + 'keeps the winding', () => {
  const tri = [[-4, 0], [4, 0], [4, 12]]   // CCW
  const rect = { u0: -1, v0: 0, u1: 1, v1: 2.5 }
  const area = polyArea(tri)
  const pieces = cutTriangle(tri, rect)
  assert.ok(pieces.length >= 1)
  const kept = piecesArea(pieces)
  assert.ok(kept > 0)
  // kept area == triangle area minus the rect overlap
  const overlap = 2 * 2.5
  assert.ok(Math.abs(kept - (area - overlap)) < 1e-9,
    `kept ${kept} vs expected ${area - overlap}`)
  for (const p of pieces) assert.ok(polyArea(p) > 0, 'winding preserved')
})

test('fanTriangles: area conserved, count n-2, no degenerate fans', () => {
  const poly = [[0, 0], [4, 0], [4, 4], [2, 6], [0, 4]]
  const tris = fanTriangles(poly)
  assert.equal(tris.length, 3)
  let a = 0
  for (const [p, q, r] of tris) a += Math.abs(
    ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) * 0.5)
  assert.ok(Math.abs(a - Math.abs(polyArea(poly))) < 1e-9)
})

test('rectsOverlap and polyBox', () => {
  assert.ok(rectsOverlap({ u0: 0, v0: 0, u1: 2, v1: 2 },
    { u0: 1, v0: 1, u1: 3, v1: 3 }))
  assert.ok(!rectsOverlap({ u0: 0, v0: 0, u1: 2, v1: 2 },
    { u0: 2.5, v0: 0, u1: 4, v1: 2 }))
  const b = polyBox([[1, 2], [5, 3], [2, 7]])
  assert.deepEqual(b, { u0: 1, v0: 2, u1: 5, v1: 7 })
})

// ---------------------------------------------------------------------------
// 3D wall-frame helpers
// ---------------------------------------------------------------------------

test('triNormal3: unit normal pointing the way the winding says', () => {
  // a CCW triangle in the z=0 plane, viewed from +z
  const n = triNormal3([0, 0, 0], [1, 0, 0], [0, 1, 0])
  assert.ok(Math.abs(n[2] - 1) < 1e-9)
  assert.ok(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1) < 1e-9)
  const m = triNormal3([0, 0, 0], [0, 1, 0], [1, 0, 0])
  assert.ok(Math.abs(m[2] + 1) < 1e-9)
})

test('wallFrame: horizontal u along the wall, v up, normal kept', () => {
  const f = wallFrame([1, 0, 0])
  assert.ok(Math.abs(f.uaxis[1]) < 1e-12, 'u stays horizontal')
  // u is perpendicular to both the wall normal and up, unit length
  const dotN = f.uaxis[0] * 1 + f.uaxis[2] * 0
  assert.ok(Math.abs(dotN) < 1e-12, 'u perpendicular to the wall normal')
  assert.ok(Math.abs(Math.hypot(...f.uaxis) - 1) < 1e-9, 'u unit length')
  assert.deepEqual(f.vaxis, [0, 1, 0])
  assert.deepEqual(f.normal, [1, 0, 0])
})

test('framePoint/frameProject round-trip', () => {
  const f = wallFrame([0.7071, 0, -0.7071])
  f.o = [100, 12, -200]
  const p = framePoint(f, 3.25, 1.9)
  const [u, v] = frameProject(f, p)
  assert.ok(Math.abs(u - 3.25) < 1e-6)
  assert.ok(Math.abs(v - 1.9) < 1e-6)
})

// ---------------------------------------------------------------------------
// the real cut shape: a wall quad with a doorway, 3D
// ---------------------------------------------------------------------------

test('a full doorway cut in a wall quad: area conserved, pieces coplanar, '
  + 'no piece inside the door rect', () => {
  // a 10 m wide (z) x 5 m tall (y) wall at x = 0, facing -x (street side);
  // world up is +y, exactly as the baked tile geometry is
  const corners = [[0, 0, 0], [0, 0, 10], [0, 5, 10], [0, 5, 0]]
  const quad = [corners[0], corners[1], corners[2], corners[3]]
  // split the quad into two triangles the way a triangulator would
  const tris = [[corners[0], corners[1], corners[2]],
    [corners[0], corners[2], corners[3]]]

  const frame = wallFrame([-1, 0, 0])
  frame.o = [0, 0, 0]
  const rect = { u0: 3.9, v0: 0, u1: 6.1, v1: 2.5 }

  const outTris = []
  let removed = 0
  for (const tri of tris) {
    const uv = tri.map((p) => frameProject(frame, p))
    const pieces = cutTriangle(uv, rect)
    if (pieces === null) {
      outTris.push(tri)
      continue
    }
    if (!pieces.length) { removed++; continue }
    for (const piece of pieces) {
      for (const t of fanTriangles(piece)) {
        outTris.push(t.map(([u, v]) => framePoint(frame, u, v)))
      }
    }
  }

  // area: wall minus doorway, measured in the wall's own (u, v) frame
  const wallArea = 10 * 5
  const doorArea = 2.2 * 2.5
  let kept = 0
  for (const [a, b, c] of outTris) {
    const [au, av] = frameProject(frame, a)
    const [bu, bv] = frameProject(frame, b)
    const [cu, cv] = frameProject(frame, c)
    kept += Math.abs(((bu - au) * (cv - av) - (bv - av) * (cu - au)) * 0.5)
  }
  assert.ok(Math.abs(kept - (wallArea - doorArea)) < 1e-6,
    `kept ${kept} vs ${wallArea - doorArea}`)

  // every kept triangle is coplanar with the wall and clear of the door rect
  for (const [a, b, c] of outTris) {
    assert.ok(Math.abs(a[0]) < 1e-9 && Math.abs(b[0]) < 1e-9 &&
      Math.abs(c[0]) < 1e-9, 'coplanar with the wall')
    const n = triNormal3(a, b, c)
    assert.ok(n[0] < 0, 'winding still faces the street')
    for (const p of [a, b, c]) {
      const [u, v] = frameProject(frame, p)
      // vertices may sit ON the rect boundary (the pieces share it); none
      // may sit strictly inside it
      const insideDoor = u > rect.u0 + 1e-6 && u < rect.u1 - 1e-6 &&
        v > rect.v0 + 1e-6 && v < rect.v1 - 1e-6
      assert.ok(!insideDoor, `vertex (${u}, ${v}) not inside the door rect`)
    }
  }
  assert.equal(removed, 0)
})

// ---------------------------------------------------------------------------
// the authored room frame
// ---------------------------------------------------------------------------

const v3 = () => new THREE.Vector3()

test('authToLocal: up stays up, left goes to -z, into stays into', () => {
  // +0 vs -0: compare by value, the sign of zero is not the point
  const at = (x, y, z) => authToLocal(x, y, z, v3()).toArray()
    .map((n) => n + 0)
  assert.deepEqual(at(0, 0, 1.7), [0, 1.7, 0])
  assert.deepEqual(at(0, 1, 0), [0, 0, -1])
  assert.deepEqual(at(3, 0, 0), [3, 0, 0])
})

test('authToLocal and localToAuth round-trip', () => {
  for (const p of [[1, 2, 3], [-0.35, 1.0, 1.7], [12, -4.5, 0], [0, 0, 0]]) {
    const back = localToAuth(authToLocal(p[0], p[1], p[2], v3()), v3())
    assert.deepEqual(back.toArray().map((n) => +n.toFixed(9)), p)
  }
})

test('AUTHORED_ROT_X is the matrix form of authToLocal', () => {
  // the door assembly is a child group carrying this one rotation; if it ever
  // stops agreeing with the vector helper the frame and the leaf part company
  const rot = new THREE.Object3D()
  rot.rotation.x = AUTHORED_ROT_X
  rot.updateMatrixWorld(true)
  for (const p of [[1, 2, 3], [-0.35, 1.0, 2.5], [0, 1.76, 2.36]]) {
    const viaMatrix = new THREE.Vector3(...p).applyMatrix4(rot.matrixWorld)
    const viaFn = authToLocal(p[0], p[1], p[2], v3())
    assert.ok(viaMatrix.distanceTo(viaFn) < 1e-9,
      `${viaMatrix.toArray()} vs ${viaFn.toArray()}`)
  }
})

test('a room point 1.7 m up is 1.7 m up in world, at any yaw', () => {
  // the shipped regression, as arithmetic: feeding an authored vector
  // straight to group.localToWorld loses the full 1.70 m of height and
  // spends it sideways instead
  for (const yaw of [0, 1.066, -0.51, 2.633, -2.074]) {
    const group = new THREE.Object3D()
    group.position.set(-1088.088, 12, 1487.233)
    group.rotation.set(0, yaw, 0)
    group.updateMatrixWorld(true)

    const right = group.localToWorld(authToLocal(0, 0, 1.7, v3()))
    const wrong = group.localToWorld(new THREE.Vector3(0, 0, 1.7))
    assert.ok(Math.abs(right.y - (group.position.y + 1.7)) < 1e-9,
      `yaw ${yaw}: authored up must be world up`)
    assert.ok(Math.abs(wrong.y - group.position.y) < 1e-9,
      `yaw ${yaw}: the unswapped read gains no height`)
    assert.ok(Math.abs(right.y - wrong.y - 1.7) < 1e-9,
      `yaw ${yaw}: the two readings differ by exactly the eye height`)
    // and the unswapped read is displaced 1.7 m horizontally instead
    assert.ok(Math.abs(Math.hypot(wrong.x - group.position.x,
      wrong.z - group.position.z) - 1.7) < 1e-9)
  }
})

// ---------------------------------------------------------------------------
// the glazed-wall cut
// ---------------------------------------------------------------------------

// A stand-in for GLAZE_lobby: one quad in the entrance plane at x = 0.02,
// 24 m along the wall (mesh z) and 5.3 m tall (mesh y), as two triangles.
function glazeQuad() {
  const p = [
    [0.02, 0.2, -12], [0.02, 0.2, 12], [0.02, 5.5, 12],
    [0.02, 0.2, -12], [0.02, 5.5, 12], [0.02, 5.5, -12],
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position',
    new THREE.Float32BufferAttribute(p.flat(), 3))
  g.setAttribute('color',
    new THREE.Float32BufferAttribute(new Array(18).fill(0.5), 3))
  return g
}

const glazeArea = (geometry) => {
  const pos = geometry.attributes.position
  const idx = geometry.index
  const n = idx ? idx.count / 3 : pos.count / 3
  let a = 0
  for (let t = 0; t < n; t++) {
    const [i, j, k] = [0, 1, 2].map((o) =>
      idx ? idx.getX(t * 3 + o) : t * 3 + o)
    // area in the wall's own (u, v) = (mesh z, mesh y)
    a += Math.abs(polyArea([
      [pos.getZ(i), pos.getY(i)],
      [pos.getZ(j), pos.getY(j)],
      [pos.getZ(k), pos.getY(k)],
    ]))
  }
  return a
}

test('cutGlazeRect leaves the pane standing either side of the opening', () => {
  const g = glazeQuad()
  const before = glazeArea(g)
  assert.ok(Math.abs(before - 24 * 5.3) < 1e-3, `${before}`)

  // the door bay, in mesh (u, v): 1.76 m wide, 2.4 m tall off a 0.22 m sill
  const rect = { u0: -1.88, u1: -0.12, v0: 0.22, v1: 2.62 }
  const r = cutGlazeRect(g, rect)

  assert.ok(r.geometry !== g, 'the pane was actually cut')
  assert.ok(r.kept > 0, 'glass remains — a doorway, not a missing wall')
  const after = glazeArea(r.geometry)
  const door = (rect.u1 - rect.u0) * (rect.v1 - rect.v0)
  assert.ok(Math.abs(after - (before - door)) < 1e-2,
    `kept ${after}, expected ${before - door}`)

  // nothing is left strictly inside the opening
  const pos = r.geometry.attributes.position
  const idx = r.geometry.index
  for (let t = 0; t < idx.count / 3; t++) {
    for (let o = 0; o < 3; o++) {
      const i = idx.getX(t * 3 + o)
      const u = pos.getZ(i)
      const v = pos.getY(i)
      assert.ok(!(u > rect.u0 + 1e-6 && u < rect.u1 - 1e-6 &&
        v > rect.v0 + 1e-6 && v < rect.v1 - 1e-6),
      `vertex (${u}, ${v}) is inside the opening`)
    }
  }
})

test('cutGlazeRect leaves a second wall of the same mesh alone', () => {
  // GLAZE_penthouse and GLAZE_floor45 run back along the room; only the
  // entrance plane may be cut
  const g = glazeQuad()
  const pos = g.attributes.position
  // push one triangle 8 m into the room
  for (let i = 3; i < 6; i++) pos.setX(i, 8.0)
  const r = cutGlazeRect(g, { u0: -1.88, u1: -0.12, v0: 0.22, v1: 2.62 })
  const out = r.geometry === g ? g : r.geometry
  const idx = out.index
  const n = idx ? idx.count / 3 : out.attributes.position.count / 3
  let deep = 0
  for (let t = 0; t < n; t++) {
    const i = idx ? idx.getX(t * 3) : t * 3
    if (out.attributes.position.getX(i) > 1) deep++
  }
  assert.equal(deep, 1, 'the far triangle survives untouched')
})

// ---------------------------------------------------------------------------
// the passage sweep
// ---------------------------------------------------------------------------

function triSoup(tris, bids) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position',
    new THREE.Float32BufferAttribute(tris.flat(2), 3))
  g.setAttribute('_bid', new THREE.Float32BufferAttribute(
    bids.flatMap((b) => [b, b, b]), 1))
  return g
}

test('cutContained removes only what is wholly inside, and only allowed bids',
  () => {
    const box = { min: [0, 0, 0], max: [2, 2, 2] }
    const inside = [[0.5, 0.5, 0.5], [1.5, 0.5, 0.5], [1, 1.5, 0.5]]
    const straddling = [[1, 1, 1], [5, 1, 1], [1, 5, 1]]
    const g = triSoup([inside, straddling, inside], [7, 7, 9])

    const all = cutContained(g, box, () => true)
    assert.equal(all.removed, 2, 'both contained triangles go')
    assert.equal(all.geometry.index.count / 3, 1, 'the straddler stays whole')

    const gated = cutContained(g, box, (bid) => bid !== 7)
    assert.equal(gated.removed, 1, 'only the bid the predicate allows')

    // nothing to remove: the caller must get the same geometry back, not a
    // rebuilt copy (the streamer re-cuts on every tile arrival)
    const src = triSoup([straddling], [7])
    const none = cutContained(src, box, () => true)
    assert.equal(none.removed, 0)
    assert.equal(none.geometry, src)
  })
