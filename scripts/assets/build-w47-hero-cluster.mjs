/**
 * Deterministically author the first persistent W47 rooftop-canyon cluster.
 *
 * Geometry is original parametric work: no network access, textures, brands,
 * or third-party meshes.  Unlike the first pass, each hero GLB is authored
 * against the exact Draco-decoded source footprint, inverse-rotated into the
 * hero asset's local frame.  This matters for the skewed and concave W47 lots:
 * an AABB that fits the lot envelope can still spill into a street.
 *
 * Usage: node scripts/assets/build-w47-hero-cluster.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildGlb } from './glb-write.mjs'
import { glbBounds, glbMetrics, readGlb } from './glb-utils.mjs'
import {
  authoredContainmentStats,
  contractedFootprint,
  deriveW47SourceFootprints,
  polygonArea,
  polygonEnvelope,
  ringWithinFootprint,
  segmentWithinFootprint,
} from './w47-footprint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const SPEC_PATH = join(ROOT, 'src', 'world', 'w47-hero-cluster.json')
const OUT = join(ROOT, 'public', 'models', 'manhattan', 'hero', 'w47')
const CLUSTER = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))
const FOOTPRINT_TOLERANCE_METRES = CLUSTER.footprintContainmentToleranceMetres
if (!(FOOTPRINT_TOLERANCE_METRES >= 0 && FOOTPRINT_TOLERANCE_METRES <= 0.05)) {
  throw new Error('W47 footprint containment tolerance must be between 0 and 0.05 metres')
}

function verifiedSourceArtifacts() {
  if (!Array.isArray(CLUSTER.sourceArtifacts) || CLUSTER.sourceArtifacts.length === 0) {
    throw new Error('W47 sourceArtifacts must bind every checked-in source artifact')
  }
  return CLUSTER.sourceArtifacts.map(({ path, sha256 }) => {
    if (typeof path !== 'string' || path.startsWith('/') || path.includes('..')) {
      throw new Error(`invalid W47 source artifact path: ${path}`)
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`invalid W47 source artifact SHA-256: ${path}`)
    }
    const actual = createHash('sha256').update(readFileSync(join(ROOT, ...path.split('/')))).digest('hex')
    if (actual !== sha256) {
      throw new Error(`W47 source artifact hash mismatch: ${path}`)
    }
    return { path, sha256 }
  })
}

const MATERIALS = [
  { name: 'W47_masonry', baseColor: [0.48, 0.43, 0.36, 1], metallic: 0, roughness: 0.88 },
  { name: 'W47_trim', baseColor: [0.72, 0.68, 0.58, 1], metallic: 0.02, roughness: 0.72 },
  { name: 'W47_window', baseColor: [0.055, 0.075, 0.09, 1], metallic: 0.18, roughness: 0.2, emissive: [0.018, 0.014, 0.009] },
  { name: 'W47_roof', baseColor: [0.13, 0.14, 0.14, 1], metallic: 0.08, roughness: 0.82 },
  { name: 'W47_roof_metal', baseColor: [0.34, 0.37, 0.37, 1], metallic: 0.68, roughness: 0.42 },
  { name: 'W47_sign_frame', baseColor: [0.22, 0.19, 0.15, 1], metallic: 0.74, roughness: 0.4 },
]

const PALETTES = {
  'buff-brick hotel': [0.48, 0.39, 0.29, 1],
  'limestone early-skyscraper': [0.62, 0.58, 0.48, 1],
  'white-brick residential': [0.67, 0.66, 0.6, 1],
  'dark-glass loft': [0.23, 0.25, 0.25, 1],
}

function mesh(name, material) {
  return { name, material, positions: [], normals: [], indices: [] }
}

function faceNormal(points) {
  const [a, b, c] = points
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz)
  return length > 1e-9 ? [nx / length, ny / length, nz / length] : [0, 1, 0]
}

function quad(out, points) {
  const at = out.positions.length / 3
  const normal = faceNormal(points)
  for (const point of points) out.positions.push(...point)
  for (let i = 0; i < 4; i += 1) out.normals.push(...normal)
  out.indices.push(at, at + 1, at + 2, at, at + 2, at + 3)
}

function triangle(out, points) {
  const at = out.positions.length / 3
  const normal = faceNormal(points)
  for (const point of points) out.positions.push(...point)
  for (let i = 0; i < 3; i += 1) out.normals.push(...normal)
  out.indices.push(at, at + 1, at + 2)
}

function pointInTriangle(point, a, b, c, orientation) {
  const cross = (p0, p1, p2) =>
    (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0])
  const epsilon = 1e-8
  const ab = orientation * cross(a, b, point)
  const bc = orientation * cross(b, c, point)
  const ca = orientation * cross(c, a, point)
  return ab > epsilon && bc > epsilon && ca > epsilon
}

/** Ear clipping is enough for the six simple source lots, including 34687's notch. */
function triangulateRing(ring) {
  const orientation = Math.sign(polygonArea(ring))
  if (!orientation) throw new Error('cannot triangulate zero-area footprint')
  const remaining = ring.map((_, index) => index)
  const triangles = []
  while (remaining.length > 3) {
    let clipped = false
    for (let i = 0; i < remaining.length; i += 1) {
      const previous = remaining[(i - 1 + remaining.length) % remaining.length]
      const current = remaining[i]
      const next = remaining[(i + 1) % remaining.length]
      const a = ring[previous]
      const b = ring[current]
      const c = ring[next]
      const corner = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
      if (orientation * corner <= 1e-8) continue
      const containsOtherPoint = remaining.some((index) =>
        index !== previous && index !== current && index !== next && pointInTriangle(ring[index], a, b, c, orientation))
      if (containsOtherPoint) continue
      triangles.push([previous, current, next])
      remaining.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) throw new Error('could not ear-clip source footprint')
  }
  triangles.push([remaining[0], remaining[1], remaining[2]])
  return { orientation, triangles }
}

