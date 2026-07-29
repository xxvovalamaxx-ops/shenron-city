import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RECEIPT_PATH = path.join(
  ROOT,
  'SourceAssets',
  'Models',
  'Environment',
  'japanese-forest-shrine-receipt.json',
)

function fail(message) {
  throw new Error(`Japanese forest shrine verification failed: ${message}`)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'))
if (
  receipt.schemaVersion !== 1 ||
  receipt.assetId !== 'environment.japanese_forest_shrine.original.v1' ||
  receipt.source !== 'Original procedural Blender work' ||
  receipt.license !== 'CC0-1.0'
) {
  fail('receipt identity or license changed')
}

for (const field of [
  'externalMeshes',
  'externalTextures',
  'externalHdris',
  'linkedLibraries',
]) {
  if (receipt[field] !== 0) fail(`${field} must remain zero`)
}

const expectedCounts = {
  objects: 1063,
  materials: 21,
  collections: 8,
  meshes: 669,
  curves: 32,
}
if (JSON.stringify(receipt.counts) !== JSON.stringify(expectedCounts)) {
  fail('authored scene counts changed without review')
}

for (const file of ['blend', 'generator', 'preview']) {
  const record = receipt.files[file]
  const contents = await readFile(path.join(ROOT, record.path))
  if (record.bytes !== undefined && contents.length !== record.bytes) {
    fail(`${file} byte count changed`)
  }
  if (sha256(contents) !== record.sha256) fail(`${file} SHA-256 changed`)
}

const blend = await readFile(path.join(ROOT, receipt.files.blend.path))
if (blend.subarray(0, 7).toString('ascii') !== 'BLENDER') {
  fail('published source is not a Blender file')
}

const preview = await readFile(path.join(ROOT, receipt.files.preview.path))
if (preview.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
  fail('proof render is not a PNG')
}
const width = preview.readUInt32BE(16)
const height = preview.readUInt32BE(20)
if (
  width !== receipt.files.preview.width ||
  height !== receipt.files.preview.height
) {
  fail(`proof render is ${width}x${height}`)
}

const [generator, license] = await Promise.all([
  readFile(path.join(ROOT, receipt.files.generator.path), 'utf8'),
  readFile(path.join(ROOT, receipt.files.license.path), 'utf8'),
])
if (
  !generator.includes('No third-party mesh, texture, HDRI, or scan is used.') ||
  !generator.includes('scene["asset_license"] = "CC0-1.0"')
) {
  fail('generator provenance declarations are missing')
}
if (
  !license.includes('Creative Commons CC0 1.0 Universal') ||
  !license.includes(
    'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
  )
) {
  fail('CC0 dedication is incomplete')
}

const blendStats = await stat(path.join(ROOT, receipt.files.blend.path))
console.log(
  `Japanese forest shrine verified: ${receipt.counts.objects} tagged objects, ` +
    `${receipt.counts.materials} procedural materials, ` +
    `${(blendStats.size / 1024 / 1024).toFixed(2)} MiB CC0 source, ` +
    `${width}x${height} proof render, zero external assets.`,
)
