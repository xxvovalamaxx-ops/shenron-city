/**
 * Doorway acceptance for the game runtime.
 *
 * Phase 3B was built and measured in the Manhattan authoring app, whose walk
 * controller raycasts the live scene graph — so a wall cut was visible to
 * collision the instant it landed. The game does not work that way: it indexes
 * every building mesh into a MeshBVH once, when its tile streams in, and a cut
 * that arrives afterwards leaves the tree describing a wall that is no longer
 * drawn. Re-running the authoring app's own doorcheck would prove nothing
 * about that, because it never touches the game's collider.
 *
 * So this asks the game's collider directly, and only the collider:
 *
 *   opening  15 rays through the doorway rect via manhattanCollision, from
 *            2 m outside toward the room. Any solid inside 5 m is a blocked
 *            ray. 0 of 15 is the pass.
 *   walk     a stepped traverse from 6 m out to inside the room, each step
 *            resolved by manhattanCollision.move() and stood on
 *            groundHeightAt() — the same two calls the player's own movement
 *            makes. Passing means the room-local x crossed the wall plane.
 *   jump     the largest single-step change in standing height along that
 *            walk. A doorway you have to be launched over is not a doorway.
 *
 * Tiles stream toward the camera, so each door is measured in its own page
 * load with the vision camera parked at that building.
 *
 * Usage:
 *   node scripts/qa/doorcheck.mjs [--server http://127.0.0.1:5173] [--headed]
 *   node scripts/qa/doorcheck.mjs --no-bvh-refresh    # the control run
 *
 * `--no-bvh-refresh` turns off the hook that rebuilds a cut mesh's BVH (a
 * dev-only query flag the pipeline reads) and is the reason to believe the
 * rest of this file: with the hook, 0 of 15 rays are blocked at all four
 * doorways; without it, 15 of 15 at the three that live in streamed tiles, and
 * two of those three walks stop dead in the opening. The fourth, hq_lobby, is
 * placed rather than streamed and passes either way — which is exactly the
 * shape you would expect if staleness is the mechanism.
 *
 * Exit code is 1 if any door fails, or if no door was measured at all.
 */
/* global window */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import puppeteer from 'puppeteer-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')

const BUDGET = {
  /** Rays through the opening that may hit something solid. */
  blocked: 0,
  /** Metres of step-up the walk may take in one 0.05 m stride. */
  jump: 0.5,
}

function resolveExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  if (fromEnv) return fromEnv
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('No Chromium-family browser found. Set PUPPETEER_EXECUTABLE_PATH.')
}

function parseArgs(argv) {
  const args = {
    server: 'http://127.0.0.1:5173',
    headless: true,
    bootMs: 90000,
    cutMs: 60000,
    noBvhRefresh: false,
    out: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = () => argv[++i]
    if (flag === '--server') args.server = value()
    else if (flag === '--headed') args.headless = false
    else if (flag === '--no-bvh-refresh') args.noBvhRefresh = true
    else if (flag === '--out') args.out = value()
    else if (flag === '--boot-ms') args.bootMs = Number(value())
    else if (flag === '--cut-ms') args.cutMs = Number(value())
  }
  if (!args.out) {
    args.out = join(REPO_ROOT, 'evidence', 'doors',
      args.noBvhRefresh ? 'doorcheck-no-bvh-refresh.json' : 'doorcheck.json')
  }
  return args
}

/** A vision-capture URL parked at a world point, looking at another. */
function visionUrl(args, eye, at) {
  const params = new URLSearchParams({
    visionCapture: '1',
    visionX: String(eye[0]), visionY: String(eye[1]), visionZ: String(eye[2]),
    visionTX: String(at[0]), visionTY: String(at[1]), visionTZ: String(at[2]),
    visionFov: '55', visionTime: '15.5', visionRain: '0',
    visionSeed: 'doorcheck-v1',
  })
  if (args.noBvhRefresh) params.set('noBvhRefresh', '1')
  return `${args.server}/?${params.toString()}`
}

// ---------------------------------------------------------------------------
// in-page probes. These run inside the browser and may only use what the game
// already exposes: window.__cityWorld and window.__manhattanCollision.
// ---------------------------------------------------------------------------

/** Wait for the city pipeline to finish booting and configure its doors. */
function waitForDoorsInPage(timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const w = window.__cityWorld
      if (w && w.ready && w.doors && w.doors.ready) return resolve(true)
      if (Date.now() - started > timeoutMs) return resolve(false)
      setTimeout(tick, 250)
    }
    tick()
  })
}

