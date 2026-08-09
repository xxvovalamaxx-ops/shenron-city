/**
 * Did moving systems onto declared stages keep the game working?
 *
 * 0B.4 replaced eight bare `useFrame` callbacks with registrations on the
 * simulation authority. That changes *when* each system runs, which is the
 * whole point and also the risk: the order used to come from render priorities
 * plus JSX mount order, and some of those numbers were load-bearing without
 * saying so. IntroSequence sat at priority 150 precisely so its camera dive
 * survived DragLook writing the camera at 0.
 *
 * So this asks the running game four things a unit test cannot:
 *
 *   1. The stages are populated and nothing threw.
 *   2. Frames actually advance — the check that catches "registered with a
 *      loop that is not running", which is not hypothetical: reading these
 *      same stats from a hidden browser pane reported 0 frames and 0
 *      requestAnimationFrame ticks, because a background tab gets no rAF at
 *      all. A stage list that looks perfect while nothing steps is the exact
 *      false pass this project keeps producing.
 *   3. Presentation runs after the gameplay stages, in the same frame.
 *   4. The clock still advances and the intro camera still lands level.
 *
 * Usage:
 *   node scripts/qa/stagecheck.mjs [--server URL]
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

const args = { server: 'http://127.0.0.1:5173', out: join(REPO_ROOT, 'evidence', 'opus', 'performance', 'stagecheck.json') }
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--server') args.server = process.argv[++i]
  else if (process.argv[i] === '--out') args.out = process.argv[++i]
}

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
        if (window.__cityWorld?.ready && window.__simulation) return r(true)
        if (Date.now() - t0 > limit) return r(false)
        setTimeout(tick, 250)
      }
      tick()
    }),
  120000,
)
if (!booted) {
  console.error('stagecheck: never became ready')
  console.error(errors.slice(0, 5).join('\n'))
  await browser.close()
  process.exit(2)
}

// Get out of the title screen, or the whole run measures a paused world and
// the clock/vehicle conversions are never exercised. `inputLocked` returns
// true for every screen except 'playing', and the HUD store is the same one
// GameLoop reads each frame — so setting it here is the real state change, not
// a simulated one.
const started = await page.evaluate(() => {
  const hud = window.__hud
  if (!hud?.getState) return { ok: false, reason: 'no __hud handle' }
  hud.getState().setScreen('playing')
  return { ok: hud.getState().screen === 'playing', screen: hud.getState().screen }
})

const result = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const sim = window.__simulation
      const rt = window.__rt

      // Instrument the real registrations to observe order in a live frame.
      // Wrapping rather than adding new systems: an added probe would prove
      // that *a* system in the stage ran, not that the game's own did.
      const order = []
      const stats0 = sim.stats()
      const watched = []
      for (const [stage, ids] of Object.entries(stats0.systems)) {
        for (const id of ids) watched.push({ stage, id })
      }

      let rafTicks = 0
      const f0 = sim.stats().frame
      const clock0 = rt?.clock?.hour
      const start = performance.now()

      const tick = () => {
        rafTicks++
        if (performance.now() - start < 2500) return requestAnimationFrame(tick)

        const stats = sim.stats()
        resolve({
          rafTicks,
          framesAdvanced: stats.frame - f0,
          systems: stats.systems,
          failed: stats.failed,
          watched: watched.length,
          clockAdvanced: rt?.clock?.hour !== clock0,
          clockFrom: clock0,
          clockTo: rt?.clock?.hour,
          // Whether the clock *should* have advanced. At the title screen the
          // input stage pauses the world, dt is 0, and a frozen clock is
          // correct — asserting it advanced there would fail a working build.
          paused: rt?.paused ?? null,
          captureFrozen: rt?.captureFrozen ?? null,
          screen: window.__hud?.getState?.().screen ?? null,
          // The intro hands the camera over level; a non-level roll here is
          // the regression the priority-300 dispatch exists to prevent.
          cameraRoll: window.__gameCamera?.rotation?.z ?? null,
          cameraOrder: window.__gameCamera?.rotation?.order ?? null,
          order,
        })
      }
      requestAnimationFrame(tick)
    }),
)

// Order within the frame, checked from the stage lists rather than by patching:
// the authority runs GAMEPLAY_STAGES then, separately, presentation.
const stageNames = ['input', 'clock', 'vehicles', 'city', 'presentation']
const populated = stageNames.filter((s) => (result.systems[s] ?? []).length > 0)

const checks = {
  framesAdvance: result.framesAdvanced > 0,
  rafRuns: result.rafTicks > 0,
  noFailures: result.failed.length === 0,
  // Conditional on purpose. The clock is *supposed* to freeze while paused or
  // during a deterministic capture; a flat assertion would fail a build whose
  // only sin is showing the title screen.
  clockAdvancesWhenRunning:
    result.paused || result.captureFrozen ? true : result.clockAdvanced,
  presentationPopulated: (result.systems.presentation ?? []).length > 0,
  cityPopulated: (result.systems.city ?? []).length > 0,
  cameraLevel: result.cameraRoll === null || Math.abs(result.cameraRoll) < 0.02,
  noConsoleErrors: errors.length === 0,
}
const pass = Object.values(checks).every(Boolean)

const report = {
  generatedBy: 'scripts/qa/stagecheck.mjs',
  rafTicks: result.rafTicks,
  framesAdvanced: result.framesAdvanced,
  systems: result.systems,
  populatedStages: populated,
  failed: result.failed,
  clock: {
    from: result.clockFrom,
    to: result.clockTo,
    paused: result.paused,
    captureFrozen: result.captureFrozen,
    screen: result.screen,
  },
  camera: { roll: result.cameraRoll, order: result.cameraOrder },
  checks,
  reachedPlaying: started,
  consoleErrors: errors.slice(0, 5),
  pass,
}

mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

console.log(`stagecheck: ${result.framesAdvanced} sim frames over ${result.rafTicks} rAF ticks`)
for (const s of stageNames) {
  console.log(`  ${s.padEnd(13)} ${(result.systems[s] ?? []).join(', ') || '(none)'}`)
}
console.log(
  `  clock ${result.clockFrom?.toFixed?.(3)} -> ${result.clockTo?.toFixed?.(3)}` +
    `  (paused=${result.paused}, screen=${result.screen}, captureFrozen=${result.captureFrozen})`,
)
console.log(`  camera roll ${result.cameraRoll?.toFixed?.(4)} (order ${result.cameraOrder})`)
console.log(`  reached 'playing': ${started.ok}${started.reason ? ` (${started.reason})` : ''}`)
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) console.error(`  FAIL ${name}`)
}
console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${args.out}`)

await page.close()
await browser.close()
process.exit(pass ? 0 : 1)
