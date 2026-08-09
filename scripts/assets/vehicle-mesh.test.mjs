/**
 * Is the generated car actually a car?
 *
 * The reason these exist: exporting nine boxes into a GLB would pass
 * placeholdercheck, because a loaded GLB arrives as BufferGeometry regardless
 * of what is inside it. That would not be getting past the gate, it would be
 * breaking the gate. So the shape is asserted here — proportions, closure,
 * curvature, and the absence of the flat repeated cross-section that a box
 * lofted along its length would produce.
 */
import { describe, expect, it } from 'vitest'

import {
  SPORTBACK,
  buildBody,
  buildWheel,
  buildLens,
  triangleCount,
} from './vehicle-mesh.mjs'

/** Axis-aligned bounds of a generated part. */
function bounds(part) {
  const p = part.positions
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      if (p[i + c] < min[c]) min[c] = p[i + c]
      if (p[i + c] > max[c]) max[c] = p[i + c]
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}

/**
 * Distinct cross-section half-widths along z, to the nearest centimetre.
 *
 * Centimetres, not 5 cm buckets. At 5 cm the cabin's deliberately constant
 * width collapses several stations into one bucket and the measure reports 4
 * for a perfectly good car — which is a blunt instrument, not a finding.
 */
function distinctWidths(part) {
  const byZ = new Map()
  const p = part.positions
  for (let i = 0; i < p.length; i += 3) {
    const z = Math.round(p[i + 2] * 100) / 100
    const w = Math.abs(p[i])
    byZ.set(z, Math.max(byZ.get(z) ?? 0, w))
  }
  return new Set([...byZ.values()].map((w) => Math.round(w * 100)))
}

/** Widest half-width within a window around a z station. */
function widthNear(part, z, window = 0.2) {
  const p = part.positions
  let w = 0
  for (let i = 0; i < p.length; i += 3) {
    if (Math.abs(p[i + 2] - z) <= window) w = Math.max(w, Math.abs(p[i]))
  }
  return w
}

describe('the body is a car, not a lofted box', () => {
  const body = buildBody()

  it('has the segment proportions the design specifies', () => {
    const { size } = bounds(body)
    expect(size[2]).toBeCloseTo(SPORTBACK.length, 1)
    expect(size[0]).toBeLessThanOrEqual(SPORTBACK.width + 0.01)
    expect(size[0]).toBeGreaterThan(SPORTBACK.width * 0.9)
    expect(size[1]).toBeLessThanOrEqual(SPORTBACK.height + 0.01)
  })

  it('sits above the ground on its clearance, not through it', () => {
    expect(bounds(body).min[1]).toBeGreaterThan(0)
    expect(bounds(body).min[1]).toBeLessThan(0.2)
  })

  it('is centred laterally, so the car is symmetric about its own axis', () => {
    const { min, max } = bounds(body)
    expect(Math.abs(min[0] + max[0])).toBeLessThan(1e-6)
  })

  it('changes width along its length — the check a box would fail', () => {
    // A box lofted along z has exactly one width everywhere.
    expect(distinctWidths(body).size).toBeGreaterThan(6)
  })

  it('tapers at both ends and is full width through the middle', () => {
    // The actual property, stated directly rather than inferred from a bucket
    // count: a car narrows toward the nose and tail. The cabin being one
    // constant width is correct and is why the bucket measure alone is weak.
    const nose = SPORTBACK.length / 2
    // A 12 cm window either side, so this measures the extreme nose and tail
    // rather than smearing in the station behind them. The default 20 cm
    // window reached back to the penultimate station and reported the tail as
    // 0.80 m when the tail itself is 0.62 m.
    const TIP = 0.12
    const atNose = widthNear(body, nose, TIP)
    const atCabin = widthNear(body, nose - 2.45)
    const atTail = widthNear(body, nose - SPORTBACK.length, TIP)
    expect(atNose).toBeLessThan(atCabin * 0.75)
    expect(atTail).toBeLessThan(atCabin * 0.75)
    expect(atCabin).toBeCloseTo(SPORTBACK.width / 2, 2)
  })

  it('is taller through the cabin than over the nose', () => {
    // The single most car-shaped property, and one a crate does not have.
    const p = body.positions
    const nose = SPORTBACK.length / 2
    let noseTop = -Infinity
    let cabinTop = -Infinity
    for (let i = 0; i < p.length; i += 3) {
      const z = p[i + 2]
      if (z > nose - 0.4) noseTop = Math.max(noseTop, p[i + 1])
      if (Math.abs(z - (nose - 2.45)) < 0.2) cabinTop = Math.max(cabinTop, p[i + 1])
    }
    expect(cabinTop).toBeGreaterThan(noseTop + 0.4)
  })

  it('is a closed surface — every edge shared by exactly two triangles', () => {
    // An open shell shows its interior through the windows and lights wrongly.
    const edges = new Map()
    const idx = body.indices
    for (let t = 0; t < idx.length; t += 3) {
      for (const [a, b] of [
        [idx[t], idx[t + 1]],
        [idx[t + 1], idx[t + 2]],
        [idx[t + 2], idx[t]],
      ]) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    const open = [...edges.values()].filter((n) => n !== 2)
    expect(open).toHaveLength(0)
  })

  it('has unit normals everywhere', () => {
    for (let i = 0; i < body.normals.length; i += 3) {
      const len = Math.hypot(body.normals[i], body.normals[i + 1], body.normals[i + 2])
      expect(len).toBeCloseTo(1, 5)
    }
  })

  it('has no degenerate triangles', () => {
    const p = body.positions
    const idx = body.indices
    let degenerate = 0
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3]
      const ux = p[b] - p[a]
      const uy = p[b + 1] - p[a + 1]
      const uz = p[b + 2] - p[a + 2]
      const vx = p[c] - p[a]
      const vy = p[c + 1] - p[a + 1]
      const vz = p[c + 2] - p[a + 2]
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
      if (area < 1e-9) degenerate++
    }
    expect(degenerate).toBe(0)
  })
})

