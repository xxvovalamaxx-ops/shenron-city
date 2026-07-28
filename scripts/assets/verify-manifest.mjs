import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const manifestPath = resolve(root, 'docs/Assets/ASSET_MANIFEST.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const findings = []
const ids = new Set()
const runtimePaths = new Set()

for (const asset of manifest.assets ?? []) {
  if (!asset.id || ids.has(asset.id)) findings.push(`duplicate or missing id: ${asset.id}`)
  ids.add(asset.id)
  if (!asset.runtimePath || runtimePaths.has(asset.runtimePath)) {
    findings.push(`duplicate or missing runtimePath: ${asset.runtimePath}`)
  }
  runtimePaths.add(asset.runtimePath)
  if (!existsSync(resolve(root, asset.runtimePath))) findings.push(`${asset.id}: runtime file missing`)
  for (const field of ['source', 'creator', 'license', 'redistribution']) {
    if (!asset[field]) findings.push(`${asset.id}: missing ${field}`)
  }
  if (asset.license === 'UNKNOWN' || asset.redistribution === 'unknown') {
    findings.push(`${asset.id}: unverified rights`)
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Manifest violation: ${finding}`)
  process.exit(1)
}
console.log(`Production manifest verified: ${ids.size} licensed runtime assets.`)
