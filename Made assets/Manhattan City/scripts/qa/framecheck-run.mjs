#!/usr/bin/env node
// framecheck-run.mjs — Phase 2O-A visual-evidence runner.
//
// Zero dependencies: Node's global WebSocket speaks CDP directly to a
// headless Chrome, and the dev server is `npm run dev` in the app. It drives
// the real app (apps/manhattan-threejs) through every capture.js SHOT plus
// the Floor 45 / HQ lobby / lift / car / Shenron interior views, reads the
// GPU frame back as pixels via a 2D-canvas copy, runs the framecheck module
// in the page, and writes two JSON evidence files:
//
//   docs/qa/evidence/qa-integrity/framecheck_results.json
//   docs/qa/evidence/qa-integrity/defects.json
//
// It also POSTs every frame through the app's own /__capture sink, so the
// PNGs land in evidence/phase2/ next to every other piece of Phase 2
// evidence (gitignored, never committed).
//
// Usage:
//   node scripts/qa/framecheck-run.mjs
//
// House rule, HANDOFF §0: a number you can diff is worth more than a
// picture. Every check below is a threshold applied to a measured number,
// and a check that cannot be measured is recorded as unavailable, never
// faked.

import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const APP = path.join(REPO, 'apps', 'manhattan-threejs')
const OUT = path.join(REPO, 'docs', 'qa', 'evidence', 'qa-integrity')
const EVIDENCE = path.join(REPO, 'evidence', 'phase2')

// 5174 is this worker's default; a parallel worker owns 5173 and another
// owns 5175, so if 5174 is taken the runner falls back to the first free port
// in 5180-5210 and records which one it ended up on.
let DEV_PORT = 5174
const CDP_PORT = 9224
let APP_URL = `http://127.0.0.1:${DEV_PORT}/`
const CHROME = process.env.CHROME ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const W = 1280
const H = 720
const BOOT_TIMEOUT_MS = 900000
const SHOT_TIMEOUT_MS = 120000

// The ten capture.js SHOTS, plus the five interior views whose placements
// are findable in hq.js / corridor.js (FLOOR45.shot, LOBBY.shot, the lift
// rig's eye/at, CAR_EYE, the Shenron dais).
const SHOTS = [
  { name: 'midtown_air', kind: 'aerial', occ: { maxNearFraction: 0.05 } },
  { name: 'skyline_from_east', kind: 'aerial', occ: { maxNearFraction: 0.05 } },
  { name: 'downtown_air', kind: 'aerial', occ: { maxNearFraction: 0.05 } },
  { name: 'central_park_air', kind: 'aerial', occ: { maxNearFraction: 0.05 } },
  { name: 'fifth_ave_34th', kind: 'street', occ: { maxNearFraction: 0.35 } },
  { name: 'times_square', kind: 'street', occ: { maxNearFraction: 0.35 } },
  { name: 'west_village', kind: 'street', occ: { maxNearFraction: 0.35 } },
  { name: 'harlem_rowhouses', kind: 'street', occ: { maxNearFraction: 0.35 } },
  { name: 'fidi_canyon', kind: 'street', occ: { maxNearFraction: 0.35 } },
  { name: 'soho_castiron', kind: 'street', occ: { maxNearFraction: 0.35 } },
  // interiors: a small box means most of the frame is legitimately near
  // geometry, so the cabin shots cap higher and additionally require the
  // top row-band to stay clear (the P2-069 headlining regression).
  { name: 'floor45_ops', kind: 'interior', occ: { maxNearFraction: 0.35 },
    setup: 'floor45_ops' },
  { name: 'hq_lobby', kind: 'interior', occ: { maxNearFraction: 0.35 },
    setup: 'hq_lobby' },
  // The lift cab is 2.1 x 2.3 x 2.6 m and the eye sits 1.7 m off its floor:
  // the ceiling is 0.9 m above the eye and the walls 1.05-1.15 m away, so
  // ~0.85 of the frame is nearer than 1.5 m *by construction*. No fixed
  // near-field cap (0.35, or even 0.6) can pass there, so the shot is judged
  // against the enclosure itself: the frame's near field must not exceed
  // what the cab's own meshes predict from the same camera, plus margin
  // (judgeEnclosureOcclusion). The car cabin stays on the fixed caps: at
  // 0.16 near it clears them with room to spare, and the fixed top-band cap
  // is the one that catches a roof pushed down over the eye (P2-069).
  { name: 'lift_cab', kind: 'interior', occ: { enclosure: 'lift' },
    setup: 'lift_cab' },
  { name: 'car_cabin', kind: 'interior',
    occ: { maxNearFraction: 0.6, maxNearTop: 0.45 }, setup: 'car_cabin' },
  { name: 'shenron_arrival', kind: 'interior', occ: { maxNearFraction: 0.35 },
    setup: 'shenron_arrival' },
]