/** Extrude a source-derived polygon without ever replacing it with a rectangle. */
function prism(out, ring, bottom, height) {
  const { orientation, triangles } = triangulateRing(ring)
  const top = bottom + height
  for (const indices of triangles) {
    const lower = indices.map((index) => [ring[index][0], bottom, ring[index][1]])
    const upper = indices.map((index) => [ring[index][0], top, ring[index][1]])
    // In X/Z, a CCW triangle faces -Y. Reverse it for the top and leave it
    // alone for the bottom; CW rings are the opposite.
    triangle(out, orientation > 0 ? [upper[0], upper[2], upper[1]] : upper)
    triangle(out, orientation > 0 ? lower : [lower[0], lower[2], lower[1]])
  }
  for (let i = 0; i < ring.length; i += 1) {
    const start = ring[i]
    const end = ring[(i + 1) % ring.length]
    const a0 = [start[0], bottom, start[1]]
    const a1 = [start[0], top, start[1]]
    const b0 = [end[0], bottom, end[1]]
    const b1 = [end[0], top, end[1]]
    // The original ring order points side faces outward.
    quad(out, orientation > 0 ? [a0, a1, b1, b0] : [b0, b1, a1, a0])
  }
}

function rectangleRing(cx, cz, width, depth) {
  const halfWidth = width / 2
  const halfDepth = depth / 2
  return [
    [cx - halfWidth, cz - halfDepth],
    [cx + halfWidth, cz - halfDepth],
    [cx + halfWidth, cz + halfDepth],
    [cx - halfWidth, cz + halfDepth],
  ]
}

/** Add a footprint-safe rectangular roof object. */
function roofBox(out, pad, relativeX, relativeZ, widthRatio, depthRatio, y, height) {
  const width = Math.max(0.32, Math.min(pad.width * widthRatio, pad.width * 0.82))
  const depth = Math.max(0.32, Math.min(pad.depth * depthRatio, pad.depth * 0.82))
  const maxX = Math.max(0, pad.width / 2 - width / 2 - 0.03)
  const maxZ = Math.max(0, pad.depth / 2 - depth / 2 - 0.03)
  const ring = rectangleRing(
    pad.x + Math.max(-maxX, Math.min(maxX, relativeX * pad.width)),
    pad.z + Math.max(-maxZ, Math.min(maxZ, relativeZ * pad.depth)),
    width,
    depth,
  )
  if (!ringWithinFootprint(ring, pad.polygon)) throw new Error('roof object escaped its safe roof pad')
  prism(out, ring, y - height / 2, height)
}

