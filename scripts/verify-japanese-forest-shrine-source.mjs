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
const GITHUB_BLOB_LIMIT = 100 * 1024 * 1024

function fail(message) {
  throw new Error(`Japanese forest shrine verification failed: ${message}`)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'))
if (
  receipt.schemaVersion !== 2 ||
  receipt.assetId !== 'environment.japanese_forest_shrine.realistic.v2' ||
  receipt.source !==
    'Original Blender work with Poly Haven CC0 nature and Zgon CC-BY-4.0 guardians' ||
  receipt.license !== 'CC0-1.0 + CC-BY-4.0'
) {
  fail('receipt identity or license changed')
}

const expectedExternalInputs = {
  externalMeshMasters: 41,
  packedImages: 72,
  externalHdris: 1,
  linkedLibraries: 0,
}
for (const [field, expected] of Object.entries(expectedExternalInputs)) {
  if (receipt[field] !== expected) {
    fail(`${field} must remain ${expected}`)
  }
}

const expectedCounts = {
  objects: 12337,
  materials: 37,
  collections: 17,
  meshes: 500,
  curves: 38,
}
if (JSON.stringify(receipt.counts) !== JSON.stringify(expectedCounts)) {
  fail('authored scene counts changed without review')
}

if (
  receipt.guardian.title !== 'Komainu Statue' ||
  receipt.guardian.creator !== 'Zgon' ||
  receipt.guardian.license !== 'CC-BY-4.0' ||
  receipt.guardian.trianglesInScene !== 100320 ||
  !receipt.guardian.source.includes('a5d4791ae95d4a9d9becedab6d2c7fc2')
) {
  fail('guardian provenance changed')
}

for (const file of [
  'blend',
  'generator',
  'preview',
  'guardianSource',
  'finalizer',
  'evidenceGenerator',
  'multilayerExr',
]) {
  const record = receipt.files[file]
  const contents = await readFile(path.join(ROOT, record.path))
  if (contents.length !== record.bytes) {
    fail(`${file} byte count changed`)
  }
  if (sha256(contents) !== record.sha256) {
    fail(`${file} SHA-256 changed`)
  }
}

const blend = await readFile(path.join(ROOT, receipt.files.blend.path))
const blendMagic = blend.subarray(0, 4).toString('hex')
if (
  blend.subarray(0, 7).toString('ascii') !== 'BLENDER' &&
  blendMagic !== '28b52ffd'
) {
  fail('published source is neither raw nor Zstandard-compressed Blender data')
}
if (blend.length >= GITHUB_BLOB_LIMIT) {
  fail('published Blender source exceeds GitHub 100 MiB blob limit')
}

const guardianSource = await readFile(
  path.join(ROOT, receipt.files.guardianSource.path),
)
if (
  guardianSource.subarray(0, 4).toString('ascii') !== 'glTF' ||
  guardianSource.readUInt32LE(4) !== 2 ||
  guardianSource.readUInt32LE(8) !== guardianSource.length
) {
  fail('guardian source is not a complete GLB 2.0 file')
}

const preview = await readFile(path.join(ROOT, receipt.files.preview.path))
if (preview.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
  fail('proof render is not a PNG')
}

const multilayerExr = await readFile(
  path.join(ROOT, receipt.files.multilayerExr.path),
)
if (multilayerExr.subarray(0, 4).toString('hex') !== '762f3101') {
  fail('multilayer pass deliverable is not an OpenEXR file')
}
const width = preview.readUInt32BE(16)
const height = preview.readUInt32BE(20)
if (
  width !== receipt.files.preview.width ||
  height !== receipt.files.preview.height
) {
  fail(`proof render is ${width}x${height}`)
}

const [generator, license, attribution] = await Promise.all([
  readFile(path.join(ROOT, receipt.files.generator.path), 'utf8'),
  readFile(path.join(ROOT, receipt.files.license.path), 'utf8'),
  readFile(path.join(ROOT, receipt.files.attribution.path), 'utf8'),
])
for (const required of [
  'environment.japanese_forest_shrine.realistic.v2',
  'CC0-1.0 + CC-BY-4.0',
  'komainu-statue-a5d4791ae95d4a9d9becedab6d2c7fc2',
  'Komaine_Moss',
]) {
  if (!generator.includes(required)) {
    fail(`generator is missing provenance token ${required}`)
  }
}
for (const required of [
  'Creative Commons CC0 1.0 Universal',
  'Creative Commons Attribution 4.0 International',
  'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
  'https://creativecommons.org/licenses/by/4.0/legalcode',
]) {
  if (!license.includes(required)) {
    fail(`license is missing ${required}`)
  }
}
for (const required of ['Komainu Statue', 'Zgon', 'CC BY 4.0']) {
  if (!attribution.includes(required)) {
    fail(`attribution is missing ${required}`)
  }
}

const blendStats = await stat(path.join(ROOT, receipt.files.blend.path))
console.log(
  `Japanese forest shrine verified: ${receipt.counts.objects} tagged objects, ` +
    `${receipt.counts.materials} materials, ` +
    `${(blendStats.size / 1024 / 1024).toFixed(2)} MiB mixed-license source, ` +
    `${width}x${height} final render, verified multilayer EXR, ` +
    `Zgon CC BY attribution pinned.`,
)