// ---------------------------------------------------------------------------
// preload: capture console errors, non-ok fetches and XHR failures in-page,
// so "missing asset" is a count, not a recollection.
// ---------------------------------------------------------------------------

const PRELOAD = `(() => {
  if (window.__qaLog) return
  const log = { errors: [], warns: [], requests: [] }
  window.__qaLog = log
  const t = () => performance.now()
  const origErr = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...a) => { log.errors.push({ t: t(), m: a.map(String).join(' ') }); origErr(...a) }
  console.warn = (...a) => { log.warns.push({ t: t(), m: a.map(String).join(' ') }); origWarn(...a) }
  window.addEventListener('error', (e) => log.errors.push({ t: t(), m: 'window.onerror: ' + e.message }))
  window.addEventListener('unhandledrejection', (e) => log.errors.push({ t: t(), m: 'unhandledrejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)) }))
  const of = window.fetch.bind(window)
  window.fetch = async (...a) => {
    const r = await of(...a)
    if (!r.ok && !String(a[0]).includes('/__capture')) log.requests.push({ t: t(), url: String(a[0]), status: r.status })
    return r
  }
  const OX = window.XMLHttpRequest
  const WX = function (...a) {
    const x = new OX(...a)
    const open = x.open.bind(x)
    x.open = (m, url, ...rest) => {
      x.addEventListener('loadend', () => {
        if (x.status >= 400) log.requests.push({ t: t(), url: String(url), status: x.status })
      })
      return open(m, url, ...rest)
    }
    return x
  }
  WX.prototype = OX.prototype
  window.XMLHttpRequest = WX
})()`

// ---------------------------------------------------------------------------
// interior shot placement, defined in the page once the runtime is up. Each
// returns { eye, at, mode } for __capture.shootFrom, or null if the rig is
// missing (then the shot is recorded as unavailable, not faked).
// ---------------------------------------------------------------------------