/**
 * A physical facade strip can project 3.2 cm from the source edge.  That is
 * below the manifest's 5 cm documented tolerance, while the remainder of the
 * strip is sunk back into the lot.  At a concave corner it is omitted rather
 * than allowed to leak across the polygon.
 */
function facadeStrip(out, ring, sourcePolygon, y, height, outerDepth, innerDepth) {
  const orientation = Math.sign(polygonArea(ring))
  let added = 0
  for (let i = 0; i < ring.length; i += 1) {
    const start = ring[i]
    const end = ring[(i + 1) % ring.length]
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.5) continue
    const tangent = [dx / length, dz / length]
    const inward = orientation > 0 ? [-tangent[1], tangent[0]] : [tangent[1], -tangent[0]]
    const shorten = Math.min(0.26, length * 0.12)
    const a = [start[0] + tangent[0] * shorten, start[1] + tangent[1] * shorten]
    const b = [end[0] - tangent[0] * shorten, end[1] - tangent[1] * shorten]
    const strip = [
      [a[0] - inward[0] * outerDepth, a[1] - inward[1] * outerDepth],
      [b[0] - inward[0] * outerDepth, b[1] - inward[1] * outerDepth],
      [b[0] + inward[0] * innerDepth, b[1] + inward[1] * innerDepth],
      [a[0] + inward[0] * innerDepth, a[1] + inward[1] * innerDepth],
    ]
    if (!ringWithinFootprint(strip, sourcePolygon, FOOTPRINT_TOLERANCE_METRES)) continue
    prism(out, strip, y - height / 2, height)
    added += 1
  }
  return added
}

/**
 * Window ribbons are intentionally planar. Their outward face remains 3.2 cm
 * from the source edge, which keeps the relief visible without spending the
 * twelve triangles of a full trim box at every floor and every wall segment.
 */
function facadePanel(out, ring, sourcePolygon, y, height, outerDepth) {
  const orientation = Math.sign(polygonArea(ring))
  let added = 0
  for (let i = 0; i < ring.length; i += 1) {
    const start = ring[i]
    const end = ring[(i + 1) % ring.length]
    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const length = Math.hypot(dx, dz)
    if (length < 0.5) continue
    const tangent = [dx / length, dz / length]
    const inward = orientation > 0 ? [-tangent[1], tangent[0]] : [tangent[1], -tangent[0]]
    const shorten = Math.min(0.26, length * 0.12)
    const a = [
      start[0] + tangent[0] * shorten - inward[0] * outerDepth,
      start[1] + tangent[1] * shorten - inward[1] * outerDepth,
    ]
    const b = [
      end[0] - tangent[0] * shorten - inward[0] * outerDepth,
      end[1] - tangent[1] * shorten - inward[1] * outerDepth,
    ]
    if (!segmentWithinFootprint(a, b, sourcePolygon, FOOTPRINT_TOLERANCE_METRES)) continue
    const lowerA = [a[0], y - height / 2, a[1]]
    const upperA = [a[0], y + height / 2, a[1]]
    const lowerB = [b[0], y - height / 2, b[1]]
    const upperB = [b[0], y + height / 2, b[1]]
    quad(out, orientation > 0 ? [lowerA, upperA, upperB, lowerB] : [lowerB, upperB, upperA, lowerA])
    added += 1
  }
  return added
}

function sectionsFor(entry, sourcePolygon) {
  const h = entry.height
  const ground = Math.min(5.2, h * 0.22)
  if (h < 22) return [
    { y0: 0, h: ground, polygon: sourcePolygon },
    { y0: ground, h: h - ground, polygon: contractedFootprint(sourcePolygon, 0.9) },
  ]
  const middle = (h - ground) * (h > 60 ? 0.58 : 0.67)
  const upper = h - ground - middle
  return [
    { y0: 0, h: ground, polygon: sourcePolygon },
    { y0: ground, h: middle, polygon: contractedFootprint(sourcePolygon, 0.91) },
    { y0: ground + middle, h: upper, polygon: contractedFootprint(sourcePolygon, 0.72) },
  ]
}

