import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readGlb } from './glb-utils.mjs'

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const manifestPath = resolve(root, 'docs/Assets/ASSET_MANIFEST.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const findings = []
const ids = new Set()
const runtimePaths = new Set()

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

for (const asset of manifest.assets ?? []) {
  if (!asset.id || ids.has(asset.id)) findings.push(`duplicate or missing id: ${asset.id}`)
  ids.add(asset.id)
  if (!asset.runtimePath || runtimePaths.has(asset.runtimePath)) {
    findings.push(`duplicate or missing runtimePath: ${asset.runtimePath}`)
  }
  runtimePaths.add(asset.runtimePath)
  const runtimePath = resolve(root, asset.runtimePath)
  if (!existsSync(runtimePath)) findings.push(`${asset.id}: runtime file missing`)
  if (asset.runtimeSha256 && existsSync(runtimePath) && sha256(runtimePath) !== asset.runtimeSha256) {
    findings.push(`${asset.id}: runtime SHA-256 does not match manifest`)
  }
  if (Boolean(asset.sourcePath) !== Boolean(asset.sourceSha256)) {
    findings.push(`${asset.id}: sourcePath and sourceSha256 must be declared together`)
  } else if (asset.sourcePath) {
    const sourcePath = resolve(root, asset.sourcePath)
    if (!existsSync(sourcePath)) findings.push(`${asset.id}: pinned source file missing`)
    else if (sha256(sourcePath) !== asset.sourceSha256) {
      findings.push(`${asset.id}: source SHA-256 does not match manifest`)
    }
  }
  for (const field of ['source', 'creator', 'license', 'redistribution']) {
    if (!asset[field]) findings.push(`${asset.id}: missing ${field}`)
  }
  if (asset.license === 'UNKNOWN' || asset.redistribution === 'unknown') {
    findings.push(`${asset.id}: unverified rights`)
  }
  if (asset.embeddedProvenance && existsSync(runtimePath)) {
    try {
      const embedded = readGlb(runtimePath).document.asset?.extras ?? {}
      for (const [field, expected] of Object.entries(asset.embeddedProvenance)) {
        if (embedded[field] !== expected) {
          findings.push(`${asset.id}: embedded provenance ${field} does not match manifest`)
        }
      }
    } catch (error) {
      findings.push(`${asset.id}: cannot verify embedded provenance (${error.message})`)
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Manifest violation: ${finding}`)
  process.exit(1)
}
console.log(`Production manifest verified: ${ids.size} licensed runtime assets.`)
