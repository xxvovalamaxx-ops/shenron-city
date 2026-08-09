/**
 * Source-footprint contract for the W47 authored replacements.
 *
 * The streamed Manhattan tiles are Draco-compressed, and `core.bin` is the
 * runtime source of each building's placement.  This module deliberately
 * derives the footprint from those shipped artifacts instead of trusting an
 * AABB copied into the authored-cluster manifest.  The result is expressed in
 * the same local X/Z frame as a hero GLB: the streamed world footprint is
 * translated by its `core.bin` centre and inverse-rotated by the runtime yaw.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import draco3d from 'draco3d'

import { readGlb } from './glb-utils.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const W47_REPOSITORY_ROOT = resolve(HERE, '..', '..')
const CORE_RECORD_BYTES = 20
const DEFAULT_TILE_SIZE = 1400
const BINARY_CHUNK = 0x004e4942

let decoderModulePromise = null

function decoderModule() {
  decoderModulePromise ??= draco3d.createDecoderModule({})
  return decoderModulePromise
}

function signedTilePart(value) {
  return `${value < 0 ? '-' : '+'}${String(Math.abs(value)).padStart(2, '0')}`
}

function tileFileName(x, y) {
  return `manhattan_${signedTilePart(x)}_${signedTilePart(y)}.glb`
}

function glbBinaryChunk(file) {
  let offset = 12
  while (offset + 8 <= file.length) {
    const length = file.readUInt32LE(offset)
    const type = file.readUInt32LE(offset + 4)
    const chunk = file.subarray(offset + 8, offset + 8 + length)
    if (type === BINARY_CHUNK) return chunk
    offset += 8 + length
  }
  throw new Error('GLB has no binary chunk')
}

function scalarAttribute(module, decoder, mesh, extension, semantic, components) {
  const uniqueId = extension.attributes?.[semantic]
  if (uniqueId === undefined) throw new Error(`Draco primitive is missing ${semantic}`)
  const attribute = decoder.GetAttributeByUniqueId(mesh, uniqueId)
  if (!attribute?.ptr) throw new Error(`Draco primitive has no ${semantic} attribute`)
  const values = new module.DracoFloat32Array()
  decoder.GetAttributeFloatForAllPoints(mesh, attribute, values)
  const count = mesh.num_points() * components
  const out = new Array(count)
  for (let i = 0; i < count; i += 1) out[i] = values.GetValue(i)
  module.destroy(values)
  return out
}

/** Decode just the two attributes and faces needed to recover one footprint. */
function decodeDracoPrimitive(module, document, binary, primitive) {
  const extension = primitive.extensions?.KHR_draco_mesh_compression
  if (!extension) return null
  const view = document.bufferViews?.[extension.bufferView]
  if (!view) throw new Error('Draco primitive refers to a missing buffer view')
  const offset = view.byteOffset ?? 0
  const compressed = binary.subarray(offset, offset + view.byteLength)
  const buffer = new module.DecoderBuffer()
  const decoder = new module.Decoder()
  const mesh = new module.Mesh()
  try {
    buffer.Init(new Int8Array(compressed), compressed.length)
    const status = decoder.DecodeBufferToMesh(buffer, mesh)
    if (!status.ok() || mesh.ptr === 0) throw new Error(`Draco decode failed: ${status.error_msg()}`)

    const positions = scalarAttribute(module, decoder, mesh, extension, 'POSITION', 3)
    const buildingIds = scalarAttribute(module, decoder, mesh, extension, '_BID', 1)
    const face = new module.DracoInt32Array()
    const faces = []
    for (let i = 0; i < mesh.num_faces(); i += 1) {
      decoder.GetFaceFromMesh(mesh, i, face)
      faces.push([face.GetValue(0), face.GetValue(1), face.GetValue(2)])
    }
    module.destroy(face)
    return { positions, buildingIds, faces }
  } finally {
    module.destroy(mesh)
    module.destroy(decoder)
    module.destroy(buffer)
  }
}

function pointKey(point) {
  // Draco emits the same source corner once per face normal. A millimetre is
  // much finer than the source's centimetre-scale coordinate precision while
  // still collapsing those duplicate vertices deterministically.
  return `${point[0].toFixed(3)},${point[1].toFixed(3)}`
}

