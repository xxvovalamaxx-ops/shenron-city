import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RECEIPT = path.join(
  ROOT,
  'SourceAssets',
  'Models',
  'Environment',
  'polyhaven-meadow-receipt.json',
)
const PREVIEW = path.join(ROOT, 'docs', 'Assets', 'Previews', 'aaa-meadow-blender.png')
const EXPECTED_IDS = [
  'forest_ground_04',
  'brown_mud_leaves_01',
  'grass_bermuda_01',
  'grass_medium_01',
  'grass_medium_02',
  'fern_02',
  'nettle_plant',
  'weed_plant_02',
  'moss_01',
  'dry_branches_medium_01',
  'rock_moss_set_01',
  'pine_sapling_small',
  'pine_sapling_medium',
  'pine_tree_01',
  'autumn_field_puresky',
]

function fail(message) {
  throw new Error(`Environment authoring verification failed: ${message}`)
}

const receipt = JSON.parse(await readFile(RECEIPT, 'utf8'))
if (receipt.schemaVersion !== 2) fail('unsupported receipt schema')
if (receipt.source !== 'Poly Haven public API') fail('source is not the reviewed public API')
if (receipt.license !== 'CC0-1.0') fail('source pack is not pinned to CC0-1.0')
if (
  receipt.variants?.models?.resolution !== '1k' ||
  receipt.variants?.models?.format !== 'blend' ||
  receipt.variants?.lighting?.resolution !== '2k' ||
  receipt.variants?.lighting?.format !== 'hdr'
) {
  fail('source restore recipe has unexpected model or lighting variants')
}

const ids = receipt.assets.map((asset) => asset.id)
if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_IDS)) {
  fail(`unexpected curated asset list: ${ids.join(', ')}`)
}

const seenUrls = new Set()
for (const asset of receipt.assets) {
  if (!asset.name || !Array.isArray(asset.authors) || asset.authors.length === 0) {
    fail(`${asset.id} is missing title or author provenance`)
  }
  if (asset.page !== `https://polyhaven.com/a/${asset.id}`) {
    fail(`${asset.id} has an unexpected source page`)
  }
  const isHdri = asset.id === 'autumn_field_puresky'
  if (asset.kind !== (isHdri ? 'hdri' : 'model')) {
    fail(`${asset.id} has an unexpected asset kind`)
  }
  if (asset.variant !== (isHdri ? '2k-hdr' : '1k-blend')) {
    fail(`${asset.id} has an unexpected source variant`)
  }
  if (!Array.isArray(asset.files) || asset.files.length < (isHdri ? 1 : 2)) {
    fail(`${asset.id} has no restorable dependency set`)
  }

  for (const file of asset.files) {
    if (!file.url.startsWith('https://dl.polyhaven.org/file/')) {
      fail(`${asset.id}/${file.filename} is not an official Poly Haven download`)
    }
    if (!/^[a-f0-9]{32}$/.test(file.md5)) {
      fail(`${asset.id}/${file.filename} has an invalid MD5 pin`)
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      fail(`${asset.id}/${file.filename} has an invalid byte count`)
    }
    if (seenUrls.has(file.url)) fail(`duplicate source URL: ${file.url}`)
    seenUrls.add(file.url)
  }
}

const preview = await readFile(PREVIEW)
const previewStat = await stat(PREVIEW)
const pngSignature = '89504e470d0a1a0a'
if (preview.subarray(0, 8).toString('hex') !== pngSignature) fail('preview is not a PNG')
const width = preview.readUInt32BE(16)
const height = preview.readUInt32BE(20)
if (width !== 1280 || height !== 720) fail(`preview is ${width}x${height}, expected 1280x720`)
if (previewStat.size < 100_000) fail('preview is suspiciously small')

console.log(
  `Environment authoring verified: ${receipt.assets.length} CC0 assets, ` +
    `${seenUrls.size} pinned files, ${width}x${height} preview.`,
)
