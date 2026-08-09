import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glbBounds, glbMetrics, readGlb } from './glb-utils.mjs'

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
const productionRoot = resolve(root, 'public/assets/production')
const findings = []
const warnings = []
const totals = { bytes: 0, files: 0, materials: 0, meshes: 0, primitives: 0, triangles: 0 }
const skylineTiers = new Map()

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const forbiddenAssetName = /(?:^|[_-])(placeholder|prototype|toy|chibi|kenney)(?:[_-]|$)/i
const productionFiles = existsSync(productionRoot) ? walk(productionRoot) : []
for (const path of productionFiles.filter((candidate) => candidate.endsWith('.glb'))) {
  const { file, document } = readGlb(path)
  const metrics = glbMetrics(document)
  const rel = relative(root, path).replaceAll('\\', '/')
  const skylineMatch = rel.match(/distant-skyline-lod([0-2])\.glb$/)
  totals.bytes += file.length
  totals.files += 1
  totals.materials += metrics.materials
  totals.meshes += metrics.meshes
  totals.primitives += metrics.primitives
  totals.triangles += metrics.triangles

  if (metrics.primitives === 0) findings.push(`${rel}: no render primitives`)
  if (metrics.missingMaterials > 0) {
    findings.push(`${rel}: ${metrics.missingMaterials} primitives have no material`)
  }
  if (metrics.missingAssetIds.length > 0) {
    findings.push(`${rel}: ${metrics.missingAssetIds.length} mesh nodes lack stable asset_id`)
  }
  for (const name of [
    ...(document.nodes ?? []).map((node) => node.name ?? ''),
    ...(document.meshes ?? []).map((mesh) => mesh.name ?? ''),
    ...(document.materials ?? []).map((material) => material.name ?? ''),
  ]) {
    if (forbiddenAssetName.test(name)) findings.push(`${rel}: forbidden placeholder name ${name}`)
  }
  for (const image of document.images ?? []) {
    if (image.uri && !image.uri.startsWith('data:')) {
      findings.push(`${rel}: external image dependency ${image.uri}`)
    }
  }
  if (skylineMatch) {
    skylineTiers.set(Number(skylineMatch[1]), {
      bounds: glbBounds(document),
      metrics,
      rel,
    })
  }
  if (!(document.extensionsUsed ?? []).includes('MSFT_lod') && !skylineMatch) {
    warnings.push(`${rel}: no embedded MSFT_lod hierarchy; runtime distance tiers must be verified`)
  }
}

// The Manhattan build streams per-tile city chunks instead of the retired
// hand-authored production set, so the three-tier skyline contract no longer
// applies. The base island is expected to exist and carry geometry.
const baseGlb = resolve(root, 'public/models/manhattan/manhattan_base.glb')
if (!existsSync(baseGlb)) {
  findings.push('manhattan_base.glb: missing island base')
}

// These are the render-path components for the complete route. Primitives in
// collision.ts and trigger/debug modules are deliberately outside this list.
//
// Scope, stated plainly: this greps JSX tags in a hand-written file list. That
// catches `<boxGeometry/>` written declaratively in one of six files and
// nothing else — in particular it does not see `new THREE.BoxGeometry(...)`,
// which is how VehicleRig builds every car and rig-resources builds every
// pedestrian. It reported clean the whole time the hero route carried 101 raw
// primitives. scripts/qa/placeholdercheck.mjs is the check that actually
// answers that question, by walking the loaded scene graph at runtime and
// classifying geometry.type. This one is kept because it is free and runs in
// CI without a GPU, but it is a lint, not the gate.
const activeRenderFiles = [
  'src/world/ManhattanCity.tsx',
  'src/character/RealisticPlayer.tsx',
  'src/ui/DevSpawns.tsx',
  'src/world/NightEnvironment.tsx',
  'src/world/AtmosphericDust.tsx',
]
const primitiveTag = /<(?:box|sphere|capsule|cylinder|cone|plane)Geometry\b/
for (const rel of activeRenderFiles) {
  // A listed file that no longer exists is a finding, not a crash and not a
  // silent skip. The list is a claim about what the render path is; when it
  // goes stale the audit stops auditing what it says it audits. SkyRig.tsx sat
  // here after 0C deleted it, and the whole script died on ENOENT — which took
  // `npm run check` down with it, after the useful output.
  const abs = resolve(root, rel)
  if (!existsSync(abs)) {
    findings.push(`${rel}: listed as an active render file but does not exist`)
    continue
  }
  const text = readFileSync(abs, 'utf8')
  if (primitiveTag.test(text)) findings.push(`${rel}: visible raw primitive geometry remains`)
}

const manifest = JSON.parse(readFileSync(resolve(root, 'docs/Assets/ASSET_MANIFEST.json'), 'utf8'))
const manifested = new Set((manifest.assets ?? []).map((asset) => asset.runtimePath))
for (const path of productionFiles) {
  const rel = relative(root, path).replaceAll('\\', '/')
  if (!manifested.has(rel)) findings.push(`${rel}: no production manifest entry`)
}

for (const warning of warnings) console.warn(`Scene audit warning: ${warning}`)
if (findings.length > 0) {
  for (const finding of findings) console.error(`Scene audit violation: ${finding}`)
  process.exit(1)
}

// Say what was examined, not just that nothing was wrong.
//
// This printed `passed: {"bytes":0,"files":0,...}` for every run on this
// branch, because public/assets/production does not exist — the hand-authored
// production set was retired in favour of streamed city tiles. So the GLB half
// of this audit, and the manifest cross-check that iterates the same list,
// examined nothing and said "passed". A zeros blob at the end of a green line
// reads like a successful audit; it is an audit with no subject.
//
// Nothing is failed for that here: the retirement was deliberate and the
// streamed tiles are gated by verify:assets and verify-runtime-urls instead.
// But a gate that cannot fail must not be able to look like one that passed.
const glbAudited = totals.files > 0
console.log(
  glbAudited
    ? `Production scene audit passed: ${JSON.stringify(totals)}`
    : `Production scene audit: NO production GLBs examined — ${relative(root, productionRoot).replaceAll('\\', '/')} ` +
        'does not exist (hand-authored production set retired; the city streams tiles instead). ' +
        `Source-level checks ran over ${activeRenderFiles.length} render file(s).`,
)
if (!glbAudited) {
  console.log(
    '  Streamed runtime assets are covered by npm run verify:assets; visible placeholder\n' +
      '  geometry is covered by scripts/qa/placeholdercheck.mjs, which walks the live scene.',
  )
}
