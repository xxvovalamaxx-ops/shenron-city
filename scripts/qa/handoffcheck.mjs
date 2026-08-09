/**
 * Can the player actually get into one of the city's cars — and is there
 * exactly one of it afterwards?
 *
 * 0B.6. The unit tests drive the real step function against a two-lane arena
 * with one car. This drives the real game against the real street graph with
 * roughly four hundred, because the two failures that matter only exist at
 * that scale: a lane table the handoff cannot read, and a promotion that
 * leaves the instanced copy circulating.
 *
 * The sample is chosen, not hoped for. City cars circulate, so standing at a
 * fixed spawn and waiting for one to stop is a coin flip that reports "no
 * prompt" as a pass. Instead the check reads a stationary car's own lane
 * position, teleports the player onto it, and only then asks whether the
 * prompt appeared — the lesson from placeholdercheck, where every control sat
 * at the camera and the nearest real offender was 1.1 m outside the radius.
 *
 * Before believing anything it asserts the loop actually ran: frames advanced,
 * the world is unpaused, and the pool is installed and non-empty. Two earlier
 * probes on this project reported perfect readings from a hidden browser pane
 * where requestAnimationFrame never fires, and from the title screen where
 * every system is correctly frozen.
 *
 * Usage:
 *   node scripts/qa/handoffcheck.mjs [--server URL]
 */
/* global window, requestAnimationFrame, KeyboardEvent */
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
  out: join(REPO_ROOT, 'evidence', 'opus', 'performance', 'handoffcheck.json'),
}
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
        if (window.__cityWorld?.ready && window.__vehicleSim && window.__hud) return r(true)
        if (Date.now() - t0 > limit) return r(false)
        setTimeout(tick, 250)
      }
      tick()
    }),
  120000,
)
if (!booted) {
  console.error('handoffcheck: never became ready (need __cityWorld, __vehicleSim, __hud)')
  console.error(errors.slice(0, 5).join('\n'))
  await browser.close()
  process.exit(2)
}

await page.evaluate(() => window.__hud.getState().setScreen('playing'))
// Traffic needs time to spawn and settle into the lane graph.
await new Promise((r) => setTimeout(r, 10000))

const result = await page.evaluate(
  () =>
    new Promise((done) => {
      const sim = window.__vehicleSim
      const rt = window.__rt
      const frames = () => window.__simulation.stats().frame

      const pool = sim.cityTraffic
      const preconditions = {
        poolInstalled: !!pool,
        poolCars: pool?.cars?.length ?? 0,
        poolLanes: pool?.lanes?.length ?? 0,
        registryBefore: sim.registry.vehicles.size,
      }
      if (!pool || !pool.cars.length) {
        return done({ preconditions, aborted: 'no city traffic pool installed' })
      }

      // Pick a stationary car and stand on it. laneToWorld is not reachable
      // from here, so the placement is recomputed the same way the prompt
      // does: walk the polyline to arclength `s`, world z = -northing.
      const placeOf = (car) => {
        const lane = pool.lanes[car.lane]
        if (!lane) return null
        const s = Math.max(0, Math.min(car.s, lane.len))
        let i = 1
        while (i < lane.cum.length - 1 && lane.cum[i] < s) i++
        const t = (s - lane.cum[i - 1]) / Math.max(1e-9, lane.cum[i] - lane.cum[i - 1])
        const a = lane.pts[i - 1]
        const b = lane.pts[i]
        return { x: a[0] + (b[0] - a[0]) * t, z: -(a[1] + (b[1] - a[1]) * t) }
      }

      // Stationary first; if the whole fleet is moving, stop one so the check
      // measures the handoff rather than the traffic light phase. Recorded in
      // the report either way, so a reader knows which happened.
      let car = pool.cars.find((c) => c.alive && c.v <= 0.2 && pool.lanes[c.lane])
      let stopped = false
      if (!car) {
        car = pool.cars.find((c) => c.alive && pool.lanes[c.lane])
        if (car) {
          car.v = 0
          stopped = true
        }
      }
      if (!car) return done({ preconditions, aborted: 'no usable city car' })

      const place = placeOf(car)
      if (!place) return done({ preconditions, aborted: 'car lane has no geometry' })

      const carsBefore = pool.cars.length
      const seedOfCar = car.seed
      // Registry ids before the press, so the promoted entity can be found by
      // difference rather than by catching an event.
      //
      // The event is not observable from out here: stepVehicleSession
      // subdivides the frame into fixed substeps and stepVehicleSim clears
      // sim.events at the top of each one, so a promotion emitted in an early
      // substep is gone before any rAF callback runs. Scanning every frame
      // still missed it, and reported a promotion that had demonstrably
      // happened — registry 9 -> 10, seed gone from LION — as a failure.
      // State is what matters anyway: an id that exists now and did not
      // before is the promotion, whether or not anyone saw it announced.
      const idsBefore = new Set(sim.registry.vehicles.keys())

      // Stand on it. rt.player is what the game loop feeds into the sim.
      rt.player.pos.x = place.x
      rt.player.pos.z = place.z
      sim.player.pos.x = place.x
      sim.player.pos.z = place.z

      const f0 = frames()
      let phase = 'wait-prompt'
      let promptSeen = null
      let promotedId = null
      let waited = 0
      const observations = []

      const tick = () => {
        waited++
        if (phase === 'wait-prompt') {
          // Hold the player in place: the walk controller integrates every
          // frame and would drift off the car before the prompt is computed.
          rt.player.pos.x = place.x
          rt.player.pos.z = place.z
          sim.player.pos.x = place.x
          sim.player.pos.z = place.z
          if (sim.prompt?.trafficCar) {
            promptSeen = sim.prompt.label
            phase = 'press'
          } else if (waited > 240) {
            return done({
              preconditions,
              framesAdvanced: frames() - f0,
              paused: rt.paused,
              stoppedACar: stopped,
              carsBefore,
              promptSeen: null,
              aborted: 'no city-car prompt appeared while standing on one',
              promptForRegistryCar: sim.prompt ? sim.prompt.label : null,
              playerPos: { x: rt.player.pos.x, z: rt.player.pos.z },
              carPos: place,
            })
          }
        } else if (phase === 'press') {
          // A real KeyE event, not a poke at rt.keys.
          //
          // GameLoop does `Object.assign(rt.keys, keys.current)` every frame,
          // copying *from* the input hook's ref *into* rt.keys — so writing
          // rt.keys.interact is overwritten before anything reads it. The
          // first version of this check did exactly that and reported a
          // prompt with no promotion, which reads as a broken feature rather
          // than a broken probe. Dispatching the event drives the same path a
          // player does, which is the only path worth testing.
          window.dispatchEvent(
            new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }),
          )
          phase = 'release'
        } else if (phase === 'release') {
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', bubbles: true }))
          phase = 'settle'
        } else if (phase === 'settle') {
          if (waited > 400) {
            const stillInTraffic = pool.cars.filter((c) => c.seed === seedOfCar && c.alive).length
            const added = [...sim.registry.vehicles.keys()].filter((id) => !idsBefore.has(id))
            promotedId = added.length === 1 ? added[0] : null
            observations.push(`registry gained ${added.length} id(s): ${added.join(', ')}`)
            const inRegistry = promotedId !== null && sim.registry.vehicles.has(promotedId)
            return done({
              preconditions,
              framesAdvanced: frames() - f0,
              paused: rt.paused,
              stoppedACar: stopped,
              promptSeen,
              promotedId,
              carsBefore,
              carsAfter: pool.cars.length,
              registryAfter: sim.registry.vehicles.size,
              stillInTraffic,
              inRegistry,
              observations,
              playerVehicleId: sim.registry.playerVehicleId,
            })
          }
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }),
)

