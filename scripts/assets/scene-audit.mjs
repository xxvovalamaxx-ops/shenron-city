import { readFileSync, readdirSync, statSync } from 'node:fs'
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
for (const path of walk(productionRoot).filter((candidate) => candidate.endsWith('.glb'))) {
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

if (skylineTiers.size !== 3) {
  findings.push(`distant skyline: expected three runtime LOD files, found ${skylineTiers.size}`)
} else {
  let previousTriangles = Infinity
  for (const lod of [0, 1, 2]) {
    const tier = skylineTiers.get(lod)
    const dimensions = tier?.bounds?.dimensions
    if (!tier || !dimensions) {
      findings.push(`distant skyline LOD${lod}: missing baked geometry bounds`)
      continue
    }
    const [width, height, depth] = dimensions
    if (width < 140 || width > 190 || height < 100 || height > 150 || depth < 35 || depth > 80) {
      findings.push(
        `${tier.rel}: implausible skyline bounds ${dimensions.map((value) => value.toFixed(2)).join(' x ')}`,
      )
    }
    if (tier.metrics.materials > 8 || tier.metrics.primitives > 8) {
      findings.push(
        `${tier.rel}: skyline exceeds eight material/draw-call batches`,
      )
    }
    if (tier.metrics.triangles >= previousTriangles) {
      findings.push(`${tier.rel}: triangle count does not decrease with distance`)
    }
    previousTriangles = tier.metrics.triangles
  }
}

// These are the render-path components for the complete route. Primitives in
// collision.ts and trigger/debug modules are deliberately outside this list.
const activeRenderFiles = [
  'src/world/Exterior.tsx',
  'src/world/Lobby.tsx',
  'src/world/Floor45.tsx',
  'src/world/Elevator.tsx',
  'src/world/Doors.tsx',
  // Traffic's raw meshes are deliberately authored transient VFX (brake-light
  // spill and headlight cones), not vehicle body geometry.
  'src/agents/AmbientCrowd.tsx',
  'src/agents/Secretary.tsx',
  'src/agents/PlazaWarden.tsx',
  'src/agents/MarketKeeper.tsx',
  'src/agents/AgentOffice.tsx',
]
const primitiveTag = /<(?:box|sphere|capsule|cylinder|cone|plane)Geometry\b/
for (const rel of activeRenderFiles) {
  const text = readFileSync(resolve(root, rel), 'utf8')
  if (primitiveTag.test(text)) findings.push(`${rel}: visible raw primitive geometry remains`)
}

const manifest = JSON.parse(readFileSync(resolve(root, 'docs/Assets/ASSET_MANIFEST.json'), 'utf8'))
const manifested = new Set((manifest.assets ?? []).map((asset) => asset.runtimePath))
for (const path of walk(productionRoot)) {
  const rel = relative(root, path).replaceAll('\\', '/')
  if (!manifested.has(rel)) findings.push(`${rel}: no production manifest entry`)
}

for (const warning of warnings) console.warn(`Scene audit warning: ${warning}`)
if (findings.length > 0) {
  for (const finding of findings) console.error(`Scene audit violation: ${finding}`)
  process.exit(1)
}
console.log(`Production scene audit passed: ${JSON.stringify(totals)}`)