/** Wait until a named door reports a real opening in the tile geometry. */
function waitForCutInPage(key, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      const d = window.__cityWorld?.doors?.doors?.find((x) => x.key === key)
      if (d && d.cut) return resolve(true)
      if (Date.now() - started > timeoutMs) return resolve(false)
      setTimeout(tick, 250)
    }
    tick()
  })
}

/** The world points a door needs, read out of the live runtime. */
function doorGeometryInPage(key) {
  const doors = window.__cityWorld.doors
  const d = doors.doors.find((x) => x.key === key)
  if (!d) return null
  const plane = doors._wallPlaneX(d)
  const dir = doors._doorDir(d)
  const outside = doors.roomToWorld(d, plane - 6.0, d.bayCenter, 0)
  return {
    key,
    bid: d.bid,
    kind: d.kind,
    cut: !!d.cut,
    cutFaces: d.cutFaces || 0,
    plane,
    bayCenter: d.bayCenter,
    bayY0: d.bayY0,
    bayY1: d.bayY1,
    dir: [dir.x, dir.y, dir.z],
    outside: [outside.x, outside.y, outside.z],
  }
}

/**
 * 15 rays through the doorway rect, asked of the game's collider.
 *
 * Deliberately manhattanCollision.castDistance and not a Raycaster over the
 * scene graph: the scene graph is what renders, and the whole failure this
 * guards against is a hole that renders but does not collide.
 */
function probeOpeningInPage(key) {
  const doors = window.__cityWorld.doors
  const col = window.__manhattanCollision
  const d = doors.doors.find((x) => x.key === key)
  if (!d) return null
  const plane = doors._wallPlaneX(d)
  const dir = doors._doorDir(d)
  const cols = 5
  const rows = 3
  const rays = []
  let blocked = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const y = d.bayY0 + ((c + 0.5) / cols) * (d.bayY1 - d.bayY0)
      const z = 1.2 + (r / rows) * 1.1
      const o = doors.roomToWorld(d, plane - 2.0, y, z)
      // startYOffset 0: probe the exact point, not half a metre above it.
      const dist = col.castDistance(
        { x: o.x, y: o.y, z: o.z }, { x: dir.x, y: dir.y, z: dir.z }, 8.0, 0,
      )
      const hit = dist < 2.0 + 3.0
      if (hit) blocked++
      rays.push({ hit, distance: +dist.toFixed(2) })
    }
  }
  return { rays: rays.length, blocked, detail: rays }
}

/**
 * Walk in through the opening using only the calls player movement makes.
 *
 * 0.05 m strides for 12 m: enough to start outside the trigger, cross the
 * wall and stop against the room's back wall. Each stride is resolved by
 * move() and then stood on groundHeightAt(), and the run records where the
 * room-local x got to and the worst single-stride step up.
 */