function addFacadeRelief(glass, trim, section, sourcePolygon, floorHeight = 3.25) {
  const floors = Math.max(1, Math.floor(section.h / floorHeight))
  const step = section.h / floors
  const ribbonHeight = Math.min(1.45, step * 0.48)
  for (let floor = 0; floor < floors; floor += 1) {
    const y = section.y0 + step * (floor + 0.58)
    facadePanel(glass, section.polygon, sourcePolygon, y, ribbonHeight, 0.032)
    if (floor % 3 === 0) {
      facadeStrip(trim, section.polygon, sourcePolygon, section.y0 + step * (floor + 1), 0.16, 0.034, 0.11)
    }
  }
}

function addParapet(out, polygon, sourcePolygon, roofY, coarse = false) {
  facadeStrip(out, polygon, sourcePolygon, roofY + (coarse ? 0.525 : 0.6), coarse ? 1.05 : 1.2, 0.034, coarse ? 0.26 : 0.2)
}

function padWithinPolygon(polygon, ring) {
  return ringWithinFootprint(ring, polygon)
}

/** Find the largest practical, axis-aligned roof pad that is entirely inside a (possibly concave) top footprint. */
function roofPad(polygon) {
  const envelope = polygonEnvelope(polygon)
  const spanX = envelope.maxX - envelope.minX
  const spanZ = envelope.maxZ - envelope.minZ
  const center = [(envelope.minX + envelope.maxX) / 2, (envelope.minZ + envelope.maxZ) / 2]
  const candidates = [[0, 0], center, ...polygon]
  const step = Math.max(0.45, Math.min(spanX, spanZ) / 28)
  for (const scale of [0.42, 0.36, 0.31, 0.27, 0.23, 0.19, 0.15, 0.11]) {
    const width = Math.max(2.2, spanX * scale)
    const depth = Math.max(2.2, spanZ * scale)
    const halfWidth = width / 2
    const halfDepth = depth / 2
    let best = null
    const consider = (x, z) => {
      const ring = rectangleRing(x, z, width, depth)
      if (!padWithinPolygon(polygon, ring)) return
      const score = x * x + z * z
      if (!best || score < best.score || (score === best.score && (x < best.x || (x === best.x && z < best.z)))) {
        best = { x, z, width, depth, polygon, score }
      }
    }
    for (const [x, z] of candidates) consider(x, z)
    for (let z = envelope.minZ + halfDepth; z <= envelope.maxZ - halfDepth + 1e-8; z += step) {
      for (let x = envelope.minX + halfWidth; x <= envelope.maxX - halfWidth + 1e-8; x += step) consider(x, z)
    }
    if (best) return best
  }
  throw new Error('could not locate a roof pad inside source footprint')
}

function cylinder(out, cx, bottom, cz, r0, r1, height, segments = 10) {
  const top = bottom + height
  for (let i = 0; i < segments; i += 1) {
    const a0 = i * Math.PI * 2 / segments
    const a1 = (i + 1) * Math.PI * 2 / segments
    const p0 = [cx + Math.cos(a0) * r0, bottom, cz + Math.sin(a0) * r0]
    const p1 = [cx + Math.cos(a0) * r1, top, cz + Math.sin(a0) * r1]
    const p2 = [cx + Math.cos(a1) * r1, top, cz + Math.sin(a1) * r1]
    const p3 = [cx + Math.cos(a1) * r0, bottom, cz + Math.sin(a1) * r0]
    quad(out, [p0, p1, p2, p3])
    triangle(out, [[cx, bottom, cz], p3, p0])
    triangle(out, [[cx, top, cz], p1, p2])
  }
}

