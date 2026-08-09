/**
 * Does the game allocate GPU resources it never gives back?
 *
 * Stage 0D asked for "leak and repeated-entry tests". VehicleRig was audited by
 * reading it, which found three real defects and would have found none in a
 * file nobody thought to open. This asks the renderer instead.
 *
 * `WebGLRenderer.info.memory` counts live geometries and textures — it goes up
 * on creation and down on dispose, which is precisely the question. In steady
 * state, with the camera still and streaming settled, those counts should be
 * flat. A monotonic climb is a leak; a sawtooth is churn.
 *
 * Chosen over patching THREE's constructors because that does not work: ES
 * module namespace objects are frozen, so an earlier attempt to count
 * `new BoxGeometry` from the page silently counted nothing and reported a
 * confident zero. `info.memory` is maintained by the renderer itself and
 * cannot be bypassed by how a resource was constructed.
 *
 * Usage:
 *   node scripts/qa/leakcheck.mjs [--server URL] [--seconds 20] [--budget 8]
 *
 * Exit code 1 if live geometries or textures grew by more than the budget
 * across the sample window.
 */
/* global window, requestAnimationFrame */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
function resolveExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  if (fromEnv) return fromEnv
  for (const c of CANDIDATES) if (existsSync(c)) return c
  throw new Error('No Chromium-family browser found. Set PUPPETEER_EXECUTABLE_PATH.')
}

function parseArgs(argv) {
  const args = {
    server: 'http://127.0.0.1:5173',
    seconds: 20,
    /** Live-count growth tolerated across the window. */
    budget: 8,
    settleMs: 9000,
    out: join(REPO_ROOT, 'evidence', 'opus', 'performance', 'leakcheck.json'),
  }
  for (let i = 0; i < argv.length; i++) {
    const value = () => argv[++i]
    if (argv[i] === '--server') args.server = value()
    else if (argv[i] === '--seconds') args.seconds = Number(value())
    else if (argv[i] === '--budget') args.budget = Number(value())
    else if (argv[i] === '--settle-ms') args.settleMs = Number(value())
    else if (argv[i] === '--out') args.out = value()
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const browser = await puppeteer.launch({
  executablePath: resolveExecutablePath(),
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1280, height: 720 },
})
const page = await browser.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

// Static camera at the spawn: the question is what a *stationary* frame
// allocates. A moving camera streams tiles in and out, which legitimately
// changes the counts and would drown the signal.
await page.goto(
  `${args.server}/?visionCapture=1&visionX=1000&visionY=13.7&visionZ=-3000` +
    '&visionTX=1080&visionTY=12&visionTZ=-2940&visionFov=60' +
    '&visionTime=12&visionRain=0&visionSeed=leakcheck',
  { waitUntil: 'domcontentloaded', timeout: 60000 },
)

const booted = await page.evaluate(
  (limit) =>
    new Promise((r) => {
      const t0 = Date.now()
      const tick = () => {
        if (window.__cityWorld?.ready && window.__gameRenderer) return r(true)
        if (Date.now() - t0 > limit) return r(false)
        setTimeout(tick, 250)
      }
      tick()
    }),
  120000,
)
if (!booted) {
  console.error('leakcheck: the city never reported ready')
  console.error(errors.slice(0, 5).join('\n'))
  await browser.close()
  process.exit(2)
}

await new Promise((r) => setTimeout(r, args.settleMs))

const result = await page.evaluate(
  (seconds) =>
    new Promise((resolve) => {
      const gl = window.__gameRenderer
      const samples = []
      const start = performance.now()
      const sample = () => ({
        t: +((performance.now() - start) / 1000).toFixed(2),
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      })
      let frames = 0
      const tick = () => {
        frames++
        if (frames % 10 === 0) samples.push(sample())
        if (performance.now() - start >= seconds * 1000) {
          samples.push(sample())
          return resolve({ frames, samples })
        }
        requestAnimationFrame(tick)
      }
      samples.push(sample())
      requestAnimationFrame(tick)
    }),
  args.seconds,
)

const first = result.samples[0]
const last = result.samples[result.samples.length - 1]
const peakGeo = Math.max(...result.samples.map((s) => s.geometries))
const peakTex = Math.max(...result.samples.map((s) => s.textures))
const growth = {
  geometries: last.geometries - first.geometries,
  textures: last.textures - first.textures,
  programs: last.programs - first.programs,
}
// A steady climb is a leak; a spike that comes back down is churn, which the
// peak reveals and the endpoints hide.
const churn = {
  geometries: peakGeo - Math.min(first.geometries, last.geometries),
  textures: peakTex - Math.min(first.textures, last.textures),
}

const failed =
  Math.abs(growth.geometries) > args.budget || Math.abs(growth.textures) > args.budget

const report = {
  generatedBy: 'scripts/qa/leakcheck.mjs',
  seconds: args.seconds,
  frames: result.frames,
  budget: args.budget,
  first: { geometries: first.geometries, textures: first.textures, programs: first.programs },
  last: { geometries: last.geometries, textures: last.textures, programs: last.programs },
  growth,
  peak: { geometries: peakGeo, textures: peakTex },
  churn,
  consoleErrors: errors.length,
  errorSample: errors.slice(0, 3),
  pass: !failed,
}

mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

console.log(
  `leakcheck: ${result.frames} frames over ${args.seconds}s\n` +
    `  geometries ${first.geometries} -> ${last.geometries} (peak ${peakGeo}, growth ${growth.geometries})\n` +
    `  textures   ${first.textures} -> ${last.textures} (peak ${peakTex}, growth ${growth.textures})\n` +
    `  programs   ${first.programs} -> ${last.programs}\n` +
    `  console errors: ${errors.length}\n` +
    `  ${failed ? 'FAIL' : 'PASS'} (budget ${args.budget}) — ${args.out}`,
)

await page.close()
await browser.close()
process.exit(failed ? 1 : 0)
