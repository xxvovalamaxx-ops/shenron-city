import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
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

/**
 * I/O is allowed, but only here.
 *
 * The game talks to Mission Control now, so a blanket ban on fetch would be a
 * lie. The invariant that actually matters is that network access stays in one
 * reviewable file: no component, no world geometry, and above all no NPC
 * dialogue path can perform I/O. Widening this list is a security decision.
 */
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
// 'self', never '*' and never a host: the game may talk to its own origin,
// which the dev proxy forwards to Mission Control, and to nothing else.
if (!/connect-src 'self'/.test(html)) {
  findings.push("index.html: connect-src must be 'self'")
}
if (/connect-src[^;]*\*/.test(html)) findings.push('index.html: connect-src must not be a wildcard')

const buildFiles = filesUnder(join(root, 'dist')).filter((path) => /\.(html|js|css)$/.test(path))
/**
 * The shipped bundle must contain no upstream address and no credential. The
 * backend owns those; a URL baked in here would follow the game to whoever it
 * is shared with.
 */
const forbiddenBuildMarkers = [
  'MISSION_CONTROL_URL',
  'cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver',
  'sk-',
  'Bearer ',
  'api_key',
  '__rt',
]
for (const path of buildFiles) {
  const text = readFileSync(path, 'utf8')
  for (const marker of forbiddenBuildMarkers) {
    if (text.includes(marker)) findings.push(`${relative(root, path)}: ${marker}`)
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Standalone boundary violation: ${finding}`)
  process.exit(1)
}

console.log(
  `Standalone boundary verified across ${sourceFiles.length} source files and ${buildFiles.length} build files.`,
)