const SETUP_FNS = `window.__qaSetup = {
  floor45_ops() {
    const m = window.__manhattan
    const f = m.hq && m.hq.rooms && m.hq.rooms.floor45
    if (!f) return null
    m.interiors.exit()
    m.interiors.enter(f)
    if (m.corridor && m.corridor.shenron) m.corridor.shenron.visible = false
    return { eye: f.shot.eye, at: f.shot.at, mode: 'walk' }
  },
  hq_lobby() {
    const m = window.__manhattan
    const l = m.hq && m.hq.rooms && m.hq.rooms.lobby
    if (!l) return null
    m.interiors.exit()
    m.interiors.enter(l)
    return { eye: l.shot.eye, at: l.shot.at, mode: 'walk' }
  },
  lift_cab() {
    const m = window.__manhattan
    const THREE = m.THREE
    const lift = m.corridor && m.corridor.lift
    const from = (m.interiors.rooms || []).find((r) => r.key === 'hq_lobby')
    const to = m.hq && m.hq.rooms && m.hq.rooms.floor45
    if (!lift || !from || !to) return null
    m.interiors.exit()
    const p = from.local(2.0, 0, 0)
    lift.position.set(p.x, p.y, p.z)
    lift.rotation.set(0, from.yaw, 0)
    lift.visible = true
    m.interiors.lamp.intensity = 1.6
    lift.updateMatrixWorld(true)
    const eye = lift.localToWorld(new THREE.Vector3(1.15, 1.7, 0))
    const at = lift.localToWorld(new THREE.Vector3(-3.0, 1.45, 0))
    return { eye, at, mode: 'walk' }
  },
  car_cabin() {
    const m = window.__manhattan
    const THREE = m.THREE
    const car = m.corridor && m.corridor.car
    const route = m.corridor && m.corridor.routes && m.corridor.routes.hq
    if (!car || !route) return null
    m.interiors.exit()
    const pts = route.pts
    const E = [-0.10, 0.36, 1.07]   // CAR_EYE from corridor.js
    const want = 0.02 * route.measured
    let acc = 0
    let x = 0, y = 0, yaw = 0
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      if (acc + seg >= want || i === pts.length - 1) {
        const t = seg > 1e-6 ? (want - acc) / seg : 0
        x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t
        y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t
        const dx = pts[i][0] - pts[i - 1][0]
        const dy = pts[i][1] - pts[i - 1][1]
        yaw = Math.atan2(-dx, dy)
        break
      }
      acc += seg
    }
    car.position.set(x, (m.city.meta.land_level_m ?? 12.0) + 0.02, -y)
    car.rotation.set(0, yaw, 0)
    car.visible = true
    m.interiors.lamp.intensity = 0.62
    car.updateMatrixWorld(true)
    const eye = car.localToWorld(new THREE.Vector3(E[0], E[2], -E[1]))
    const at = car.localToWorld(new THREE.Vector3(E[0] + 30, E[2] - 1.0, -E[1]))
    return { eye, at, mode: 'walk' }
  },
  shenron_arrival() {
    const m = window.__manhattan
    const f = m.hq && m.hq.rooms && m.hq.rooms.floor45
    if (!f || !m.hq.spec) return null
    m.interiors.exit()
    m.interiors.enter(f)
    const d = m.hq.spec.anchor.dais
    if (m.corridor && m.corridor.shenron) m.corridor.shenron.visible = true
    return {
      eye: f.local(1.6, d.y - 3.4, 1.72),
      at: f.local(d.x, d.y, d.z + 1.8),
      mode: 'walk',
    }
  },
}
window.__qaTeardown = () => {
  const m = window.__manhattan
  if (!m) return
  m.interiors.exit()
  m.interiors.lamp.intensity = 0
  if (m.corridor && m.corridor.lift) m.corridor.lift.visible = false
  if (m.corridor && m.corridor.car) m.corridor.car.visible = false
  if (m.corridor && m.corridor.shenron) m.corridor.shenron.visible = false
}`

