/**
 * Is the city actually lit by an environment map at every hour?
 *
 * The defect this gates: the build shipped one HDR, a night one, and the
 * component correctly faded it to nothing across dawn so it would not light a
 * noon scene. From about 07:00 to 17:00 `scene.environmentIntensity` was zero
 * and `scene.environment` contributed nothing — glass, car paint and every
 * metal surface had only the analytic sun to reflect.
 *
 * Reading the schedule module would prove nothing: it is pure, it is unit
 * tested, and it was never the part that was wrong. What matters is whether the
 * renderer ends up with a filtered environment texture installed and a non-zero
 * intensity at each hour, which is a question about the running scene.
 *
 * The control is the same measurement at an hour where the previous
 * implementation was known to be correct — the middle of the night. If night
 * and noon both read zero the harness is broken, not the feature.
 *
 * Usage:
 *   node scripts/qa/environmentcheck.mjs [--server URL] [--shots DIR]
 *
 * Exit 2 = the instrument could not be trusted; 1 = the gate failed.
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

const args = {
  server: 'http://127.0.0.1:5173',
  out: join(REPO_ROOT, 'evidence', 'opus', 'visual', 'environmentcheck.json'),
  shots: join(REPO_ROOT, 'evidence', 'opus', 'visual', 'environment'),
}
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--server') args.server = process.argv[++i]
  else if (process.argv[i] === '--out') args.out = process.argv[++i]
  else if (process.argv[i] === '--shots') args.shots = process.argv[++i]
}

/** Hours sampled, and what each is meant to demonstrate. */
const HOURS = [
  { hour: 2, label: 'night' },
  { hour: 6.5, label: 'dawn' },
  { hour: 9, label: 'morning' },
  { hour: 12, label: 'noon' },
  { hour: 15, label: 'afternoon' },
  { hour: 18, label: 'evening' },
  { hour: 20.5, label: 'dusk' },
]

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

await page.goto(args.server, { waitUntil: 'domcontentloaded', timeout: 60000 })

const booted = await page.evaluate(
  (limit) =>
    new Promise((r) => {
      const t0 = Date.now()
      const tick = () => {
        if (window.__cityWorld?.ready && window.__rt && window.__hud) return r(true)
        if (Date.now() - t0 > limit) return r(false)
        setTimeout(tick, 250)
      }
      tick()
    }),
  120000,
)
if (!booted) {
  console.error('environmentcheck: never became ready (need __cityWorld, __rt, __hud)')
  console.error(errors.slice(0, 5).join('\n'))
  await browser.close()
  process.exit(2)
}

await page.evaluate(() => window.__hud.getState().setScreen('playing'))
await new Promise((r) => setTimeout(r, 8000))

// The component publishes a `diagnostics()` rather than the scene itself, the
// same way the audio engine does. If it is absent the component never mounted,
// which is a broken harness, not a dim city.
const canReach = await page.evaluate(() => typeof window.__cityEnvironment?.diagnostics === 'function')

mkdirSync(args.shots, { recursive: true })
const samples = []

for (const { hour, label } of HOURS) {
  const sample = await page.evaluate(
    ([h, settleMs]) =>
      new Promise((done) => {
        const rt = window.__rt
        const t0 = Date.now()
        // The clock advances on its own, so it is pinned every frame rather
        // than set once — otherwise the hour under test drifts while the
        // environment is still being filtered.
        const tick = () => {
          rt.clock.hour = h
          if (Date.now() - t0 < settleMs) {
            requestAnimationFrame(tick)
            return
          }
          const d = window.__cityEnvironment.diagnostics()
          done({
            hour: rt.clock.hour,
            hasEnvironment: d.hasEnvironment,
            environmentIsTexture: d.environmentIsTexture,
            intensity: d.intensity,
            mapsLoaded: d.mapsLoaded,
            applied: d.applied,
            backgroundUntouched: !d.backgroundIsEnvironment,
          })
        }
        requestAnimationFrame(tick)
      }),
    [hour, 2500],
  )
  const shot = join(args.shots, `${String(hour).replace('.', '-')}-${label}.png`)
  await page.screenshot({ path: shot })
  samples.push({ label, requestedHour: hour, ...sample, screenshot: shot })
  console.log(
    `  ${label.padEnd(10)} hour ${String(sample.hour).padEnd(5)} ` +
      `env ${sample.hasEnvironment ? 'yes' : 'NO '} ` +
      `intensity ${sample.intensity === null ? 'null' : sample.intensity.toFixed(3)}`,
  )
}

const day = samples.filter((s) => s.requestedHour >= 9 && s.requestedHour <= 15)
const night = samples.find((s) => s.label === 'night')

const checks = {
  sceneReachable: canReach,
  // The whole point: an environment map installed at every sampled hour.
  environmentAtEveryHour: samples.every((s) => s.hasEnvironment && s.environmentIsTexture),
  litAtEveryHour: samples.every((s) => (s.intensity ?? 0) > 0),
  // The regression this replaces, named exactly: the daytime city was unlit.
  daytimeIsLit: day.length > 0 && day.every((s) => (s.intensity ?? 0) > 0.3),
  // The control. Night was correct before and must stay correct.
  nightStillDim: !!night && (night.intensity ?? 0) > 0 && (night.intensity ?? 1) < 0.3,
  daytimeBrighterThanNight:
    day.length > 0 && !!night && Math.min(...day.map((s) => s.intensity)) > night.intensity,
  // Lighting, never a skybox — the sky owns the background.
  backgroundNotReplaced: samples.every((s) => s.backgroundUntouched !== false),
  noConsoleErrors: errors.length === 0,
}
const pass = Object.values(checks).every(Boolean)

const report = {
  generatedBy: 'scripts/qa/environmentcheck.mjs',
  samples,
  checks,
  consoleErrors: errors.slice(0, 5),
  pass,
}
mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

for (const [name, ok] of Object.entries(checks)) {
  if (!ok) console.error(`  FAIL ${name}`)
}
console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${args.out}`)
console.log(`  screenshots in ${args.shots}`)

await page.close()
await browser.close()
if (!canReach) process.exit(2)
process.exit(pass ? 0 : 1)
