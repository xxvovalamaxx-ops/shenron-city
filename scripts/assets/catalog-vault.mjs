#!/usr/bin/env node
/**
 * ASSET VAULT CATALOGER (non-destructive)
 *
 * Walks the asset vault read-only, computes SHA-256 hashes, detects duplicate
 * content by hash, collects license-file evidence, and parses the download
 * receipts for provenance. Emits one JSONL record per file plus a summary.
 *
 * Usage: node scripts/assets/catalog-vault.mjs <vault-root> <out-jsonl> <out-summary>
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname, dirname, basename } from 'node:path'

const VAULT = process.argv[2]
const OUT_JSONL = process.argv[3]
const OUT_SUMMARY = process.argv[4]
if (!VAULT || !OUT_JSONL || !OUT_SUMMARY) {
  console.error('usage: catalog-vault.mjs <vault-root> <out-jsonl> <out-summary>')
  process.exit(1)
}

const LICENSE_HINTS = /license|licence|copying|readme|terms|eula|attribution|credits|source/i

function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (d) => hash.update(d))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (st.isFile()) out.push(full)
  }
}

const ARCHIVE_EXT = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz', '.bz2', '.xz'])
const PRIMARY_EXT = new Set([
  '.glb', '.gltf', '.fbx', '.obj', '.blend', '.stl', '.dae', '.uasset', '.usdc',
  '.hdr', '.exr', '.ogg', '.wav', '.mp3', '.ttf', '.otf', '.svg',
])

const files = []
walk(VAULT, files)

const started = Date.now()
const out = createWriteStream(OUT_JSONL, { flags: 'w' })
let byHash = new Map()
let licenseFiles = 0
let archives = 0
let primaries = 0
let totalBytes = 0
let processed = 0

console.log(`scanning ${files.length} files in ${VAULT}`)
for (const file of files) {
  const ext = extname(file).toLowerCase()
  const size = statSync(file).size
  totalBytes += size
  const isLicense = LICENSE_HINTS.test(basename(file)) && ext === '.txt' || LICENSE_HINTS.test(basename(file)) && ext === '.md'
  const needHash = isLicense || ARCHIVE_EXT.has(ext) || PRIMARY_EXT.has(ext) || size < 2 * 1024 * 1024
  let sha = null
  if (needHash) {
    try {
      sha = await hashFile(file)
    } catch {
      sha = null
    }
    if (sha) {
      if (!byHash.has(sha)) byHash.set(sha, [])
      byHash.get(sha).push(file)
    }
    if (isLicense) licenseFiles += 1
    if (ARCHIVE_EXT.has(ext)) archives += 1
    if (PRIMARY_EXT.has(ext)) primaries += 1
  }
  out.write(
    JSON.stringify({
      path: relative(VAULT, file).replaceAll('\\', '/'),
      abs: file,
      size,
      ext,
      sha256: sha,
      kind: isLicense ? 'license' : ARCHIVE_EXT.has(ext) ? 'archive' : PRIMARY_EXT.has(ext) ? 'primary' : 'support',
    }) + '\n',
  )
  processed += 1
  if (processed % 20000 === 0) {
    console.log(`  ${processed}/${files.length} (${((Date.now() - started) / 1000).toFixed(0)}s)`)
  }
}

out.end()
await new Promise((res) => out.on('finish', res))

// Duplicate groups (content-level, >1 path per hash).
const dupGroups = [...byHash.entries()]
  .filter(([, paths]) => paths.length > 1)
  .map(([hash, paths]) => ({ hash, size: statSync(paths[0]).size, paths: paths.slice().sort() }))
  .sort((a, b) => b.size - a.size)

const summary = {
  vault: VAULT,
  snapshotUtc: new Date().toISOString(),
  durationSeconds: Math.round((Date.now() - started) / 1000),
  files,
  totalBytes,
  archives,
  primaryModels: primaries,
  licenseFiles,
  uniqueHashes: byHash.size,
  duplicateGroups: dupGroups.length,
  duplicateBytesWasted: dupGroups.reduce((a, g) => a + g.size * (g.paths.length - 1), 0),
  duplicates: dupGroups,
}
const out2 = createWriteStream(OUT_SUMMARY, { flags: 'w' })
out2.write(JSON.stringify(summary, null, 2))
out2.end()
console.log(`done: ${processed} files, ${dupGroups.length} duplicate groups, ${((totalBytes / 1e9).toFixed(2))} GB`)
