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
const executablePatterns = [
  [/\bfetch\s*\(/, 'fetch'],
  [/\bnew\s+WebSocket\b/, 'WebSocket'],
  [/\bnew\s+EventSource\b/, 'EventSource'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bnavigator\.sendBeacon\b/, 'sendBeacon'],
  [/\bchild_process\b/, 'child_process'],
  [/@tauri-apps/, 'Tauri'],
  [/\belectron\b/, 'Electron'],
]

const findings = []
for (const path of sourceFiles) {
  const text = readFileSync(path, 'utf8')
  for (const [pattern, label] of executablePatterns) {
    if (pattern.test(text)) findings.push(`${relative(root, path)}: ${label}`)
  }
}

const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8')
if (/\bproxy\s*:/.test(viteConfig)) findings.push('vite.config.ts: proxy')
if (/MISSION_CONTROL_URL/.test(viteConfig)) findings.push('vite.config.ts: Mission Control URL')
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
if (!/connect-src 'none'/.test(html)) findings.push('index.html: connect-src must remain none')

const buildFiles = filesUnder(join(root, 'dist')).filter((path) => /\.(html|js|css)$/.test(path))
const forbiddenBuildMarkers = [
  '/api/auth/session',
  '/api/system/metrics',
  'MISSION_CONTROL_URL',
  'cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver',
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
