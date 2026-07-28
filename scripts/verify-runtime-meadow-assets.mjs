import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEXTURE_RECEIPT_PATH = path.join(
  ROOT,
  'SourceAssets/Models/Environment/runtime-meadow-receipt.json',
)
const GEOMETRY_RECEIPT_PATH = path.join(
  ROOT,
  'SourceAssets/Models/Environment/runtime-meadow-geometry-receipt.json',
)
const SOURCE_RECEIPT_PATH = path.join(
  ROOT,
  'SourceAssets/Models/Environment/polyhaven-meadow-receipt.json',
)
const EXPECTED_TEXTURES = [
  'public/textures/nature/meadow/forest-ground-04-albedo.webp',
  'public/textures/nature/meadow/forest-ground-04-normal.webp',
  'public/textures/nature/meadow/forest-ground-04-roughness.webp',
  'public/textures/nature/meadow/brown-mud-leaves-01-albedo.webp',
  'public/textures/nature/meadow/brown-mud-leaves-01-normal.webp',
  'public/textures/nature/meadow/grass-medium-01-albedo.webp',
  'public/textures/nature/meadow/grass-medium-01-alpha.webp',
  'public/textures/nature/meadow/fern-02-albedo.webp',
  'public/textures/nature/meadow/fern-02-alpha.webp',
  'public/textures/nature/meadow/weed-plant-02-albedo.webp',
  'public/textures/nature/meadow/weed-plant-02-alpha.webp',
]
const EXPECTED_NODES = [
  'MeadowGrassFine',
  'MeadowGrassTall',
  'MeadowFern',
  'MeadowWeed',
]

function fail(message) {
  throw new Error(`Runtime meadow verification failed: ${message}`)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function webpDimensions(buffer) {
  if (
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    fail('runtime texture is not a WebP file')
  }
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    const data = offset + 8
    if (type === 'VP8X' && data + 10 <= buffer.length) {
      return {
        width: 1 + buffer.readUIntLE(data + 4, 3),
        height: 1 + buffer.readUIntLE(data + 7, 3),
      }
    }
    if (type === 'VP8 ' && data + 10 <= buffer.length) {
      if (buffer.toString('hex', data + 3, data + 6) !== '9d012a') {
        fail('runtime texture has an invalid VP8 frame header')
      }
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff,
      }
    }
    if (type === 'VP8L' && data + 5 <= buffer.length) {
      if (buffer[data] !== 0x2f) fail('runtime texture has an invalid VP8L header')
      const bits = buffer.readUInt32LE(data + 1)
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      }
    }
    offset += 8 + length + (length % 2)
  }
  fail('runtime texture has no supported WebP image chunk')
}

function glbDocument(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'glTF') fail('template pack has invalid GLB magic')
  if (buffer.readUInt32LE(4) !== 2) fail('template pack is not GLB version 2')
  if (buffer.readUInt32LE(8) !== buffer.length) fail('template pack has invalid byte length')
  let offset = 12
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    const chunk = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) {
      return JSON.parse(chunk.toString('utf8').replace(/\0+$/, '').trimEnd())
    }
    offset += 8 + length
  }
  fail('template pack has no JSON chunk')
}

const [textureReceipt, geometryReceipt, sourceReceipt] = await Promise.all([
  readFile(TEXTURE_RECEIPT_PATH, 'utf8').then(JSON.parse),
  readFile(GEOMETRY_RECEIPT_PATH, 'utf8').then(JSON.parse),
  readFile(SOURCE_RECEIPT_PATH, 'utf8').then(JSON.parse),
])

if (
  textureReceipt.schemaVersion !== 1 ||
  geometryReceipt.schemaVersion !== 1 ||
  textureReceipt.license !== 'CC0-1.0' ||
  geometryReceipt.license !== 'CC0-1.0'
) {
  fail('receipts do not use the reviewed schema and CC0 license')
}