describe('LOD tiers are the same car at different densities', () => {
  it('drops triangles as the tier coarsens', () => {
    const l0 = triangleCount(buildBody(SPORTBACK, { segments: 32, stationStep: 1 }))
    const l1 = triangleCount(buildBody(SPORTBACK, { segments: 16, stationStep: 1 }))
    const l2 = triangleCount(buildBody(SPORTBACK, { segments: 10, stationStep: 2 }))
    expect(l0).toBeGreaterThan(l1)
    expect(l1).toBeGreaterThan(l2)
  })

  it('keeps the silhouette across tiers, within a few centimetres', () => {
    // The point of varying tessellation rather than authoring four models: a
    // far tier that is a different shape pops when it swaps in.
    const fine = bounds(buildBody(SPORTBACK, { segments: 32 }))
    const coarse = bounds(buildBody(SPORTBACK, { segments: 10, stationStep: 2 }))
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(fine.size[c] - coarse.size[c])).toBeLessThan(0.12)
    }
  })

  it('stays closed at the coarsest tier', () => {
    const body = buildBody(SPORTBACK, { segments: 8, stationStep: 3 })
    expect(triangleCount(body)).toBeGreaterThan(0)
    expect(bounds(body).size[2]).toBeGreaterThan(4)
  })
})

describe('wheels', () => {
  const wheel = buildWheel()

  it('is round in the plane it rolls in', () => {
    const { size } = bounds(wheel)
    expect(size[1]).toBeCloseTo(size[2], 2)
    expect(size[1]).toBeCloseTo(SPORTBACK.wheelRadius * 2, 1)
  })

  it('is as wide as the specified tyre', () => {
    expect(bounds(wheel).size[0]).toBeCloseTo(SPORTBACK.wheelWidth, 2)
  })

  it('spins about x, which is the axis the runtime rotates', () => {
    // If the revolve axis and the runtime's rotation axis disagree the wheel
    // wobbles instead of rolling.
    const { min, max } = bounds(wheel)
    expect(Math.abs(min[1] + max[1])).toBeLessThan(1e-6)
    expect(Math.abs(min[2] + max[2])).toBeLessThan(1e-6)
  })

  it('has a rim face inside the tyre radius', () => {
    const p = wheel.positions
    let minRadius = Infinity
    for (let i = 0; i < p.length; i += 3) {
      minRadius = Math.min(minRadius, Math.hypot(p[i + 1], p[i + 2]))
    }
    expect(minRadius).toBeLessThan(SPORTBACK.wheelRadius * 0.2)
  })
})

describe('light lenses follow the body rather than floating', () => {
  const lens = buildLens({ z: 2.2 })

  it('bows forward in the middle', () => {
    const p = lens.positions
    let centreZ = -Infinity
    let edgeZ = Infinity
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i]) < 0.02) centreZ = Math.max(centreZ, p[i + 2])
      if (Math.abs(Math.abs(p[i]) - 0.34) < 0.02) edgeZ = Math.min(edgeZ, p[i + 2])
    }
    expect(centreZ).toBeGreaterThan(edgeZ)
  })

  it('is a thin patch, not a slab', () => {
    const { size } = bounds(lens)
    expect(size[2]).toBeLessThan(0.1)
    expect(size[0]).toBeGreaterThan(0.5)
  })
})