function addWaterTower(metal, frame, roofY, pad, coarse) {
  const radius = Math.min(2.35, pad.width * 0.17, pad.depth * 0.17)
  const legHeight = coarse ? 3.1 : 4.2
  if (!coarse) {
    for (const x of [-radius * 0.62, radius * 0.62]) {
      for (const z of [-radius * 0.62, radius * 0.62]) {
        roofBox(frame, pad, x / pad.width, z / pad.depth, 0.06, 0.06, roofY + legHeight / 2, legHeight)
      }
    }
  } else {
    roofBox(frame, pad, 0, 0, 0.35, 0.35, roofY + legHeight / 2, legHeight)
  }
  cylinder(metal, pad.x, roofY + legHeight, pad.z, radius, radius * 0.88, 2.7, coarse ? 8 : 12)
  cylinder(metal, pad.x, roofY + legHeight + 2.7, pad.z, radius * 0.88, 0.16, 1.15, coarse ? 8 : 12)
}

function addHvac(metal, roofY, pad, coarse) {
  roofBox(metal, pad, -0.14, 0.08, 0.42, 0.34, roofY + 1.15, 2.3)
  roofBox(metal, pad, 0.16, -0.13, 0.32, 0.28, roofY + 0.8, 1.6)
  if (!coarse) {
    for (let i = -2; i <= 2; i += 1) roofBox(metal, pad, -0.14 + i * 0.05, 0.25, 0.025, 0.025, roofY + 1.15, 1.45)
    roofBox(metal, pad, 0, 0, 0.62, 0.12, roofY + 0.36, 0.72)
    roofBox(metal, pad, 0.17, 0, 0.08, 0.08, roofY + 1.35, 2.7)
  }
}

function addBillboard(frame, roofY, pad, coarse) {
  const width = Math.min(12, pad.width * 0.68)
  const height = coarse ? 4.2 : 5.5
  const z = -0.12
  for (const x of [-width / 2, width / 2]) {
    roofBox(frame, pad, x / pad.width, z, 0.036, 0.036, roofY + height / 2, height)
  }
  roofBox(frame, pad, 0, z, width / pad.width, 0.04, roofY + height, 0.25)
  roofBox(frame, pad, 0, z, width / pad.width, 0.032, roofY + height * 0.43, 0.2)
  if (!coarse) roofBox(frame, pad, 0, z, 0.032, 0.04, roofY + height * 0.72, height * 0.56)
}

function addRoofKit(meshes, entry, roofPolygon, coarse) {
  const metal = meshes[4]
  const frame = meshes[5]
  const pad = roofPad(roofPolygon)
  const roof = entry.height
  const kit = entry.roofKit
  if (kit.includes('water-tower')) addWaterTower(metal, frame, roof, pad, coarse)
  if (kit.includes('hvac') || kit.includes('ducts')) addHvac(metal, roof, pad, coarse)
  if (kit.includes('billboard')) addBillboard(frame, roof, pad, coarse)
  if (kit.includes('ducts') && !coarse) {
    roofBox(metal, pad, 0, 0.16, 0.56, 0.12, roof + 0.45, 0.9)
    for (const x of [-0.18, 0, 0.18]) roofBox(metal, pad, x, 0.16, 0.06, 0.06, roof + 1.65, 3.3)
  }
}

function build(entry, sourcePolygon, lod) {
  const materials = MATERIALS.map((material, index) => index === 0
    ? { ...material, baseColor: PALETTES[entry.facade] ?? material.baseColor }
    : material)
  const meshes = materials.map((_, index) => mesh(`W47_${entry.buildingId}_${lod}_m${index}`, index))
  const sections = sectionsFor(entry, sourcePolygon)
  for (const section of sections) prism(meshes[0], section.polygon, section.y0, section.h)
  const top = sections.at(-1)
  addParapet(meshes[3], top.polygon, sourcePolygon, entry.height, lod === 'lod1')

  if (lod === 'lod0') {
    for (const section of sections) addFacadeRelief(meshes[2], meshes[1], section, sourcePolygon)
    const ground = sections[0]
    facadePanel(meshes[2], ground.polygon, sourcePolygon, ground.h * 0.49, ground.h * 0.64, 0.032)
    facadeStrip(meshes[1], ground.polygon, sourcePolygon, ground.h * 0.78, 0.28, 0.034, 0.1)
  } else {
    const ground = sections[0]
    facadePanel(meshes[2], ground.polygon, sourcePolygon, ground.h * 0.5, ground.h * 0.64, 0.026)
  }
  addRoofKit(meshes, entry, top.polygon, lod === 'lod1')
  const used = meshes.filter((item) => item.indices.length > 0)
  return buildGlb({
    meshes: used,
    materials,
    generator: `shenron-city original W47 parametric authoring ${CLUSTER.clusterId}`,
  })
}