const p = result.preconditions ?? {}
const checks = {
  poolInstalled: !!p.poolInstalled,
  poolHasCars: (p.poolCars ?? 0) > 0,
  poolHasLanes: (p.poolLanes ?? 0) > 0,
  loopRan: (result.framesAdvanced ?? 0) > 0,
  notPaused: result.paused === false,
  promptOffered: !!result.promptSeen,
  promoted: result.promotedId !== null && result.promotedId !== undefined,
  arrivedInTheRegistry: result.inRegistry === true,
  // The whole reason the module exists: one representation, not two.
  //
  // Asserted on the car's seed, not on the length of the traffic array. LION
  // spawns and reaps continuously — measured 399 -> 408 across one four-second
  // run — so `carsAfter === carsBefore - 1` is a statement about the spawner's
  // mood, not about the handoff. The lengths are still reported, as context.
  noDuplicate: result.stillInTraffic === 0,
  // The end state a player would recognise: they are in the car.
  playerIsDriving:
    result.promotedId !== null && result.playerVehicleId === result.promotedId,
  noConsoleErrors: errors.length === 0,
}
const pass = Object.values(checks).every(Boolean)

const report = {
  generatedBy: 'scripts/qa/handoffcheck.mjs',
  ...result,
  checks,
  consoleErrors: errors.slice(0, 5),
  pass,
}

mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

console.log(
  `handoffcheck: pool ${p.poolCars} car(s) on ${p.poolLanes} lane(s), ` +
    `${result.framesAdvanced ?? 0} sim frames`,
)
if (result.aborted) console.error(`  ABORTED: ${result.aborted}`)
console.log(`  prompt:   ${result.promptSeen ?? '(none)'}`)
console.log(
  `  traffic:  ${result.carsBefore} -> ${result.carsAfter}   ` +
    `registry: ${p.registryBefore} -> ${result.registryAfter}`,
)
console.log(
  `  promoted id ${result.promotedId}, still in traffic: ${result.stillInTraffic}, ` +
    `in registry: ${result.inRegistry}`,
)
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) console.error(`  FAIL ${name}`)
}
console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${args.out}`)

await page.close()
await browser.close()
process.exit(pass ? 0 : 1)