function comparePointKeys(a, b) {
  const [ax, az] = a.split(',').map(Number)
  const [bx, bz] = b.split(',').map(Number)
  return ax - bx || az - bz || a.localeCompare(b)
}

function ringFromEdges(edges) {
  const points = new Map()
  const neighbours = new Map()
  for (const [a, b] of edges.values()) {
    const ak = pointKey(a)
    const bk = pointKey(b)
    if (ak === bk) continue
    points.set(ak, a)
    points.set(bk, b)
    const an = neighbours.get(ak) ?? new Set()
    const bn = neighbours.get(bk) ?? new Set()
    an.add(bk)
    bn.add(ak)
    neighbours.set(ak, an)
    neighbours.set(bk, bn)
  }
  if (points.size < 3) throw new Error('source footprint has fewer than three boundary vertices')
  for (const [key, adjacent] of neighbours) {
    if (adjacent.size !== 2) throw new Error(`source footprint boundary at ${key} has degree ${adjacent.size}, expected 2`)
  }

  const start = [...points.keys()].sort(comparePointKeys)[0]
  const ring = []
  let previous = null
  let current = start
  while (true) {
    ring.push(points.get(current))
    const options = [...neighbours.get(current)].sort(comparePointKeys)
    const next = options.find((key) => key !== previous)
    if (!next) throw new Error('source footprint ring terminated before closing')
    if (next === start) break
    if (ring.length > points.size) throw new Error('source footprint ring does not close')
    previous = current
    current = next
  }
  if (ring.length !== points.size) {
    throw new Error(`source footprint has ${points.size} vertices but its boundary ring has ${ring.length}`)
  }
  return ring
}

function sourceCore(root) {
  const corePath = join(root, 'public', 'models', 'manhattan', 'data', 'core.bin')
  const bytes = readFileSync(corePath)
  if (bytes.byteLength % CORE_RECORD_BYTES !== 0) throw new Error(`invalid core.bin length: ${bytes.byteLength}`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    count: bytes.byteLength / CORE_RECORD_BYTES,
    get(buildingId) {
      if (!Number.isInteger(buildingId) || buildingId < 0 || buildingId >= this.count) {
        throw new Error(`building ${buildingId} is outside core.bin`)
      }
      const offset = buildingId * CORE_RECORD_BYTES
      return {
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 4, true),
        height: view.getFloat32(offset + 8, true),
      }
    },
  }
}

function addPrimitiveSamples(sample, decoded, wantedIds) {
  const ids = decoded.buildingIds.map((value) => Math.round(value))
  const points = decoded.positions
  for (let vertex = 0; vertex < ids.length; vertex += 1) {
    const id = ids[vertex]
    if (!wantedIds.has(id)) continue
    sample.get(id).points.push([
      points[vertex * 3],
      points[vertex * 3 + 1],
      points[vertex * 3 + 2],
    ])
  }
  for (const indices of decoded.faces) {
    const id = ids[indices[0]]
    if (!wantedIds.has(id) || ids[indices[1]] !== id || ids[indices[2]] !== id) continue
    sample.get(id).triangles.push(indices.map((vertex) => [
      points[vertex * 3],
      points[vertex * 3 + 1],
      points[vertex * 3 + 2],
    ]))
  }
}

function sourceFootprintFromSamples(sample, core, rotationY) {
  const groundY = Math.min(...sample.points.map((point) => point[1]))
  if (!Number.isFinite(groundY)) throw new Error('source building has no decoded vertices')
  const edges = new Map()
  for (const triangle of sample.triangles) {
    const floor = triangle.filter((point) => Math.abs(point[1] - groundY) <= 0.01)
    if (floor.length !== 2) continue
    const a = [floor[0][0], floor[0][2]]
    const b = [floor[1][0], floor[1][2]]
    const key = [pointKey(a), pointKey(b)].sort(comparePointKeys).join('|')
    edges.set(key, [a, b])
  }
  const world = ringFromEdges(edges)
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const local = world.map(([x, z]) => {
    const dx = x - core.x
    const dz = z + core.y
    return [cos * dx - sin * dz, sin * dx + cos * dz]
  })
  return { groundY, world, local }
}

