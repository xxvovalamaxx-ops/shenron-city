/**
 * Procedural trees, built once at load and instanced.
 *
 * A tree is grown into a crown envelope rather than by free recursion, so
 * each species' silhouette — the thing you actually read from across a
 * street or from the air — is controlled directly:
 *
 *   trunk      a tapered, slightly wandering tube up to the crown (to the top
 *              for species with a central leader)
 *   scaffolds  the main limbs, spread by the golden angle, each grown until
 *              it meets the envelope
 *   twigs      shorter shoots off the outer half of each scaffold (near LOD)
 *   cards      alpha-tested leaf-cluster cards from the leaf atlas, hung off
 *              the twigs and through the outer shell of the crown
 *
 * Leaf-card normals are bent toward the crown's own sphere, which is what
 * makes a few hundred flat cards light like one soft mass instead of a pile
 * of paper. Per-vertex `aLeaf` carries (sway weight, flutter phase, ambient
 * occlusion) for the wind and shading in tree-field.ts.
 *
 * Deterministic: the same species and seed always produce the same tree.
 */
import * as THREE from 'three'

export type CrownShape = 'round' | 'vase' | 'column' | 'cone' | 'pyramid'
export type BarkKind = 'broadleaf' | 'pine'

export interface TreeSpecies {
  key: string
  bark: BarkKind
  shape: CrownShape
  /** Reference height in metres at scale 1. */
  height: number
  /** Fraction of the height at which the crown starts. */
  crownBase: number
  /** Crown diameter as a fraction of the height. */
  crownWidth: number
  trunkRadius: number
  scaffolds: number
  /** Scaffold elevation in radians (positive rises). */
  rise: number
  twigs: number
  /** Near-LOD leaf cards. */
  cards: number
  /** Card edge length in metres. */
  cardSize: number
  /** Leaf atlas cells (4 x 2 grid, row-major from the top-left). */
  cells: number[]
  /** Cell for the mid-distance cards. */
  midCell: number
  /** A continuous central stem to the top (conifers, pin oak, ginkgo). */
  leader?: boolean
}

export const TREE_SPECIES: Record<string, TreeSpecies> = {
  plane: {
    key: 'plane', bark: 'broadleaf', shape: 'round', height: 16, crownBase: 0.3, crownWidth: 0.78,
    trunkRadius: 0.3, scaffolds: 9, rise: 0.62, twigs: 4, cards: 400, cardSize: 1.7, cells: [0, 6, 0], midCell: 6,
  },
  locust: {
    key: 'locust', bark: 'broadleaf', shape: 'vase', height: 13, crownBase: 0.3, crownWidth: 0.95,
    trunkRadius: 0.24, scaffolds: 7, rise: 0.72, twigs: 4, cards: 300, cardSize: 1.6, cells: [2], midCell: 2,
  },
  pinoak: {
    key: 'pinoak', bark: 'broadleaf', shape: 'pyramid', height: 15, crownBase: 0.18, crownWidth: 0.62,
    trunkRadius: 0.26, scaffolds: 13, rise: 0.12, twigs: 3, cards: 360, cardSize: 1.5, cells: [5, 5, 6], midCell: 6, leader: true,
  },
  ginkgo: {
    key: 'ginkgo', bark: 'broadleaf', shape: 'column', height: 12, crownBase: 0.24, crownWidth: 0.42,
    trunkRadius: 0.2, scaffolds: 10, rise: 1.0, twigs: 3, cards: 260, cardSize: 1.3, cells: [3], midCell: 3, leader: true,
  },
  pine: {
    key: 'pine', bark: 'pine', shape: 'cone', height: 14, crownBase: 0.14, crownWidth: 0.46,
    trunkRadius: 0.24, scaffolds: 18, rise: -0.08, twigs: 3, cards: 320, cardSize: 1.5, cells: [4, 7], midCell: 7, leader: true,
  },
  elm: {
    key: 'elm', bark: 'broadleaf', shape: 'vase', height: 20, crownBase: 0.32, crownWidth: 0.92,
    trunkRadius: 0.38, scaffolds: 8, rise: 0.95, twigs: 5, cards: 460, cardSize: 1.9, cells: [1, 6, 6], midCell: 6,
  },
  oak: {
    key: 'oak', bark: 'broadleaf', shape: 'round', height: 18, crownBase: 0.24, crownWidth: 0.98,
    trunkRadius: 0.42, scaffolds: 10, rise: 0.42, twigs: 5, cards: 460, cardSize: 1.9, cells: [5, 6, 0], midCell: 6,
  },
}

export type TreeLod = 'near' | 'mid'

export interface TreeMeshes {
  branches: THREE.BufferGeometry
  leaves: THREE.BufferGeometry
  /** Tallest point and widest reach at scale 1, metres. */
  height: number
  radius: number
}

