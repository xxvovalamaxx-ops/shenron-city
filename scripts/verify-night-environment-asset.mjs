import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const receipt = JSON.parse(
  await readFile(
    path.join(
      ROOT,
      'SourceAssets/Models/Environment/modern-buildings-night-receipt.json',
    ),
    'utf8',
  ),
)

function fail(message) {
  throw new Error(`Night environment verification failed: ${message}`)
}

if (
  receipt.schemaVersion !== 1 ||
  receipt.source !== 'Poly Haven public API' ||
  receipt.assetId !== 'modern_buildings_night' ||
  receipt.license !== 'CC0-1.0' ||
  receipt.variant !== '1k-hdr' ||
  receipt.page !== 'https://polyhaven.com/a/modern_buildings_night' ||
  receipt.downloadUrl !==
    'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/modern_buildings_night_1k.hdr' ||
  receipt.sourceMd5 !== '3067e8d9e8e961e6a11ff45c055a5fbd'
) {
  fail('receipt does not match the reviewed official asset')
}

const runtime = await readFile(path.join(ROOT, receipt.runtimePath))
if (runtime.length !== receipt.bytes) fail('runtime byte count changed')
const hash = createHash('sha256').update(runtime).digest('hex')
if (hash !== receipt.runtimeSha256) fail('runtime SHA-256 changed')
if (runtime.toString('ascii', 0, 10) !== '#?RADIANCE') {
  fail('runtime file has no Radiance HDR signature')
}

const [source, manifest] = await Promise.all([
  readFile(path.join(ROOT, 'src/world/NightEnvironment.tsx'), 'utf8'),
  readFile(path.join(ROOT, 'docs/Assets/ASSET_MANIFEST.csv'), 'utf8'),
])
if (!source.includes("/hdr/modern_buildings_night_1k.hdr")) {
  fail('runtime HDR is not referenced by NightEnvironment')
}
if (
  !manifest.includes('https://polyhaven.com/a/modern_buildings_night') ||
  !manifest.includes(receipt.runtimePath)
) {
  fail('runtime HDR is missing exact manifest coverage')
}

console.log(
  `Night environment verified: ${receipt.name}, ` +
    `${(runtime.length / 1024 / 1024).toFixed(2)} MiB, pinned CC0 source.`,
)