/**
 * Decode the checked-in tile geometry for each W47 building and convert its
 * source footprint into the authored asset-local frame.
 */
export async function deriveW47SourceFootprints(cluster, root = W47_REPOSITORY_ROOT) {
  const core = sourceCore(root)
  const tileSizePath = join(root, 'public', 'models', 'manhattan', 'building_index.json')
  const tileSize = JSON.parse(readFileSync(tileSizePath, 'utf8')).tile_size_m ?? DEFAULT_TILE_SIZE
  const byTile = new Map()
  for (const entry of cluster.buildings) {
    const source = core.get(entry.buildingId)
    const tile = tileFileName(Math.floor(source.x / tileSize), Math.floor(source.y / tileSize))
    const entries = byTile.get(tile) ?? []
    entries.push({ entry, source })
    byTile.set(tile, entries)
  }

  const module = await decoderModule()
  const result = new Map()
  for (const [tile, entries] of byTile) {
    const tilePath = join(root, 'public', 'models', 'manhattan', tile)
    const { file, document } = readGlb(tilePath)
    const binary = glbBinaryChunk(file)
    const wantedIds = new Set(entries.map(({ entry }) => entry.buildingId))
    const samples = new Map(entries.map(({ entry }) => [entry.buildingId, { points: [], triangles: [] }]))
    for (const mesh of document.meshes ?? []) {
      if (!mesh.name?.startsWith('BLD_')) continue
      for (const primitive of mesh.primitives ?? []) {
        const decoded = decodeDracoPrimitive(module, document, binary, primitive)
        if (decoded) addPrimitiveSamples(samples, decoded, wantedIds)
      }
    }
    for (const { entry, source } of entries) {
      const sample = samples.get(entry.buildingId)
      const footprint = sourceFootprintFromSamples(sample, source, entry.rotationY)
      result.set(entry.buildingId, {
        ...footprint,
        source,
        sourceTile: tile,
        envelope: polygonEnvelope(footprint.local),
      })
    }
  }
  return result
}

export function polygonArea(polygon) {
  let twiceArea = 0
  for (let i = 0; i < polygon.length; i += 1) {
    const [x0, z0] = polygon[i]
    const [x1, z1] = polygon[(i + 1) % polygon.length]
    twiceArea += x0 * z1 - x1 * z0
  }
  return twiceArea / 2
}

export function polygonEnvelope(polygon) {
  return polygon.reduce(
    (envelope, [x, z]) => ({
      minX: Math.min(envelope.minX, x),
      maxX: Math.max(envelope.maxX, x),
      minZ: Math.min(envelope.minZ, z),
      maxZ: Math.max(envelope.maxZ, z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  )
}

function pointOnSegment(point, start, end, epsilon = 1e-7) {
  const [px, pz] = point
  const [ax, az] = start
  const [bx, bz] = end
  const cross = (px - ax) * (bz - az) - (pz - az) * (bx - ax)
  if (Math.abs(cross) > epsilon) return false
  const dot = (px - ax) * (px - bx) + (pz - az) * (pz - bz)
  return dot <= epsilon
}

/** Includes the boundary: hero shell vertices are allowed to sit on it. */
export function pointInPolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const start = polygon[j]
    const end = polygon[i]
    if (pointOnSegment(point, start, end)) return true
    const [xi, zi] = end
    const [xj, zj] = start
    if ((zi > point[1]) !== (zj > point[1])) {
      const xAtZ = ((xj - xi) * (point[1] - zi)) / (zj - zi) + xi
      if (point[0] < xAtZ) inside = !inside
    }
  }
  return inside
}

function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1])
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared))
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dz))
}

/** Metres outside a source footprint; zero is inside or on its boundary. */
export function distanceOutsideFootprint(point, polygon) {
  if (pointInPolygon(point, polygon)) return 0
  let distance = Infinity
  for (let i = 0; i < polygon.length; i += 1) {
    distance = Math.min(distance, distanceToSegment(point, polygon[i], polygon[(i + 1) % polygon.length]))
  }
  return distance
}

