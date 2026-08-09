/**
 * Can you actually hear the car you are driving?
 *
 * The engine bus is the first thing in the mix whose input comes from the
 * simulation rather than from a world event, and that makes it easy to get
 * wrong in a way nothing catches: `engineVoice` is pure and unit tested, so the
 * numbers can be provably correct while the sound is provably absent. The first
 * probe on this bus read a perfect pitch curve off a graph whose output gain
 * was pinned at zero.
 *
 * So this check never calls `setEngine` itself. It enters a real car by
 * dispatching a real KeyE, holds a real KeyW, and reads the bus. Everything the
 * gate asserts is a consequence of the game's own frame loop. A probe that
 * feeds the module its own inputs is testing the module against itself; worse,
 * it *races* the game — the earlier version of this file called `setEngine` from
 * `page.evaluate` and was overwritten by GameLoop's own `setEngine(null)` on the
 * very next frame, which is why it reported `on: false` while the pitch tracked
 * the model exactly.
 *
 * Three things are measured, in the order they can fail:
 *
 *   1. The instrument. Frames advance, the world is unpaused, the AudioContext
 *      is running, and the analyser reads *something* — the zone beds. Two
 *      probes on this project have reported flawless numbers from a page where
 *      requestAnimationFrame never fired.
 *
 *   2. The negative control. Standing on the target car, on foot, with no
 *      registry vehicle in earshot: the bus must be off and silent. Without
 *      this, "the engine is loud" cannot be told apart from "the mix is loud".
 *
 *   3. The reading, at the same spot moments later, from inside the car under
 *      throttle: the bus on, its level up, and the master RMS above the on-foot
 *      baseline. Same position, same beds, so the difference is the engine.
 *
 * Plus one regression control for a specific bug. `place` and `level` are
 * separate nodes in series and `level` alone cannot see a stuck `place`:
 * `setEngine` used to keep the last passed-in position forever (`if (at)`), and
 * GameLoop skipped `cityAudio.update` entirely while driving, so getting into a
 * car after walking past a parked one left the driver's own engine placed at
 * that parked car and attenuated to a twentieth of its level for the whole
 * drive. The check walks the player into earshot of a registry car first, waits
 * for `placeGain` to actually collapse — proving the control took — and then
 * requires it back at unity once driving.
 *
 * The gate was checked against the bug it was written for, rather than trusted
 * because it went green. Reintroducing the one-line `if (at)` and running it
 * again produced, from a clean run that got into a car and drove at 9 m/s:
 *
 *              level    placeGain   audible   master RMS
 *   fixed      0.1923   1.0000      0.1923    0.0268
 *   bug back   0.1863   0.0000      0.0000    0.0101   (on foot: 0.0083)
 *
 * — failing exactly `engineAudibleWhileDriving`, `ownEngineNotPlacedElsewhere`
 * and `mixLouderWhileDriving`. Note that `level` is healthy in both rows and
 * differs by 3%. Any gate reading `level` alone passes a car nobody can hear.
 *
 * Usage:
 *   node scripts/qa/enginecheck.mjs [--server URL] [--out FILE]
 *
 * Exit 2 = the instrument could not be trusted; 1 = the gate failed.
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
  out: join(REPO_ROOT, 'evidence', 'opus', 'audio', 'enginecheck.json'),
}
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--server') args.server = process.argv[++i]
  else if (process.argv[i] === '--out') args.out = process.argv[++i]
}

const browser = await puppeteer.launch({
  executablePath: resolveExecutablePath(),
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-unsafe-swiftshader',
    // Headless has no user gesture to offer, so without this the context is
    // born suspended, every RMS is 0, and the gate fails for a reason that has
    // nothing to do with the game.
    '--autoplay-policy=no-user-gesture-required',
  ],
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
        if (
          window.__cityWorld?.ready &&
          window.__vehicleSim &&
          window.__hud &&
          window.__cityAudio
        ) {
          return r(true)
        }
        if (Date.now() - t0 > limit) return r(false)
        setTimeout(tick, 250)
      }
      tick()
    }),
  120000,
)
if (!booted) {
  console.error(
    'enginecheck: never became ready (need __cityWorld, __vehicleSim, __hud, __cityAudio)',
  )
  console.error(errors.slice(0, 5).join('\n'))
  await browser.close()
  process.exit(2)
}

await page.evaluate(() => window.__hud.getState().setScreen('playing'))
await page.evaluate(() => window.__cityAudio.start())
// Traffic needs time to spawn and settle into the lane graph, and the beds need
// a moment to crossfade up from the silence they are built at.
await new Promise((r) => setTimeout(r, 10000))

const result = await page.evaluate(
  () =>
    new Promise((done) => {
      const sim = window.__vehicleSim
      const rt = window.__rt
      const audio = window.__cityAudio
      const frames = () => window.__simulation.stats().frame

      const pool = sim.cityTraffic
      const preconditions = {
        poolInstalled: !!pool,
        poolCars: pool?.cars?.length ?? 0,
        registryCars: sim.registry.vehicles.size,
        audioState: audio.diagnostics().state,
        sampleRate: audio.diagnostics().sampleRate,
      }
      if (!pool || !pool.cars.length) {
        return done({ preconditions, aborted: 'no city traffic pool installed' })
      }

      // Same reconstruction handoffcheck uses: laneToWorld is not reachable from
      // here, so walk the polyline to arclength `s`; world z = -northing.
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
      let place = placeOf(car)
      if (!place) return done({ preconditions, aborted: 'car lane has no geometry' })

      // The stale-placement control needs a registry vehicle to stand near:
      // those are the only ones GameLoop passes a position for.
      //
      // It has to be a *moving* one. GameLoop skips anything under 0.4 m/s when
      // it looks for the nearest car — a parked car has no engine note — so the
      // first pick landed on a stationary entity, nothing was in earshot, and
      // the control silently measured an engine that was correctly off.
      const MOVING = 0.6
      const movingRegistryCars = () =>
        [...sim.registry.vehicles.values()].filter(
          (e) => Math.abs(e.motion.speed) >= MOVING && e.id !== sim.registry.playerVehicleId,
        )
      const registryCar = movingRegistryCars()[0] ?? null

      // What GameLoop hands `setEngine`, measured the way `placeSource` reads
      // it: nearest by ground distance, placed by full 3D distance.
      const nearestMovingDistance = () => {
        let chosen = null
        let best = Infinity
        for (const e of movingRegistryCars()) {
          const dx = e.pose.pos.x - rt.player.pos.x
          const dz = e.pose.pos.z - rt.player.pos.z
          const d2 = dx * dx + dz * dz
          if (d2 < best) {
            best = d2
            chosen = e
          }
        }
        if (!chosen) return null
        const dx = chosen.pose.pos.x - rt.player.pos.x
        const dy = chosen.pose.pos.y - rt.player.pos.y
        const dz = chosen.pose.pos.z - rt.player.pos.z
        return Math.sqrt(dx * dx + dy * dy + dz * dz)
      }

      // mix.ts's inverse-distance law, restated here so the control checks the
      // placement against the model rather than against a number I picked.
      const expectedPlaceGain = (d) => {
        if (d >= 90) return 0
        const inverse = 3 / (3 + Math.max(0, d - 3))
        const taper = Math.max(0, Math.min(1, (90 - d) / (90 * 0.25)))
        return inverse * taper
      }

      const teleport = (x, z) => {
        rt.player.pos.x = x
        rt.player.pos.z = z
        sim.player.pos.x = x
        sim.player.pos.z = z
      }

      const sample = () => {
        const d = audio.diagnostics()
        return {
          rms: (d.leftRms + d.rightRms) / 2,
          level: d.engine.level,
          placeGain: d.engine.placeGain,
          pan: d.engine.pan,
          hz: d.engine.hz,
          cutoffHz: d.engine.cutoffHz,
          on: d.engine.on,
          sourceDistance: nearestMovingDistance(),
        }
      }
      const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
      const summarise = (rows) => {
        const distances = rows.map((r) => r.sourceDistance).filter((d) => d !== null)
        const distance = distances.length === rows.length ? mean(distances) : null
        return {
          n: rows.length,
          rms: +mean(rows.map((r) => r.rms)).toFixed(5),
          level: +mean(rows.map((r) => r.level)).toFixed(4),
          placeGain: +mean(rows.map((r) => r.placeGain)).toFixed(4),
          pan: +mean(rows.map((r) => r.pan)).toFixed(3),
          hz: +mean(rows.map((r) => r.hz)).toFixed(1),
          cutoffHz: Math.round(mean(rows.map((r) => r.cutoffHz))),
          onAlways: rows.every((r) => r.on),
          onNever: rows.every((r) => !r.on),
          sourceDistance: distance === null ? null : +distance.toFixed(1),
          expectedPlaceGain: distance === null ? null : +expectedPlaceGain(distance).toFixed(4),
        }
      }

      const f0 = frames()
      const out = { preconditions, stoppedACar: stopped, carPos: place }
      const rows = []
      let phase = registryCar ? 'near-registry' : 'on-foot'
      let waited = 0
      let idleFrames = 0
      out.hadRegistryCarToWalkPast = !!registryCar

      // 50 m from a registry car: inside GameLoop's 60 m earshot, far enough
      // that `placeGain` lands near 3/(3+47) — unmistakably not unity.
      const NEAR_DISTANCE = 50

      const tick = () => {
        waited++
        switch (phase) {
          case 'near-registry': {
            // Held every frame: the walk controller integrates continuously and
            // would drift out of earshot before the placement converges.
            teleport(registryCar.pose.pos.x + NEAR_DISTANCE, registryCar.pose.pos.z)
            if (waited > 90) {
              out.walkPast = summarise(rows.splice(0))
              phase = 'on-foot'
              waited = 0
            } else if (waited > 45) {
              rows.push(sample())
            }
            break
          }
          case 'on-foot': {
            // The negative control, standing on the car about to be entered.
            //
            // The car is pinned and re-read every frame. Picking a stationary
            // car once is not enough: traffic lights change, the car pulls
            // away, and the player is left standing where it used to be — one
            // run in four aborted with "no prompt appeared while standing on
            // one", which reads as a broken feature rather than a car that
            // drove off.
            car.v = 0
            place = placeOf(car) ?? place
            teleport(place.x, place.z)

            // The precondition is waited for, not assumed. This baseline is
            // only a *negative* control if nothing is legitimately driving the
            // bus, and one run picked a city car with an AI car circulating
            // 9 m away: the engine was correctly on, and the gate called it a
            // failure. Registry cars circulate, so the condition arrives on its
            // own if given a few seconds.
            const d = nearestMovingDistance()
            if (!audio.diagnostics().engine.on && (d === null || d > 60)) idleFrames++
            else {
              idleFrames = 0
              rows.length = 0
            }

            if (idleFrames > 75) {
              out.onFoot = summarise(rows.splice(0))
              phase = 'press'
              waited = 0
            } else if (idleFrames > 30) {
              rows.push(sample())
            } else if (waited > 600) {
              out.aborted =
                'the engine bus never went idle on foot — a moving registry car ' +
                'stayed within earshot, so there is no uncontaminated baseline'
              out.framesAdvanced = frames() - f0
              out.inconclusive = true
              return done(out)
            }
            break
          }
          case 'press': {
            car.v = 0
            place = placeOf(car) ?? place
            teleport(place.x, place.z)
            if (!sim.prompt?.trafficCar) {
              if (waited > 240) {
                out.aborted = 'no city-car prompt appeared while standing on one'
                out.framesAdvanced = frames() - f0
                return done(out)
              }
              break
            }
            out.promptSeen = sim.prompt.label
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }))
            phase = 'release'
            break
          }
          case 'release': {
            window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', bubbles: true }))
            // Throttle down and held, so the note is a car pulling away rather
            // than one idling in neutral.
            window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))
            phase = 'driving'
            waited = 0
            break
          }
          case 'driving': {
            const id = sim.registry.playerVehicleId
            const speed =
              id === null ? 0 : Math.abs(sim.registry.vehicles.get(id)?.motion.speed ?? 0)

            // Sampled only once the car is genuinely pulling, rather than after
            // a fixed 60 frames. One run entered a car that was boxed in by AI
            // traffic and never moved: an idle note is not the note under test,
            // and reporting it as an inaudible engine would be a lie about the
            // product. Gating on speed cannot mask an audio fault either — the
            // vehicle sim does not know the mix exists.
            if (speed > 1) rows.push(sample())

            if (rows.length > 90) {
              window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
              out.driving = summarise(rows.splice(0))
              out.framesAdvanced = frames() - f0
              out.paused = rt.paused
              out.playerVehicleId = id
              out.speedMps = speed
              return done(out)
            }
            if (waited > 480) {
              window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
              out.aborted =
                id === null
                  ? 'never got into a car, so the engine was never under test'
                  : 'the car never reached 1 m/s under full throttle — blocked, ' +
                    'not silent; nothing was measured'
              out.framesAdvanced = frames() - f0
              out.playerVehicleId = id
              out.speedMps = speed
              out.inconclusive = true
              return done(out)
            }
            break
          }
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }),
)

const p = result.preconditions ?? {}
const foot = result.onFoot ?? {}
const drive = result.driving ?? {}
const past = result.walkPast ?? {}

// The engine's audible amplitude is the two gains in series. Either alone is a
// lie; this is the number that decides whether a player hears anything.
const audible = (s) => +(((s.level ?? 0) * (s.placeGain ?? 0)).toFixed(4))
const drivingAudible = audible(drive)
const footAudible = audible(foot)

// The walk-past control counts only when there was a moving car to walk past
// and it was far enough for the expected gain to be clearly below unity.
const controlRan =
  result.hadRegistryCarToWalkPast === true &&
  past.sourceDistance !== null &&
  past.sourceDistance !== undefined &&
  past.sourceDistance > 15
const controlFollowsTheLaw =
  controlRan && Math.abs((past.placeGain ?? 1) - (past.expectedPlaceGain ?? 1)) < 0.08

const checks = {
  // ── The instrument ──────────────────────────────────────────────────────
  poolInstalled: !!p.poolInstalled,
  contextRunning: p.audioState === 'running',
  sampleRateSane: (p.sampleRate ?? 0) >= 8000,
  loopRan: (result.framesAdvanced ?? 0) > 0,
  notPaused: result.paused === false,
  // The beds prove the analyser is wired to something. An RMS of exactly zero
  // everywhere would make every comparison below vacuously true.
  analyserReadsTheMix: (foot.rms ?? 0) > 0.0001,

  // ── The negative control ────────────────────────────────────────────────
  silentOnFoot: foot.onNever === true,
  noEngineLevelOnFoot: footAudible < 0.01,

  // ── The reading ─────────────────────────────────────────────────────────
  gotIntoACar: result.playerVehicleId !== null && result.playerVehicleId !== undefined,
  carActuallyMoved: (result.speedMps ?? 0) > 1,
  engineOnWhileDriving: drive.onAlways === true,
  // Idle sits at 0.063 gain and full throttle in first at 0.687, both before
  // ENGINE_BUS_LEVEL (0.42). A pulling car must clear a tenth of the bus.
  engineAudibleWhileDriving: drivingAudible > 0.04,
  // The driver's own engine is centred and un-attenuated: it is where they are.
  ownEngineNotPlacedElsewhere: (drive.placeGain ?? 0) > 0.9,
  ownEngineCentred: Math.abs(drive.pan ?? 1) < 0.05,
  // Corroboration from the master bus, at the same spot as the control.
  mixLouderWhileDriving: (drive.rms ?? 0) > (foot.rms ?? 0) * 1.15,

  // ── The regression control ──────────────────────────────────────────────
  // Only meaningful if a moving registry car was there to walk past — traffic
  // is dynamic, and a fleet that happens to be sitting at a red light gives
  // nothing to place. Reported as skipped rather than silently passed.
  //
  // Asserted against `placeSource`'s own law rather than a number chosen here,
  // and only counted when the source is far enough that the expected gain is
  // unambiguously not unity: the whole point is to prove the placement moved
  // *before* the drive, so that finding it back at 1 while driving means
  // something.
  placementControlTook: !controlRan || (past.onAlways === true && controlFollowsTheLaw),

  noConsoleErrors: errors.length === 0,
}
const pass = Object.values(checks).every(Boolean)

const report = {
  generatedBy: 'scripts/qa/enginecheck.mjs',
  ...result,
  audible: { onFoot: footAudible, driving: drivingAudible },
  placementControl: { ran: controlRan, followsTheLaw: controlFollowsTheLaw },
  checks,
  consoleErrors: errors.slice(0, 5),
  pass,
}

mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

console.log(
  `enginecheck: ${p.poolCars} city car(s), ${p.registryCars} in the registry, ` +
    `${result.framesAdvanced ?? 0} sim frames, ctx ${p.audioState} @ ${p.sampleRate} Hz`,
)
if (result.aborted) console.error(`  ABORTED: ${result.aborted}`)
console.log(
  controlRan
    ? `  walk past ${past.sourceDistance} m: placeGain ${past.placeGain} ` +
        `(law says ${past.expectedPlaceGain})  level ${past.level}  on ${past.onAlways}`
    : `  walk past:        SKIPPED — no moving registry car far enough to place ` +
        `(nearest ${past.sourceDistance ?? 'none'} m)`,
)
console.log(
  `  on foot:          level ${foot.level}  place ${foot.placeGain}  ` +
    `audible ${footAudible}  rms ${foot.rms}`,
)
console.log(
  `  driving @ ${(result.speedMps ?? 0).toFixed(1)} m/s: level ${drive.level}  ` +
    `place ${drive.placeGain}  pan ${drive.pan}  audible ${drivingAudible}  rms ${drive.rms}`,
)
console.log(`  note:             ${drive.hz} Hz, cutoff ${drive.cutoffHz} Hz`)
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) console.error(`  FAIL ${name}`)
}
console.log(`  ${pass ? 'PASS' : 'FAIL'} — ${args.out}`)

await page.close()
await browser.close()
// Exit 2 is "the experiment did not run", not "the engine is broken". The two
// are worth keeping apart: a city car boxed in by AI traffic and a silent
// engine bus produce the same empty numbers, and only one of them is a defect.
if (result.inconclusive || result.aborted || !checks.loopRan || !checks.contextRunning) {
  process.exit(2)
}
process.exit(pass ? 0 : 1)