/** mulberry32: small, fast, deterministic. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Crown half-width at relative crown height t (0 at the crown base, 1 at the
 * top), as a fraction of the maximum half-width.
 */
export function envelopeRadius(shape: CrownShape, t: number): number {
  if (t < 0 || t > 1) return 0
  switch (shape) {
    case 'round':
    case 'column':
      return Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))
    case 'vase': {
      // narrow at the fork, widest high up, then a domed top
      const dome = Math.sqrt(Math.max(0, 1 - Math.max(0, (t - 0.62) / 0.38) ** 2))
      return Math.min(1, 0.3 + 0.9 * Math.sqrt(t)) * dome
    }
    case 'cone':
      return Math.pow(1 - t, 0.95) * Math.min(1, 0.55 + t * 4)
    case 'pyramid':
      return Math.pow(1 - t, 0.75) * Math.min(1, 0.7 + t * 3)
  }
}

/** Atlas UV rectangle (u0, v0, du, dv) of a cell; v up, row 0 at the top. */
export function cellRect(cell: number): [number, number, number, number] {
  const col = cell % 4
  const row = Math.floor(cell / 4)
  const inset = 2 / 2048
  return [col / 4 + inset, 1 - (row + 1) / 2 + inset * 2, 0.25 - inset * 2, 0.5 - inset * 4]
}

class Builder {
  pos: number[] = []
  nrm: number[] = []
  uv: number[] = []
  leaf: number[] = []
  idx: number[] = []

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.leaf, 3))
    g.setIndex(this.idx)
    g.computeBoundingSphere()
    return g
  }
}

interface Limb {
  pts: THREE.Vector3[]
  radii: number[]
}

const UP = new THREE.Vector3(0, 1, 0)

function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const u = 1 - t
  return out.set(
    u * u * a.x + 2 * u * t * b.x + t * t * c.x,
    u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    u * u * a.z + 2 * u * t * b.z + t * t * c.z,
  )
}

/** A tapered tube along `limb`; `sway` scales with height for the wind. */
function tube(b: Builder, limb: Limb, segments: number, crownTop: number, stiff: number): void {
  const n = limb.pts.length
  const base = b.pos.length / 3
  const tan = new THREE.Vector3()
  const side = new THREE.Vector3()
  const bin = new THREE.Vector3()
  const dir = new THREE.Vector3()
  let along = 0
  let prevSide: THREE.Vector3 | null = null
  for (let i = 0; i < n; i++) {
    const p = limb.pts[i]
    if (i < n - 1) tan.subVectors(limb.pts[i + 1], p)
    else tan.subVectors(p, limb.pts[i - 1])
    tan.normalize()
    // parallel-transport-ish frame: keep the previous side vector if we can
    if (prevSide) side.copy(prevSide).addScaledVector(tan, -prevSide.dot(tan))
    if (!prevSide || side.lengthSq() < 1e-6) {
      side.crossVectors(tan, Math.abs(tan.y) < 0.95 ? UP : new THREE.Vector3(1, 0, 0))
    }
    side.normalize()
    bin.crossVectors(tan, side).normalize()
    prevSide = side.clone()
    if (i > 0) along += p.distanceTo(limb.pts[i - 1])
    const r = limb.radii[i]
    const sway = Math.pow(Math.max(0, p.y) / crownTop, 2) * stiff
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2
      dir.copy(side).multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a))
      b.pos.push(p.x + dir.x * r, p.y + dir.y * r, p.z + dir.z * r)
      b.nrm.push(dir.x, dir.y, dir.z)
      b.uv.push(j / segments, along / 1.6)
      b.leaf.push(sway, 0, 1)
    }
  }
  const ring = segments + 1
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = base + i * ring + j
      const c = a + ring
      b.idx.push(a, c, a + 1, a + 1, c, c + 1)
    }
  }
}

/**
 * Grow one tree. `lod` 'near' carries twigs and the full card count; 'mid'
 * keeps trunk and scaffolds with fewer, larger cards.
 */