function walkInPage(key) {
  const doors = window.__cityWorld.doors
  const col = window.__manhattanCollision
  const THREE = window.THREE
  const d = doors.doors.find((x) => x.key === key)
  if (!d) return null
  const plane = doors._wallPlaneX(d)
  const dir = doors._doorDir(d)
  const start = doors.roomToWorld(d, plane - 6.0, d.bayCenter, 0)
  const ground0 = col.groundHeightAt(start.x, start.z)
  const pos = { x: start.x, y: ground0 === null ? start.y : ground0, z: start.z }
  const scratch = new THREE.Vector3()
  const localX = (p) => doors._local(d, scratch.set(p.x, p.y, p.z), new THREE.Vector3()).x

  const STRIDE = 0.05
  const STEPS = 240
  let maxJump = 0
  let deepest = localX(pos)
  const startLocalX = deepest
  let stalled = 0
  for (let i = 0; i < STEPS; i++) {
    const before = { x: pos.x, y: pos.y, z: pos.z }
    const next = col.move(pos, dir.x * STRIDE, dir.z * STRIDE)
    pos.x = next.x
    pos.z = next.z
    const g = col.groundHeightAt(pos.x, pos.z)
    if (g !== null) {
      maxJump = Math.max(maxJump, Math.abs(g - pos.y))
      pos.y = g
    }
    const moved = Math.hypot(pos.x - before.x, pos.z - before.z)
    stalled = moved < STRIDE * 0.2 ? stalled + 1 : 0
    deepest = Math.max(deepest, localX(pos))
    // 20 strides of no progress is a wall, not a slow patch.
    if (stalled >= 20) break
  }
  return {
    startLocalX: +startLocalX.toFixed(3),
    plane,
    deepestLocalX: +deepest.toFixed(3),
    // The room side of the wall plane. Crossing it is the whole test.
    crossed: deepest > plane + 0.35,
    maxJump: +maxJump.toFixed(3),
    finalY: +pos.y.toFixed(3),
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const browser = await puppeteer.launch({
    executablePath: resolveExecutablePath(),
    headless: args.headless,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800 },
  })

  const results = []
  try {
    // ---- pass 1: boot once anywhere, to learn where the doors are --------
    const page = await browser.newPage()
    page.on('console', (m) => {
      const t = m.text()
      if (t.startsWith('[doors]') || t.startsWith('[interiors]') || t.startsWith('[hq]')) {
        console.log('   page:', t)
      }
    })
    await page.goto(visionUrl(args, [1000, 30, -3000], [1000, 20, -2900]), {
      waitUntil: 'domcontentloaded', timeout: 60000,
    })
    const booted = await page.evaluate(waitForDoorsInPage, args.bootMs)
    if (!booted) throw new Error('city pipeline did not boot within the budget')
    const keys = await page.evaluate(() =>
      window.__cityWorld.doors.doors.map((d) => d.key))
    const geometry = {}
    for (const key of keys) geometry[key] = await page.evaluate(doorGeometryInPage, key)
    await page.close()
    console.log(`doorcheck: ${keys.length} doorways configured — ${keys.join(', ')}\n`)

    // ---- pass 2: one page load per door, parked at the building ----------
    for (const key of keys) {
      const g = geometry[key]
      const eye = [g.outside[0], g.outside[1] + 1.7, g.outside[2]]
      const at = [
        eye[0] + g.dir[0] * 10, eye[1] + g.dir[1] * 10, eye[2] + g.dir[2] * 10,
      ]
      const p = await browser.newPage()
      await p.goto(visionUrl(args, eye, at), {
        waitUntil: 'domcontentloaded', timeout: 60000,
      })
      const ok = await p.evaluate(waitForDoorsInPage, args.bootMs)
      if (!ok) {
        results.push({ key, pass: false, why: 'pipeline did not boot' })
        await p.close()
        continue
      }
      const cut = await p.evaluate(waitForCutInPage, key, args.cutMs)
      const opening = await p.evaluate(probeOpeningInPage, key)
      const walk = cut ? await p.evaluate(walkInPage, key) : null
      const live = await p.evaluate(doorGeometryInPage, key)
      const errors = await p.evaluate(() => (window.__pageErrors || []).length)
      await p.close()

      const pass = Boolean(
        cut && opening && opening.blocked <= BUDGET.blocked &&
        walk && walk.crossed && walk.maxJump <= BUDGET.jump,
      )
      results.push({
        key, bid: live.bid, kind: live.kind, pass,
        cut, cutFaces: live.cutFaces, opening, walk, consoleErrors: errors,
      })
      const mark = pass ? 'PASS' : 'FAIL'
      console.log(
        `${mark}  ${key.padEnd(12)} bid ${String(live.bid).padEnd(6)} ` +
        `cut=${cut} faces=${live.cutFaces} ` +
        `blocked=${opening ? `${opening.blocked}/${opening.rays}` : 'n/a'} ` +
        `crossed=${walk ? walk.crossed : 'n/a'} ` +
        `localX ${walk ? `${walk.startLocalX} -> ${walk.deepestLocalX} (plane ${walk.plane})` : 'n/a'} ` +
        `jump=${walk ? walk.maxJump : 'n/a'}`,
      )
    }
  } finally {
    await browser.close()
  }

  const passed = results.filter((r) => r.pass).length
  const summary = {
    generatedBy: 'scripts/qa/doorcheck.mjs',
    runtime: 'src/ (the game) — collision via manhattanCollision',
    bvhRefresh: !args.noBvhRefresh,
    budget: BUDGET,
    total: results.length,
    passed,
    results,
  }
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`\n${passed}/${results.length} passing — ${args.out}`)
  process.exit(results.length > 0 && passed === results.length ? 0 : 1)
}

main().catch((err) => {
  console.error('doorcheck failed:', err)
  process.exit(1)
})