// Per-shot page script: place (if interior), capture via the app's own sink,
// read the frame back, run every check, return JSON.
function shotScript(cfg) {
  return `(async () => {
  const m = window.__manhattan
  const mod = m.framecheck
  const cfg = ${JSON.stringify(cfg)}
  const resolveOcc = (occ) => {
    if (!occ || typeof occ.enclosure !== 'string') return occ
    // resolve the rig the camera sits inside, from the corridor runtime
    const rig = occ.enclosure === 'lift' && m.corridor && m.corridor.lift
      ? m.corridor.lift
      : occ.enclosure === 'car' && m.corridor && m.corridor.car
        ? m.corridor.car : null
    if (!rig) return null
    return { ...occ, enclosure: rig }
  }
  let cap = null
  if (window.__qaSetup && window.__qaSetup[cfg.name]) {
    const shot = window.__qaSetup[cfg.name]()
    if (shot) cap = await window.__capture.shootFrom(cfg.name, shot.eye, shot.at, shot.mode || 'walk')
  } else if (window.__capture.SHOTS[cfg.name]) {
    cap = await window.__capture.shoot(cfg.name, window.__capture.SHOTS[cfg.name])
  }
  const r = m.renderer
  const prev = r.getSize(new m.THREE.Vector2())
  const prevAspect = m.camera.aspect
  let px = null
  let depthOcc = null
  r.setSize(${W}, ${H}, false)
  m.camera.aspect = ${W} / ${H}
  m.camera.updateProjectionMatrix()
  try {
    r.render(m.scene, m.camera)
    // The contract's occlusionFraction needs real depth. Read the depth
    // buffer straight after the render (the default framebuffer still holds
    // it until the compositor consumes it), convert to view-space metres,
    // and attach it to the ImageData so the pure function can measure it.
    let viewDepth = null
    try {
      const gl = r.getContext()
      const buf = new Float32Array(${W} * ${H})
      gl.readPixels(0, 0, ${W}, ${H}, gl.DEPTH_COMPONENT, gl.FLOAT, buf)
      // The default framebuffer does not reliably answer a depth readback in
      // WebGL2 (it is an INVALID_OPERATION; the buffer is left untouched and
      // contains whatever the allocator had). A garbage buffer reads as
      // absurdly small depths, so an unvalidated readback reports "everything
      // is closer than 1.5 m" — a fake measurement. Validate before use: a
      // real depth buffer is finite, within [0, 1] (normalised), and varies.
      const bad = buf[0]
      let nonFinite = 0
      let outOfRange = 0
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i]
        if (!Number.isFinite(v)) { nonFinite++; continue }
        if (v < -0.01 || v > 1.01) outOfRange++
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      if (nonFinite === 0 && outOfRange === 0 && hi - lo > 1e-6) {
        viewDepth = mod.depthFromBuffer(buf, m.camera.near, m.camera.far)
      } else {
        viewDepth = null
        window.__qaDepthReadback = {
          unavailable: true,
          reason: 'depth readback invalid',
          nonFinite, outOfRange, range: [+lo.toFixed(3), +hi.toFixed(3)],
        }
      }
    } catch (e) {
      viewDepth = null
      window.__qaDepthReadback = { unavailable: true, reason: String(e.message || e) }
    }
    const c = document.createElement('canvas')
    c.width = ${W}; c.height = ${H}
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(r.domElement, 0, 0)
    const img = g.getImageData(0, 0, ${W}, ${H})
    if (viewDepth) {
      img.depth = viewDepth
      const f = mod.occlusionFraction(img, 1.5)
      depthOcc = typeof f === 'number'
        ? { fraction: +f.toFixed(4), nearDist: 1.5, pixels: ${W} * ${H} }
        : f
    } else {
      depthOcc = window.__qaDepthReadback ||
        { unavailable: true, reason: 'depth readback failed' }
    }
    px = await mod.runChecks(img, { kind: cfg.kind, audio: window.__qaAudio })
  } finally {
    r.setSize(prev.x, prev.y, false)
    m.camera.aspect = prevAspect
    m.camera.updateProjectionMatrix()
  }
  const occ = resolveOcc(cfg.occ)
  if (cfg.occ && occ === null) {
    return { name: cfg.name, error: 'enclosure rig not found: ' + cfg.occ.enclosure, pass: false }
  }
  const sc = mod.sceneChecks(m, { occlusion: occ })
  return {
    name: cfg.name,
    capture: cap,
    checks: px.checks,
    audio: px.audio,
    scene: sc,
    size: px.size,
    depthOcc,
    stats: { triangles: r.info.render.triangles, calls: r.info.render.calls },
  }
})()`
}