export function growTree(sp: TreeSpecies, seed: number, lod: TreeLod): TreeMeshes {
  const rnd = makeRng(seed * 7919 + sp.key.length * 131 + (lod === 'mid' ? 17 : 0))
  // Same skeleton for both LODs: draw the structural numbers from a stream
  // that does not depend on the LOD, so the mid tree is the near tree
  // simplified rather than a different tree.
  const shapeRnd = makeRng(seed * 7919 + sp.key.length * 131)
  const H = sp.height
  const crown0 = H * sp.crownBase
  const crownH = H - crown0
  const R = (H * sp.crownWidth) / 2
  const near = lod === 'near'
  const bark = new Builder()
  const leaves = new Builder()

  const inside = (p: THREE.Vector3): boolean => {
    const t = (p.y - crown0) / crownH
    const r = envelopeRadius(sp.shape, t) * R
    return Math.hypot(p.x, p.z) <= r
  }

  // --- trunk
  const trunkTop = sp.leader ? H * 0.97 : crown0 + crownH * 0.45
  const trunk: Limb = { pts: [], radii: [] }
  const lean = new THREE.Vector3((shapeRnd() - 0.5) * 0.4, 0, (shapeRnd() - 0.5) * 0.4)
  const trunkSections = near ? 9 : 5
  for (let i = 0; i <= trunkSections; i++) {
    const t = i / trunkSections
    const y = t * trunkTop
    const wob = Math.sin(t * 5 + shapeRnd() * 0.3) * 0.08 * t
    trunk.pts.push(new THREE.Vector3(lean.x * t * t + wob, y, lean.z * t * t - wob * 0.6))
    // root flare at the base, then a steady taper
    const flare = 1 + 0.35 * Math.max(0, 1 - t * 12)
    trunk.radii.push(sp.trunkRadius * flare * (sp.leader ? 1 - 0.92 * t : 1 - 0.55 * t))
  }
  tube(bark, trunk, near ? 9 : 5, H, 0.15)

  const trunkAt = (y: number): THREE.Vector3 => {
    const t = Math.min(1, Math.max(0, y / trunkTop))
    const f = t * trunkSections
    const i = Math.min(trunkSections - 1, Math.floor(f))
    return trunk.pts[i].clone().lerp(trunk.pts[i + 1], f - i)
  }

  // --- scaffolds
  const golden = Math.PI * (3 - Math.sqrt(5))
  const az0 = shapeRnd() * Math.PI * 2
  const scaffolds: Array<{ limb: Limb; dir: THREE.Vector3; len: number }> = []
  const count = sp.scaffolds
  for (let i = 0; i < count; i++) {
    const f = (i + 0.35 + shapeRnd() * 0.3) / count
    const startY = sp.leader
      ? crown0 + crownH * (0.02 + 0.86 * f)
      : crown0 + crownH * (0.0 + 0.4 * f)
    const start = trunkAt(Math.min(startY, trunkTop - 0.2))
    const az = az0 + i * golden + (shapeRnd() - 0.5) * 0.4
    let rise = sp.rise + (shapeRnd() - 0.5) * 0.35
    if (sp.shape === 'pyramid' || sp.shape === 'cone') {
      // low limbs droop, high ones reach up
      rise += (f - 0.45) * 0.9
    }
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(rise), Math.sin(rise), Math.sin(az) * Math.cos(rise))
    // march to the envelope
    let len = 0.4
    const probe = new THREE.Vector3()
    while (len < H) {
      probe.copy(start).addScaledVector(dir, len)
      if (!inside(probe) && len > 0.6) break
      len += 0.3
    }
    len *= 0.82 + shapeRnd() * 0.12
    const end = start.clone().addScaledVector(dir, len)
    // broadleaf limbs arch upward toward the light; conifer limbs sag
    const bend = sp.bark === 'pine' ? -0.12 * len : 0.18 * len
    const mid = start.clone().addScaledVector(dir, len * 0.5).addScaledVector(UP, bend)
    const limb: Limb = { pts: [], radii: [] }
    const sections = near ? 5 : 3
    const r0 = sp.trunkRadius * (sp.bark === 'pine' ? 0.22 : 0.5) * Math.min(1, Math.pow(len / (R + 0.01), 0.7))
    for (let k = 0; k <= sections; k++) {
      const t = k / sections
      limb.pts.push(bezier(start, mid, end, t, new THREE.Vector3()))
      limb.radii.push(Math.max(0.018, r0 * (1 - 0.85 * t)))
    }
    tube(bark, limb, near ? 5 : 3, H, 0.55)
    scaffolds.push({ limb, dir, len })
  }

  // --- twigs (near only) and the points leaf cards hang from
  const anchors: Array<{ p: THREE.Vector3; d: THREE.Vector3 }> = []
  for (const s of scaffolds) {
    const n = s.limb.pts.length
    for (let k = Math.floor(n / 2); k < n; k++) anchors.push({ p: s.limb.pts[k], d: s.dir })
    const tw = sp.twigs
    for (let j = 0; j < tw; j++) {
      const t = 0.35 + 0.6 * ((j + shapeRnd()) / tw)
      const at = bezier(s.limb.pts[0], s.limb.pts[Math.floor(n / 2)], s.limb.pts[n - 1], t, new THREE.Vector3())
      const off = new THREE.Vector3(shapeRnd() - 0.5, shapeRnd() * 0.6 - 0.1, shapeRnd() - 0.5).normalize()
      const d = s.dir.clone().multiplyScalar(0.6).add(off).normalize()
      let len = Math.min(s.len * 0.45, 1.2 + shapeRnd() * 2.2)
      const probe = at.clone().addScaledVector(d, len)
      if (!inside(probe)) len *= 0.6
      const end = at.clone().addScaledVector(d, len)
      if (near) {
        const limb: Limb = {
          pts: [at, at.clone().lerp(end, 0.5).addScaledVector(UP, 0.12 * len), end],
          radii: [Math.max(0.015, s.limb.radii[0] * 0.3), 0.02, 0.012],
        }
        tube(bark, limb, 3, H, 0.8)
      }
      anchors.push({ p: end, d })
      anchors.push({ p: at.clone().lerp(end, 0.55), d })
    }
  }
  if (sp.leader) {
    for (let k = Math.floor(trunk.pts.length * 0.6); k < trunk.pts.length; k++) {
      anchors.push({ p: trunk.pts[k], d: UP.clone() })
    }
  }

  // --- leaf cards
  const cards = near ? sp.cards : Math.round(sp.cards * 0.3)
  const size = sp.cardSize * (near ? 1 : 1.75)
  const centre = new THREE.Vector3(0, crown0 + crownH * 0.5, 0)
  const halfH = crownH / 2
  const p = new THREE.Vector3()
  const up = new THREE.Vector3()
  const right = new THREE.Vector3()
  const nrm = new THREE.Vector3()
  const radial = new THREE.Vector3()
  const corner = new THREE.Vector3()
  for (let c = 0; c < cards; c++) {
    if (rnd() < 0.62 && anchors.length) {
      const a = anchors[Math.floor(rnd() * anchors.length)]
      p.copy(a.p).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(size * 0.7))
    } else {
      // fill the outer shell of the envelope
      const t = Math.pow(rnd(), 0.8)
      const y = crown0 + crownH * (0.05 + 0.93 * t)
      const rr = envelopeRadius(sp.shape, (y - crown0) / crownH) * R * (0.6 + 0.4 * Math.sqrt(rnd()))
      const az = rnd() * Math.PI * 2
      p.set(Math.cos(az) * rr, y, Math.sin(az) * rr)
    }
    radial.set(p.x / R, (p.y - centre.y) / halfH, p.z / R)
    const depth = Math.min(1, radial.length())
    if (radial.lengthSq() < 1e-6) radial.set(0, 1, 0)
    radial.normalize()
    // the twig on the card grows outward and a little up, rolled at random
    up.set(radial.x, radial.y * 0.5 + 0.45, radial.z).add(
      new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.9),
    ).normalize()
    right.crossVectors(up, new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize()
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    nrm.crossVectors(right, up).normalize()
    // bend the shading normal toward the crown sphere
    const shading = nrm.clone().multiplyScalar(nrm.dot(radial) < 0 ? -0.25 : 0.25).addScaledVector(radial, 0.75).normalize()
    const s = size * (0.8 + rnd() * 0.45)
    const cell = near ? sp.cells[Math.floor(rnd() * sp.cells.length)] : sp.midCell
    const [u0, v0, du, dv] = cellRect(cell)
    // ambient occlusion: dark deep inside and underneath the crown
    const heightF = Math.min(1, Math.max(0, (p.y - crown0) / crownH))
    const ao = (0.45 + 0.55 * Math.pow(depth, 1.5)) * (0.72 + 0.28 * heightF)
    const sway = Math.pow(Math.max(0, p.y) / H, 1.5)
    const phase = rnd() * Math.PI * 2
    const base = leaves.pos.length / 3
    // anchor at the bottom-centre of the card
    for (let k = 0; k < 4; k++) {
      const sx = k === 0 || k === 3 ? -0.5 : 0.5
      const sy = k < 2 ? 0 : 1
      corner.copy(p).addScaledVector(right, sx * s).addScaledVector(up, (sy - 0.15) * s)
      leaves.pos.push(corner.x, corner.y, corner.z)
      leaves.nrm.push(shading.x, shading.y, shading.z)
      leaves.uv.push(u0 + (sx + 0.5) * du, v0 + sy * dv)
      leaves.leaf.push(sway * (0.6 + 0.4 * sy), phase, ao)
    }
    leaves.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  let radius = 0
  const box = new THREE.Box3()
  const tmp = new THREE.Vector3()
  for (const b of [bark, leaves]) {
    for (let i = 0; i < b.pos.length; i += 3) {
      tmp.set(b.pos[i], b.pos[i + 1], b.pos[i + 2])
      box.expandByPoint(tmp)
      radius = Math.max(radius, Math.hypot(tmp.x, tmp.z))
    }
  }
  return {
    branches: bark.geometry(),
    leaves: leaves.geometry(),
    height: box.max.y,
    radius,
  }
}