function roundedPolygon(polygon) {
  return polygon.map(([x, z]) => [+x.toFixed(6), +z.toFixed(6)])
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const sourceArtifacts = verifiedSourceArtifacts()
  const sourceFootprints = await deriveW47SourceFootprints(CLUSTER, ROOT)
  const report = {
    clusterId: CLUSTER.clusterId,
    source: CLUSTER.source,
    sourceArtifacts,
    deterministic: true,
    footprintContainment: {
      contract: 'every authored local X/Z vertex is inside the Draco-decoded source footprint or no more than the documented tolerance outside it',
      toleranceMetres: FOOTPRINT_TOLERANCE_METRES,
      source: 'public/models/manhattan/data/core.bin plus Draco-compressed public/models/manhattan/manhattan_* tile geometry',
    },
    entries: [],
    totals: { bytes: 0, triangles: 0 },
  }
  for (const entry of CLUSTER.buildings) {
    const footprint = sourceFootprints.get(entry.buildingId)
    if (!footprint) throw new Error(`missing source footprint for ${entry.buildingId}`)
    const result = {
      buildingId: entry.buildingId,
      osmId: entry.osmId,
      sourceFootprint: {
        tile: footprint.sourceTile,
        core: {
          x: +footprint.source.x.toFixed(6),
          y: +footprint.source.y.toFixed(6),
          height: +footprint.source.height.toFixed(6),
        },
        gltfGroundY: footprint.groundY,
        localInverseYawPolygon: roundedPolygon(footprint.local),
        envelope: Object.fromEntries(Object.entries(footprint.envelope).map(([key, value]) => [key, +value.toFixed(6)])),
      },
      files: {},
    }
    for (const lod of ['lod0', 'lod1']) {
      const fileName = `building-${entry.buildingId}-${lod}.glb`
      const path = join(OUT, fileName)
      writeFileSync(path, build(entry, footprint.local, lod))
      const parsed = readGlb(path)
      const metrics = glbMetrics(parsed.document)
      const bounds = glbBounds(parsed.document)
      const containment = authoredContainmentStats(path, footprint.local, FOOTPRINT_TOLERANCE_METRES)
      const budget = entry.budgets[lod]
      if (containment.beyondTolerance !== 0) {
        throw new Error(`${entry.buildingId} ${lod}: ${containment.beyondTolerance} vertices exceed footprint tolerance`)
      }
      if (parsed.file.length > budget.maxBytes || metrics.triangles > budget.maxTriangles) {
        throw new Error(`${entry.buildingId} ${lod}: exceeded authored asset budget`)
      }
      result.files[lod] = {
        url: `/models/manhattan/hero/w47/${fileName}`,
        bytes: parsed.file.length,
        triangles: metrics.triangles,
        meshes: metrics.meshes,
        materials: metrics.materials,
        bounds,
        containment,
      }
      report.totals.bytes += parsed.file.length
      report.totals.triangles += metrics.triangles
    }
    report.entries.push(result)
  }
  writeFileSync(join(OUT, 'asset-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  for (const entry of report.entries) {
    const lod0 = entry.files.lod0
    const lod1 = entry.files.lod1
    console.log(`${entry.buildingId}: LOD0 ${lod0.triangles} tris/${lod0.bytes} B; LOD1 ${lod1.triangles} tris/${lod1.bytes} B; footprint breaches ${lod0.containment.beyondTolerance}/${lod1.containment.beyondTolerance}`)
  }
  console.log(`total: ${report.totals.triangles} tris, ${report.totals.bytes} bytes`)
}

await main()
