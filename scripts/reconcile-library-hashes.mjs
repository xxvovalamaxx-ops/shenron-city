/**
 * Reconcile the public library registry against the checked-out files.
 *
 * The Git LFS re-alignment (commit e88667850) replaced pointer files with
 * real content, which changed byte counts and SHA-256 hashes for a handful of
 * entries. This script re-hashes every registered file and updates the
 * manifest when the disk content differs, printing a summary.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(root, 'SourceAssets/PublicLibrary/ASSET_MANIFEST.json')
const raw = readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')
const manifest = JSON.parse(raw)

let updated = 0
let missing = 0
let checked = 0
for (const file of manifest.files) {
  const full = resolve(root, 'SourceAssets/PublicLibrary', file.path)
  checked += 1
  if (!existsSync(full)) {
    missing += 1
    console.log(`missing: ${file.path}`)
    continue
  }
  const bytes = readFileSync(full)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== file.sha256 || bytes.length !== file.bytes) {
    file.sha256 = sha256
    file.bytes = bytes.length
    updated += 1
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`checked ${checked} files, updated ${updated}, missing ${missing}`)