export function pointWithinFootprint(point, polygon, tolerance = 0) {
  return distanceOutsideFootprint(point, polygon) <= tolerance + 1e-8
}

export function segmentWithinFootprint(start, end, polygon, tolerance = 0) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  const samples = Math.max(2, Math.ceil(length / 0.1))
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    if (!pointWithinFootprint([start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t], polygon, tolerance)) {
      return false
    }
  }
  return true
}

export function ringWithinFootprint(ring, polygon, tolerance = 0) {
  return ring.every((point, i) => segmentWithinFootprint(point, ring[(i + 1) % ring.length], polygon, tolerance))
}

function polygonCentroid(polygon) {
  const area = polygonArea(polygon)
  if (Math.abs(area) < 1e-9) return [0, 0]
  let x = 0
  let z = 0
  for (let i = 0; i < polygon.length; i += 1) {
    const [x0, z0] = polygon[i]
    const [x1, z1] = polygon[(i + 1) % polygon.length]
    const cross = x0 * z1 - x1 * z0
    x += (x0 + x1) * cross
    z += (z0 + z1) * cross
  }
  return [x / (6 * area), z / (6 * area)]
}

/**
 * Contract a source ring for setbacks while proving every contracted edge is
 * still inside the real (possibly concave) source polygon.  If the requested
 * amount would cross a small concavity, use the largest safe deterministic
 * fallback instead of silently leaking through the lot boundary.
 */
export function contractedFootprint(polygon, targetFactor) {
  const anchors = [polygonCentroid(polygon), [0, 0], ...polygon]
  for (const anchor of anchors) {
    if (!pointInPolygon(anchor, polygon)) continue
    for (let step = 0; step <= 35; step += 1) {
      const factor = Math.max(0.3, targetFactor - step * 0.02)
      const candidate = polygon.map(([x, z]) => [
        anchor[0] + (x - anchor[0]) * factor,
        anchor[1] + (z - anchor[1]) * factor,
      ])
      if (ringWithinFootprint(candidate, polygon)) return candidate
      if (factor === 0.3) break
    }
  }
  throw new Error('could not derive a contained setback footprint')
}

function accessorComponents(type) {
  return { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type] ?? 0
}

function accessorComponentSize(componentType) {
  return { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[componentType] ?? 0
}

function readFloatAccessor(document, binary, accessorIndex) {
  const accessor = document.accessors?.[accessorIndex]
  if (!accessor || accessor.componentType !== 5126) throw new Error(`expected Float32 accessor ${accessorIndex}`)
  const view = document.bufferViews?.[accessor.bufferView]
  const components = accessorComponents(accessor.type)
  const componentSize = accessorComponentSize(accessor.componentType)
  if (!view || !components || !componentSize) throw new Error(`invalid accessor ${accessorIndex}`)
  const stride = view.byteStride ?? components * componentSize
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const out = []
  for (let i = 0; i < accessor.count; i += 1) {
    const row = []
    for (let c = 0; c < components; c += 1) row.push(binary.readFloatLE(offset + i * stride + c * componentSize))
    out.push(row)
  }
  return out
}

/** Decode every authored local horizontal vertex, including trim and roof kit. */
export function authoredHorizontalVertices(path) {
  const { file, document } = readGlb(path)
  const binary = glbBinaryChunk(file)
  const positions = []
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = primitive.attributes?.POSITION
      if (accessor === undefined) continue
      for (const [x, , z] of readFloatAccessor(document, binary, accessor)) positions.push([x, z])
    }
  }
  return positions
}

export function authoredContainmentStats(path, polygon, tolerance) {
  const positions = authoredHorizontalVertices(path)
  let strictOutside = 0
  let beyondTolerance = 0
  let maxOutsideMetres = 0
  for (const point of positions) {
    const outside = distanceOutsideFootprint(point, polygon)
    if (outside > 1e-6) strictOutside += 1
    if (outside > tolerance + 1e-8) beyondTolerance += 1
    maxOutsideMetres = Math.max(maxOutsideMetres, outside)
  }
  return { vertices: positions.length, strictOutside, beyondTolerance, maxOutsideMetres }
}
