import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const libraryRoot = join(root, 'SourceAssets', 'PublicLibrary')
const receiptsPath = join(libraryRoot, 'download-receipts.json')
const manifestPath = join(libraryRoot, 'ASSET_MANIFEST.json')
const csvPath = join(libraryRoot, 'ASSET_MANIFEST.csv')
const acquisitionDate = '2026-08-03'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? filesUnder(path) : [path]
    })
}

function relativePath(path) {
  return relative(libraryRoot, path).replaceAll('\\', '/')
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

if (!existsSync(libraryRoot) || !existsSync(receiptsPath)) {
  throw new Error(`Public library or receipt file is missing: ${libraryRoot}`)
}

const receipts = readJson(receiptsPath)
const packs = []
const files = []

for (const receipt of receipts) {
  const packRoot = join(libraryRoot, ...receipt.category.split('/'), receipt.id)
  if (!existsSync(packRoot)) throw new Error(`${receipt.id}: pack directory is missing`)

  const packFiles = filesUnder(packRoot)
  const licensePath = packFiles.find((path) => path.toLowerCase().endsWith('license.txt'))
  if (!licensePath) throw new Error(`${receipt.id}: included License.txt is missing`)
  const creditPath = packFiles.find((path) => path.toLowerCase().endsWith('credits.txt'))
  const packEntries = packFiles.map((path) => ({
    pack: receipt.id,
    category: receipt.category,
    path: relativePath(path),
    bytes: statSync(path).size,
    sha256: sha256(path),
  }))

  files.push(...packEntries)
  packs.push({
    id: receipt.id,
    category: receipt.category,
    sourcePage: receipt.sourcePage,
    downloadUrl: receipt.downloadUrl,
    archiveSha256: receipt.archiveSha256,
    acquired: acquisitionDate,
    license: 'CC0-1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    creator: 'Kenney',
    licenseFile: relativePath(licensePath),
    ...(creditPath ? { creditFile: relativePath(creditPath) } : {}),
    fileCount: packEntries.length,
    extractedBytes: packEntries.reduce((sum, file) => sum + file.bytes, 0),
  })
}

files.sort((a, b) => a.path.localeCompare(b.path))
packs.sort((a, b) => a.id.localeCompare(b.id))
const packsById = new Map(packs.map((pack) => [pack.id, pack]))

const manifest = {
  schemaVersion: 1,
  generatedFor: 'Shenzhen City Public Asset Library',
  acquired: acquisitionDate,
  licensePolicy: 'Official Kenney packs with included CC0-1.0 license records',
  packs,
  files,
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const header = [
  'pack',
  'category',
  'path',
  'bytes',
  'sha256',
  'sourcePage',
  'downloadUrl',
  'archiveSha256',
  'license',
  'creator',
  'redistribution',
]
const rows = files.map((file) => {
  const pack = packsById.get(file.pack)
  return [
    file.pack,
    file.category,
    file.path,
    file.bytes,
    file.sha256,
    pack?.sourcePage ?? '',
    pack?.downloadUrl ?? '',
    pack?.archiveSha256 ?? '',
    pack?.license ?? '',
    pack?.creator ?? '',
    'Permitted by the included pack license and official source page',
  ]
    .map(csvCell)
    .join(',')
})
writeFileSync(csvPath, `${header.map(csvCell).join(',')}\n${rows.join('\n')}\n`)

console.log(`Catalogued ${packs.length} packs and ${files.length} files.`)