const sourcePins = new Map(
  sourceReceipt.assets.flatMap((asset) =>
    asset.files.map((file) => [`${asset.id}/${file.filename}`, file.md5]),
  ),
)
const runtimePaths = textureReceipt.outputs.map((output) => output.runtimePath)
if (JSON.stringify(runtimePaths) !== JSON.stringify(EXPECTED_TEXTURES)) {
  fail(`unexpected texture set: ${runtimePaths.join(', ')}`)
}

let totalBytes = 0
for (const output of textureReceipt.outputs) {
  const expectedSourceMd5 = sourcePins.get(`${output.assetId}/${output.source}`)
  if (!expectedSourceMd5 || expectedSourceMd5 !== output.sourceMd5) {
    fail(`${output.runtimePath} is detached from its pinned source`)
  }
  const buffer = await readFile(path.join(ROOT, output.runtimePath))
  const dimensions = webpDimensions(buffer)
  if (dimensions.width !== 1024 || dimensions.height !== 1024) {
    fail(`${output.runtimePath} is ${dimensions.width}x${dimensions.height}`)
  }
  if (
    output.width !== 1024 ||
    output.height !== 1024 ||
    output.format !== 'webp' ||
    output.bytes !== buffer.length ||
    output.runtimeSha256 !== sha256(buffer)
  ) {
    fail(`${output.runtimePath} does not match its receipt`)
  }
  if (buffer.length < 10_000) fail(`${output.runtimePath} is suspiciously small`)
  totalBytes += buffer.length
}

if (
  geometryReceipt.runtimePath !== 'public/models/environment/meadow-templates.glb' ||
  JSON.stringify(geometryReceipt.nodes) !== JSON.stringify(EXPECTED_NODES) ||
  geometryReceipt.materials !== 0 ||
  geometryReceipt.textures !== 0
) {
  fail('geometry receipt has an unexpected package contract')
}
const geometry = await readFile(path.join(ROOT, geometryReceipt.runtimePath))
if (
  geometry.length !== geometryReceipt.bytes ||
  sha256(geometry) !== geometryReceipt.runtimeSha256
) {
  fail('geometry package does not match its receipt')
}
const document = glbDocument(geometry)
const nodeNames = (document.nodes ?? []).map((node) => node.name)
if (JSON.stringify(nodeNames) !== JSON.stringify(EXPECTED_NODES)) {
  fail(`unexpected GLB nodes: ${nodeNames.join(', ')}`)
}
if (
  (document.materials?.length ?? 0) !== 0 ||
  (document.images?.length ?? 0) !== 0 ||
  (document.textures?.length ?? 0) !== 0
) {
  fail('geometry-only package contains material or texture payloads')
}
const primitives = (document.meshes ?? []).flatMap((mesh) => mesh.primitives ?? [])
if (primitives.length !== EXPECTED_NODES.length) {
  fail(`template pack contains ${primitives.length} primitives`)
}
if (primitives.some((primitive) => primitive.extensions?.KHR_draco_mesh_compression)) {
  fail('template pack requires a remote Draco decoder')
}
const triangles = primitives.reduce((total, primitive) => {
  const accessor = document.accessors?.[primitive.indices]
  if (!accessor || accessor.type !== 'SCALAR' || accessor.count % 3 !== 0) {
    fail('template primitive has an invalid triangle index accessor')
  }
  return total + accessor.count / 3
}, 0)
if (triangles !== geometryReceipt.triangles || triangles > 3_000) {
  fail(`template pack has ${triangles} triangles`)
}

totalBytes += geometry.length
if (totalBytes > 3.2 * 1024 * 1024) {
  fail(`runtime package is ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`)
}

console.log(
  `Runtime meadow verified: ${EXPECTED_TEXTURES.length} pinned 1K maps, ` +
    `${EXPECTED_NODES.length} geometry templates, ${triangles} triangles, ` +
    `${(totalBytes / 1024 / 1024).toFixed(2)} MiB.`,
)