// ---------------------------------------------------------------------------
// CDP over Node's global WebSocket
// ---------------------------------------------------------------------------

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.netFailures = []
    this._reqUrl = new Map()
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id) {
        const p = this.pending.get(m.id)
        if (!p) return
        this.pending.delete(m.id)
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`))
        else p.resolve(m.result)
        return
      }
      if (m.method === 'Network.requestWillBeSent') {
        this._reqUrl.set(m.params.requestId, m.params.request.url)
      } else if (m.method === 'Network.loadingFailed') {
        this.netFailures.push({
          url: this._reqUrl.get(m.params.requestId) || '(unknown)',
          errorText: m.params.errorText || '',
          canceled: !!m.params.canceled,
        })
      }
    })
  }

  open() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() =>
        reject(new Error('CDP websocket open timed out')), 30000)
      this.ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve(this)
      }, { once: true })
      this.ws.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('CDP websocket failed'))
      }, { once: true })
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    try { this.ws.close() } catch { /* already gone */ }
  }
}

async function cdpEvaluate(cdp, expression, timeout = SHOT_TIMEOUT_MS) {
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`CDP evaluate timed out after ${timeout} ms`)), timeout))
  const r = await Promise.race([
    cdp.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    }),
    timer,
  ])
  if (r.exceptionDetails) {
    const d = r.exceptionDetails.exception &&
      (r.exceptionDetails.exception.description ||
        r.exceptionDetails.exception.value)
    throw new Error('page script failed: ' + JSON.stringify(d || r.exceptionDetails))
  }
  return r.result.value
}

async function fetchWithTimeout(url, ms = 5000, init = {}) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(t)
  }
}

// Is a TCP port free to bind on 127.0.0.1?
function portFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)))
  })
}

// The dev port for this run: 5174 if free, else the first free port in
// 5180..5210. Throws rather than silently colliding with a neighbour.
async function choosePort() {
  if (await portFree(DEV_PORT)) return DEV_PORT
  for (let p = 5180; p <= 5210; p++) {
    if (await portFree(p)) return p
  }
  throw new Error('no free dev port: 5174 taken and 5180..5210 all busy')
}

async function waitFor(fn, timeout, what) {
  const t0 = Date.now()
  let last
  for (;;) {
    try {
      last = await fn()
      if (last) return last
    } catch (e) { last = e }
    if (Date.now() - t0 > timeout) {
      throw new Error(`timed out waiting for ${what} (last: ${String(last)})`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }
}

function gitOut(args) {
  try {
    return execSync(`git ${args}`, { cwd: REPO, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now()
  const results = {
    generatedAt: new Date().toISOString(),
    runner: 'scripts/qa/framecheck-run.mjs',
    branch: gitOut('rev-parse --abbrev-ref HEAD'),
    commit: gitOut('rev-parse --short HEAD'),
    app: APP_URL,
    frames: { width: W, height: H },
    shots: {},
    system: { devPort: null, boot: null, audio: null, audioVerify: null },
    summary: null,
  }

  DEV_PORT = await choosePort()
  APP_URL = `http://127.0.0.1:${DEV_PORT}/`
  results.app = APP_URL
  results.system.devPort = DEV_PORT

  mkdirSync(OUT, { recursive: true })
  const profile = mkdtempSync(path.join(tmpdir(), 'qa-chrome-'))

  let dev = null
  let chrome = null
  let cdp = null
  try {
    // ---- dev server ------------------------------------------------------
    console.log(`[runner] starting dev server on :${DEV_PORT}`)
    // Spawning npm.cmd directly throws EINVAL on this Node/Windows combo,
    // so route through cmd.exe /c.
    const devCmd = process.platform === 'win32'
      ? [(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'),
        ['/d', '/s', '/c',
          `npm run dev -- --host 127.0.0.1 --port ${DEV_PORT} --strictPort`]]
      : ['npm', ['run', 'dev', '--', '--host', '127.0.0.1',
        '--port', String(DEV_PORT), '--strictPort']]
    dev = spawn(devCmd[0], devCmd[1], {
      cwd: APP, stdio: ['ignore', 'pipe', 'pipe'],
    })
    dev.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`))
    dev.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`))
    dev.on('exit', (code) => {
      if (code && code !== 0 && cdp) {
        console.error(`[runner] dev server exited early (code ${code})`)
      }
    })
    await waitFor(async () => {
      const r = await fetchWithTimeout(APP_URL)
      return r && r.ok
    }, 120000, 'dev server')

    // ---- headless Chrome -------------------------------------------------
    console.log(`[runner] launching headless Chrome on :${CDP_PORT}`)
    chrome = spawn(CHROME, [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--enable-unsafe-swiftshader',
      `--window-size=${W},${H}`,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking',
      'about:blank',
    ], { stdio: 'ignore' })
    chrome.on('error', (e) => {
      throw new Error(`failed to launch Chrome at ${CHROME}: ${e.message}`)
    })
    await waitFor(async () => {
      const r = await fetchWithTimeout(
        `http://127.0.0.1:${CDP_PORT}/json/version`)
      return r && r.ok
    }, 60000, 'CDP endpoint')

    // ---- attach ----------------------------------------------------------
    let target
    for (const method of ['PUT', 'GET']) {
      try {
        const r = await fetchWithTimeout(
          `http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, 5000,
          { method })
        if (r.ok) { target = await r.json(); break }
      } catch { /* next method */ }
    }
    if (!target || !target.webSocketDebuggerUrl) {
      throw new Error('could not create a CDP target')
    }
    cdp = await new Cdp(target.webSocketDebuggerUrl).open()
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Log.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',
      { source: PRELOAD })

    // ---- boot ------------------------------------------------------------
    console.log('[runner] navigating…')
    await cdp.send('Page.navigate', { url: APP_URL })
    let bootLog
    try {
      bootLog = await waitFor(async () => {
        const v = await cdpEvaluate(cdp, `(() => {
          const m = window.__manhattan
          if (!m || !window.__capture) return null
          const b = document.getElementById('boot')
          const gone = !b || b.classList.contains('gone')
          return { ready: gone, tiles: m.streamer ? m.streamer.tileCount : 0 }
        })()`, 15000)
        return v && v.ready ? v : null
      }, BOOT_TIMEOUT_MS, 'boot (streamer + capture installed)')
    } catch (e) {
      // a boot that does not arrive is either slow or broken — say which
      const diag = await cdpEvaluate(cdp, `(() => {
        const m = window.__manhattan
        const b = document.getElementById('boot')
        const l = window.__qaLog
        return {
          hasManhattan: !!m,
          hasCapture: !!window.__capture,
          bootText: b && b.textContent ? b.textContent.slice(0, 200) : null,
          bootGone: !!b && b.classList.contains('gone'),
          errors: l ? l.errors.slice(-10).map((x) => x.m) : null,
          fails: l ? l.requests.slice(-10).map((x) => x.url + ' -> ' + x.status) : null,
        }
      })()`, 20000).catch((e2) => ({ diagFailed: String(e2) }))
      console.error('[runner] boot timed out; page state:', JSON.stringify(diag))
      throw e
    }
    console.log(`[runner] boot ready, ${bootLog.tiles} tiles configured`)

    // ---- framecheck module + audio --------------------------------------
    const frameCheck = await cdpEvaluate(cdp, `(async () => {
      const mod = await import('/src/framecheck.js')
      window.__manhattan.framecheck = mod
      const audio = await mod.audioChecks()
      window.__qaAudio = audio
      let verify = null
      if (typeof window.__manhattan.verifyAudio === 'function') {
        verify = await window.__manhattan.verifyAudio()
      }
      return { exports: Object.keys(mod).sort(), audio, verify }
    })()`, 90000)
    results.system.audio = frameCheck.audio
    results.system.audioVerify = frameCheck.verify
    console.log('[runner] framecheck exports:',
      frameCheck.exports.join(', '))
    if (frameCheck.audio && frameCheck.audio.available) {
      console.log('[runner] audio: silence',
        frameCheck.audio.silenceRms, 'noise', frameCheck.audio.noiseRms,
        'pan ratio', frameCheck.audio.asymRatio)
    }
    if (frameCheck.verify) {
      console.log('[runner] city audio verify: silent',
        frameCheck.verify.silent.rms, 'traffic',
        frameCheck.verify.trafficOnly.rms, 'siren',
        frameCheck.verify.sirenOnly.rms)
    }

    await cdpEvaluate(cdp, SETUP_FNS, 15000)

    // ---- shots -----------------------------------------------------------
    const bootEntries = await cdpEvaluate(cdp, `(() => {
      const l = window.__qaLog
      return { errors: l.errors.slice(), warns: l.warns.slice(), requests: l.requests.slice() }
    })()`, 15000)
    results.system.boot = {
      consoleErrors: bootEntries.errors,
      warnings: bootEntries.warns,
      failedRequests: bootEntries.requests,
    }
    if (bootEntries.errors.length) {
      console.warn('[runner] boot console errors:',
        bootEntries.errors.map((e) => e.m))
    }

    let interiorDone = false
    for (const cfg of SHOTS) {
      const shotT0 = Date.now()
      console.log(`[runner] shot ${cfg.name} (${cfg.kind})…`)
      const entry = { kind: cfg.kind, startedAt: new Date().toISOString() }
      try {
        const before = await cdpEvaluate(cdp, `(() => {
          const l = window.__qaLog
          return { e: l.errors.length, w: l.warns.length, r: l.requests.length }
        })()`, 15000)
        const v = await cdpEvaluate(cdp, shotScript(cfg))
        const after = await cdpEvaluate(cdp, `(() => {
          const l = window.__qaLog
          return { errors: l.errors.slice(), warns: l.warns.slice(), requests: l.requests.slice() }
        })()`, 15000)
        entry.capture = v.capture
        entry.checks = v.checks
        entry.audio = v.audio
        entry.scene = v.scene
        entry.size = v.size
        entry.depthOcc = v.depthOcc
        entry.stats = v.stats
        entry.consoleErrors =
          after.errors.slice(before.e).map((e) => e.m)
        entry.failedRequests =
          after.requests.slice(before.r).map((e) => e.url + ' -> ' + e.status)
        entry.warnings =
          after.warns.slice(before.w).map((e) => e.m)

        const cap = v.capture || {}
        let fileBytes = null
        if (cap.ok && cap.file) {
          try { fileBytes = statSync(path.join(REPO, cap.file)).size }
          catch { fileBytes = null }
        }
        entry.captureBytesOnDisk = fileBytes
        entry.checksPass = allChecksPass(entry)
        const capOk = entry.capture != null && entry.capture.ok !== false
        entry.pass = capOk && entry.checksPass
      } catch (e) {
        entry.error = String(e.message || e)
        entry.pass = false
        console.error(`[runner] shot ${cfg.name} failed: ${entry.error}`)
      }
      entry.durationMs = Date.now() - shotT0
      if (cfg.setup && !interiorDone) {
        interiorDone = true
        await cdpEvaluate(cdp, 'window.__qaTeardown && window.__qaTeardown()',
          15000)
      }
      results.shots[cfg.name] = entry
    }
    if (interiorDone) {
      await cdpEvaluate(cdp, 'window.__qaTeardown && window.__qaTeardown()',
        15000)
    }
  } finally {
    if (cdp) cdp.close()
    if (chrome) { chrome.kill(); await new Promise((r) => setTimeout(r, 500)) }
    if (dev) { dev.kill(); await new Promise((r) => setTimeout(r, 500)) }
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
  }

  // ---- write evidence ----------------------------------------------------
  const defects = buildDefects(results)
  results.summary = {
    shotsTotal: SHOTS.length,
    shotsPassed: Object.values(results.shots).filter((s) => s.pass).length,
    shotsFailed: Object.values(results.shots).filter((s) => !s.pass).length,
    defects: defects.length,
    durationMs: Date.now() - t0,
  }
  writeFileSync(path.join(OUT, 'framecheck_results.json'),
    JSON.stringify(results, null, 2))
  writeFileSync(path.join(OUT, 'defects.json'),
    JSON.stringify({ generatedAt: results.generatedAt, defects }, null, 2))

  console.log('\n[runner] summary:')
  for (const [name, s] of Object.entries(results.shots)) {
    const caps = s.checks ? Object.entries(s.checks).map(([k, c]) =>
      `${k}=${c.pass === true ? 'PASS' : c.pass === false ? 'FAIL' : c.unavailable ? 'n/a' : '?'}`).join(' ') : ''
    console.log(`  ${name.padEnd(18)} ${s.pass ? 'PASS' : 'FAIL'}  ${caps}`)
  }
  console.log(`\n  shots ${results.summary.shotsPassed}/${results.summary.shotsTotal} passed, ${results.summary.defects} defects`)
  console.log('  evidence ->', path.join(OUT, 'framecheck_results.json'),
    'and', path.join(OUT, 'defects.json'))
}

// A shot passes when every runnable check passes. unavailable is a recording,
// not a failure.
function allChecksPass(entry) {
  const checks = { ...(entry.checks || {}), audio: entry.audio,
    ...(entry.scene || {}) }
  for (const c of Object.values(checks)) {
    if (!c || c.pass === null || c.pass === undefined) {
      if (c && c.unavailable) continue
      if (c && c.pass === null && c.applicable === false) continue
      return false
    }
    if (c.pass === false) return false
  }
  if (entry.capture && entry.capture.ok === false) return false
  if (entry.capture === null || entry.capture === undefined) return false
  return true
}

function buildDefects(results) {
  const defects = []
  for (const [name, s] of Object.entries(results.shots)) {
    const base = s.kind === 'interior' ? 'QA-2OA-I' : 'QA-2OA-E'
    if (s.capture === null || s.capture === undefined) {
      defects.push({
        id: `${base}-${name}-capture`,
        shot: name, check: 'capture', severity: 'high',
        measured: 'no capture response',
        threshold: 'capture must POST a frame',
        description: `${name}: the capture path produced no frame at all.`,
      })
    } else if (s.capture.ok === false) {
      defects.push({
        id: `${base}-${name}-capture`,
        shot: name, check: 'capture', severity: 'high',
        measured: JSON.stringify(s.capture),
        threshold: 'capture must return ok:true and a PNG > 1000 chars',
        description: `${name}: the capture sink rejected the frame` +
          (s.capture.error ? ` (${s.capture.error})` : '') + '.',
      })
    }
    const checks = { ...(s.checks || {}), audio: s.audio,
      ...(s.scene || {}) }
    for (const [check, c] of Object.entries(checks)) {
      if (!c || c.pass !== false) continue
      defects.push({
        id: `${base}-${name}-${check}`,
        shot: name, check, severity: 'medium',
        measured: c.measured,
        threshold: c.threshold,
        description: `${name} failed ${check}: measured ` +
          JSON.stringify(c.measured) + ' vs threshold ' + c.threshold,
      })
    }
    // A missing asset is a count, not a recollection: anything the page
    // asked for that answered 4xx/5xx during the shot is a defect.
    if (s.failedRequests && s.failedRequests.length) {
      defects.push({
        id: `${base}-${name}-network`,
        shot: name, check: 'network', severity: 'medium',
        measured: s.failedRequests.join('; '),
        threshold: 'zero failed asset requests during the shot',
        description: `${name}: ${s.failedRequests.length} failed network ` +
          `request(s): ${s.failedRequests.join('; ')}`,
      })
    }
  }
  return defects
}

main().catch((e) => {
  console.error('[runner] fatal:', e)
  process.exit(1)
})
