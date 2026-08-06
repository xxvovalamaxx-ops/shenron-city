import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function filesUnder(directory) {
  const output = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) output.push(...filesUnder(path))
    else output.push(path)
  }
  return output
}

const sourceFiles = filesUnder(join(root, 'src')).filter(
  (path) => /\.(ts|tsx)$/.test(path) && !path.endsWith('.test.ts'),
)
/**
 * Never permitted anywhere. This is the "an NPC must never get unrestricted
 * access to the machine" rule, enforced rather than documented.
 */
const bannedEverywhere = [
  [/\bchild_process\b/, 'child_process'],
  [/@tauri-apps/, 'Tauri'],
  [/\belectron\b/, 'Electron'],
  [/\bnavigator\.sendBeacon\b/, 'sendBeacon'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bnew\s+EventSource\b/, 'EventSource'],
]

/** Runtime network I/O is not part of the standalone game. */
const networkPatterns = [
  [/\bfetch\s*\(/, 'fetch'],
  [/\bnew\s+WebSocket\b/, 'WebSocket'],
]

const findings = []
for (const path of sourceFiles) {
  const text = readFileSync(path, 'utf8')
  const rel = relative(root, path).replace(/\\/g, '/')

  for (const [pattern, label] of bannedEverywhere) {
    if (pattern.test(text)) findings.push(`${rel}: ${label}`)
  }
  for (const [pattern, label] of networkPatterns) {
    if (pattern.test(text)) findings.push(`${rel}: ${label}`)
  }
}

// Every absolute URL in the source must be same-origin-relative. An external
// host in this bundle would mean game data leaving the player's machine.
for (const path of sourceFiles) {
  const text = readFileSync(path, 'utf8')
  const rel = relative(root, path).replace(/\\/g, '/')
  for (const match of text.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
    const url = match[0]
    // Comments and docs cite localhost and the repo; neither is a request.
    if (/127\.0\.0\.1|localhost|schemas?\.|w3\.org|react\.dev|rolldown\.rs/.test(url)) continue
    findings.push(`${rel}: external host ${url}`)
  }
}

const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8')
if (!/\bhmr:\s*false\b/.test(viteConfig)) findings.push('vite.config.ts: HMR must remain disabled')
if (/\bloadEnv\s*\(/.test(viteConfig)) findings.push('vite.config.ts: environment loading is not allowed')
if (/\bproxy\s*:/.test(viteConfig)) findings.push('vite.config.ts: proxy routes are not allowed')

const launcher = readFileSync(join(root, 'start.bat'), 'utf8')
const forbiddenLauncherPatterns = [
  [/\bcall\s+npm\s+install\b/i, 'unlocked npm install'],
  [/\.env(?:\.example)?/i, 'environment-file setup'],
  [/\bmode=demo\b/i, 'obsolete demo mode'],
  [/\bMission Control\b/i, 'obsolete Mission Control guidance'],
]
for (const [pattern, label] of forbiddenLauncherPatterns) {
  if (pattern.test(launcher)) findings.push(`start.bat: ${label}`)
}
if (!/if\s+not\s+exist\s+node_modules[\s\S]*\bcall\s+npm\s+ci\b/i.test(launcher)) {
  findings.push('start.bat: missing locked first-run install')
}

const html = readFileSync(join(root, 'index.html'), 'utf8')
if (!/connect-src 'self'/.test(html)) {
  findings.push("index.html: connect-src must be exactly 'self'")
}
const connectPolicy = html.match(/connect-src\s+([^;"]+)/)?.[1]?.trim()
if (connectPolicy !== "'self' blob:") {
  // `blob:` is required: GLTFLoader decodes embedded textures through blob
  // URLs even with the TextureLoader fallback registered.
  findings.push("index.html: connect-src must be exactly 'self' blob:")
}

const publicRoot = join(root, 'public')
const publicFiles = filesUnder(publicRoot)
for (const path of publicFiles.filter((candidate) => candidate.endsWith('.html'))) {
  findings.push(`${relative(root, path)}: executable public HTML is not an asset`)
}

// Vite copies public/ byte-for-byte. Every shipped binary must be referenced
// from executable source; otherwise a forgotten download silently bloats every
// build even when tree-shaking removes the code that once used it.
//
// The ported city-life engine (src/city) is plain JS on purpose, but it ships
// in the bundle and drives real asset loads, so its references count too.
// Its `fetch` data calls stay out of the network scan above (which covers the
// TS/TSX boundary); only asset-path references are read from it here.
const tsSource = sourceFiles.map((path) => readFileSync(path, 'utf8')).join('\n')
const cityDir = join(root, 'src', 'city')
const engineSource = existsSync(cityDir)
  ? filesUnder(cityDir)
      .filter((path) => path.endsWith('.js'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
  : ''
const sourceText = `${tsSource}\n${engineSource}`
const assetExtensions = /\.(?:fbx|glb|gltf|hdr|jpeg|jpg|ktx2|mp3|ogg|png|vrm|webp)$/i
const glbDependencies = new Set()
for (const path of publicFiles.filter((candidate) => candidate.endsWith('.glb'))) {
  const file = readFileSync(path)
  if (file.toString('ascii', 0, 4) !== 'glTF') continue

  let offset = 12
  let document
  while (offset < file.length) {
    const length = file.readUInt32LE(offset)
    const type = file.readUInt32LE(offset + 4)
    const chunk = file.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) {
      document = JSON.parse(chunk.toString('utf8').replace(/\0+$/, '').trimEnd())
      break
    }
    offset += 8 + length
  }
  if (!document) continue

  const dependencyUris = [
    ...(document.images ?? []).map((image) => image.uri),
    ...(document.buffers ?? []).map((buffer) => buffer.uri),
  ].filter(Boolean)
  for (const uri of dependencyUris) {
    if (/^(?:[a-z]+:)?\/\//i.test(uri) || uri.startsWith('data:')) {
      if (!uri.startsWith('data:')) {
        findings.push(`${relative(root, path)}: external GLB dependency ${uri}`)
      }
      continue
    }
    const dependencyPath = join(dirname(path), ...uri.split('/'))
    const dependencyRelative = relative(publicRoot, dependencyPath)
    if (isAbsolute(dependencyRelative) || dependencyRelative.split(/[\\/]/)[0] === '..') {
      findings.push(`${relative(root, path)}: escaping GLB dependency ${uri}`)
      continue
    }
    glbDependencies.add(`/${dependencyRelative.replace(/\\/g, '/')}`)
  }
}

// The far-tier LOD files load dynamically as `/models/manhattan/lod/<file>`
// (the ported engine resolves them through lod_manifest.json at runtime), so
// no literal path exists to scan. The manifest is the executable mapping:
// every file it lists is a live reference, and anything in the lod directory
// it does not list is a forgotten export.
const lodManifestPath = join(publicRoot, 'models', 'manhattan', 'lod', 'lod_manifest.json')
if (existsSync(lodManifestPath)) {
  const lodManifest = JSON.parse(readFileSync(lodManifestPath, 'utf8'))
  for (const tier of ['L2', 'L3', 'L4']) {
    for (const rec of Object.values(lodManifest[tier] ?? {})) {
      if (rec && typeof rec.file === 'string') {
        glbDependencies.add(`/models/manhattan/lod/${rec.file}`)
      }
    }
  }
}

for (const path of publicFiles.filter((candidate) => assetExtensions.test(candidate))) {
  const webPath = `/${relative(publicRoot, path).replace(/\\/g, '/')}`
  if (!sourceText.includes(webPath) && !glbDependencies.has(webPath)) {
    findings.push(`${relative(root, path)}: unreferenced public asset`)
  }
}

const buildFiles = filesUnder(join(root, 'dist')).filter((path) => /\.(html|js|css)$/.test(path))
/**
 * The shipped bundle must contain no upstream address and no credential. The
 * backend owns those; a URL baked in here would follow the game to whoever it
 * is shared with.
 */
const forbiddenBuildMarkers = [
  [/MISSION_CONTROL_URL/, 'MISSION_CONTROL_URL'],
  [/cdn\.jsdelivr\.net\/gh\/lojjic\/unicode-font-resolver/, 'remote font resolver'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/, 'provider API key'],
  [/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/, 'bearer credential'],
  [/\bapi_key\b/i, 'api_key'],
  [/\b__rt\b/, '__rt'],
]
for (const path of buildFiles) {
  const text = readFileSync(path, 'utf8')
  for (const [pattern, label] of forbiddenBuildMarkers) {
    if (pattern.test(text)) findings.push(`${relative(root, path)}: ${label}`)
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Standalone boundary violation: ${finding}`)
  process.exit(1)
}

console.log(
  `Standalone boundary verified across ${sourceFiles.length} source files and ${buildFiles.length} build files.`,
)
