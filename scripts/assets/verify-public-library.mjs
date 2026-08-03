import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const libraryRoot = join(root, 'SourceAssets', 'PublicLibrary')
const manifestPath = join(libraryRoot, 'ASSET_MANIFEST.json')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
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

if (!existsSync(manifestPath)) throw new Error('Public library manifest is missing')
const manifest = readJson(manifestPath)
const findings = []
const manifestFiles = new Map(manifest.files.map((file) => [file.path, file]))
const actualFiles = new Set()
const blockedExtensions = /\.(?:html|ini|unitypackage|url)$/i
const allowedLicenses = ['CC0-1.0', 'OFL-1.1', 'CC-BY-3.0']

for (const pack of manifest.packs) {
  const packRoot = join(libraryRoot, ...pack.category.split('/'), pack.id)
  if (!existsSync(packRoot)) {
    findings.push(`${pack.id}: pack directory is missing`)
    continue
  }

  const packFiles = filesUnder(packRoot)
  const licensePath = join(libraryRoot, pack.licenseFile)
  if (!pack.sourcePage || !pack.downloadUrl || !pack.archiveSha256) {
    findings.push(`${pack.id}: incomplete source provenance`)
  }
  if (!allowedLicenses.includes(pack.license)) findings.push(`${pack.id}: license is not allowlisted (${pack.license})`)
  if (!existsSync(licensePath)) findings.push(`${pack.id}: included license is missing`)
  if (pack.creditFile && !existsSync(join(libraryRoot, pack.creditFile))) {
    findings.push(`${pack.id}: included credits file is missing`)
  }

  for (const path of packFiles) {
    const relativeFile = relativePath(path)
    actualFiles.add(relativeFile)
    if (blockedExtensions.test(path)) findings.push(`${relativeFile}: disallowed source extra`)
    const entry = manifestFiles.get(relativeFile)
    if (!entry) {
      findings.push(`${relativeFile}: missing from manifest`)
      continue
    }
    if (entry.bytes !== statSync(path).size) findings.push(`${relativeFile}: byte count changed`)
    if (entry.sha256 !== sha256(path)) findings.push(`${relativeFile}: SHA-256 changed`)
  }
}

for (const path of manifestFiles.keys()) {
  if (!actualFiles.has(path)) findings.push(`${path}: manifest file is missing`)
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Public library violation: ${finding}`)
  process.exit(1)
}

console.log(`Public library verified: ${manifest.packs.length} packs and ${manifest.files.length} files.`)
