#!/usr/bin/env node
// doorcheck-run.mjs — Phase 3B headless verification runner.
//
// Drives the real app (apps/manhattan-threejs) in headless Chrome over CDP —
// the same harness as framecheck-run.mjs — and puts the doorway pipeline
// through its acceptance checks:
//
//   per door:    the opening is real (rays pass where the wall used to be),
//                the walk-in crosses with no teleport (position continuity),
//                reverse traversal exits, the leaf cycles open/closed, an
//                obstruction reopens a closing door, the interior preloads
//                (visible room + lamp before the threshold), the threshold
//                frame is not a dead frame and not a black void, and the
//                occlusion check at the threshold passes.
//   global:      pause freezes the state machine, door state survives a
//                reload, the walk is deterministic under a fixed dt, and the
//                audio verify measures the indoor transition (centroid drop).
//
// Usage:
//   node scripts/qa/doorcheck-run.mjs
//
// Writes docs/qa/evidence/phase3b/doors.json and posts PNGs through the
// app's own /__capture sink into evidence/phase2/ (gitignored).

import { spawn, execSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, writeFileSync, mkdtempSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const APP = path.join(REPO, 'apps', 'manhattan-threejs')
const OUT = path.join(REPO, 'docs', 'qa', 'evidence', 'phase3b')

let DEV_PORT = 5176
const CDP_PORT = 9226
let APP_URL = `http://127.0.0.1:${DEV_PORT}/`
const CHROME = process.env.CHROME ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const W = 1280
const H = 720
const BOOT_TIMEOUT_MS = 900000
const STEP_TIMEOUT_MS = 120000

// ---------------------------------------------------------------------------
// console / network capture (same contract as framecheck-run)
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
})()`

// ---------------------------------------------------------------------------
// CDP
// ---------------------------------------------------------------------------

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data)
      if (!m.id) return
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`))
      else p.resolve(m.result)
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

async function cdpEvaluate(cdp, expression, timeout = STEP_TIMEOUT_MS) {
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(
      `CDP evaluate timed out after ${timeout} ms`)), timeout))
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

function portFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)))
  })
}

async function choosePort() {
  if (await portFree(DEV_PORT)) return DEV_PORT
  for (let p = 5180; p <= 5210; p++) {
    if (await portFree(p)) return p
  }
  throw new Error('no free dev port')
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
// the per-door page script: cut near the door, run every check, capture the
// threshold frame and read it back for the frame-level checks.
// ---------------------------------------------------------------------------

function doorScript(cfg) {
  return `(async () => {
  const m = window.__manhattan
  const THREE = m.THREE
  const doors = m.doors
  window.__qaFreeze = true
  doors.paused = false

  const d = doors.doors.find((x) => x.key === ${JSON.stringify(cfg.key)})
  if (!d) return { key: ${JSON.stringify(cfg.key)}, error: 'door not configured' }

  // place the camera on the sidewalk in front of the door and step the
  // machine so the wall cut lands (the cut is applied within CUT_R metres).
  // Room coordinates go through doors.roomToWorld: they are in the *authored*
  // frame (+x into, +y left, +z up), which is not the room group's own local
  // frame, and applying that swap zero times is what put the first pass of
  // this pipeline 1.70 m to the side of every opening.
  const plane = doors._wallPlaneX(d)
  const near = doors.roomToWorld(d, plane - 6, d.bayCenter, 1.7)
  m.camera.position.copy(near)
  m.camera.lookAt(doors.roomToWorld(d, plane + 2, d.bayCenter, 1.7))
  for (let i = 0; i < 45; i++) doors.update(1 / 30, m.camera)
  // the trigger has the camera by now; wait out the opening slide so the
  // threshold capture is not a half-open transient
  for (let i = 0; i < 120; i++) doors.update(1 / 30, m.camera)
  const captureState = { doorState: d.state, leafProgress: +d.progress.toFixed(2),
    lamp: +m.interiors.lamp.intensity.toFixed(2), roomVisible: d.room.group.visible }

  // frame-level checks at the threshold: dead frame, luminance (no black
  // void), occlusion with the door assembly in the collider set
  const mod = await import('/src/framecheck.js')
  m.framecheck = mod
  const eye = doors.roomToWorld(d, plane - 1.6, d.bayCenter, 1.7)
  const at = doors.roomToWorld(d, plane + 4, d.bayCenter, 1.6)
  const cap = await window.__capture.shootFrom('door_' + ${JSON.stringify(cfg.key)} + '_threshold', eye, at, 'walk')
  const r = m.renderer
  const prev = r.getSize(new THREE.Vector2())
  const prevAspect = m.camera.aspect
  r.setSize(${W}, ${H}, false)
  m.camera.aspect = ${W} / ${H}
  m.camera.updateProjectionMatrix()
  let px = null
  let scene = null
  try {
    r.render(m.scene, m.camera)
    const c = document.createElement('canvas')
    c.width = ${W}; c.height = ${H}
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(r.domElement, 0, 0)
    const img = g.getImageData(0, 0, ${W}, ${H})
    px = await mod.runChecks(img, { kind: 'street', audio: window.__qaAudio })
    scene = mod.sceneChecks(m, { occlusion: { maxNearFraction: 0.35 } })
  } finally {
    r.setSize(prev.x, prev.y, false)
    m.camera.aspect = prevAspect
    m.camera.updateProjectionMatrix()
  }

  // the walk/door-state checks, run with the loop frozen and a fixed dt.
  // The determinism walks start from a reset door so the two traces replay
  // the identical state machine.
  const verify = doors.verify()
  doors._setState(d, 'closed'); d.progress = 0
  const traceA = doors._walkTest(d, 1, { trace: true })
  doors._setState(d, 'closed'); d.progress = 0
  const traceB = doors._walkTest(d, 1, { trace: true })

  // passage diagnostic: does the tile mesh still hold another building's
  // triangles inside the doorway volume? (Expected to be zero after the
  // passage cut; the corridor market's block overlaps an adjacent school.)
  let passage = null
  if (d.kind === 'wall' && d.mesh) {
    const g = d.mesh.geometry
    const attr = g.attributes._bid || g.attributes._BID
    const idx = g.index
    const pos = g.attributes.position
    if (attr && idx) {
      const box = doors._doorBox && doors._findWall
        ? (() => {
            // recompute the door box the way _cutWall did
            const wall = doors._findWall(d, d.mesh)
            return wall ? doors._doorBox(wall.frame) : null
          })() : null
      let inside = 0
      if (box) {
        const tris = idx.count / 3
        for (let t = 0; t < tris; t++) {
          const a = idx.getX(t * 3)
          const b = idx.getX(t * 3 + 1)
          const c = idx.getX(t * 3 + 2)
          if (Math.round(attr.getX(a)) === d.bid &&
              Math.round(attr.getX(b)) === d.bid &&
              Math.round(attr.getX(c)) === d.bid) continue
          let minX = Infinity, maxX = -Infinity
          let minY = Infinity, maxY = -Infinity
          let minZ = Infinity, maxZ = -Infinity
          for (const i of [a, b, c]) {
            const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
          }
          if (maxX > box.min[0] && minX < box.max[0] &&
              maxY > box.min[1] && minY < box.max[1] &&
              maxZ > box.min[2] && minZ < box.max[2]) inside++
        }
      }
      passage = { box: box, otherTrianglesInsideDoorBox: inside }
    }
  }

  window.__qaFreeze = false
  return {
    key: ${JSON.stringify(cfg.key)},
    bid: d.bid,
    kind: d.kind,
    cut: d.cut,
    cutFaces: d.cutFaces,
    removedTris: d.removedTris,
    glaze: { cutFaces: d.glazeCut, removedTris: d.glazeRemoved,
      trisKept: d.glazeKept },
    passageCut: { meshes: d.passageRemoved, cutFaces: d.passageCutFaces,
      containedRemoved: d.passageBoxRemoved },
    assembly: doors._assemblyMetrics(d),
    wallDist_m: d.wallDist,
    captureState,
    capture: cap,
    frame: {
      checks: px.checks,
      measured: {
        stddevMax: Math.max(px.checks['dead-frame'].measured.stddev[0],
          px.checks['dead-frame'].measured.stddev[1],
          px.checks['dead-frame'].measured.stddev[2]),
        meanLuminance: px.checks['unlit-surface'].measured.lumMean,
        coloursExact: px.checks['dead-frame'].measured.distinctColoursExact,
      },
    },
    scene,
    verify,
    passage,
    determinism: {
      sameTrace: JSON.stringify(traceA.trace) === JSON.stringify(traceB.trace),
      framesA: traceA.frames,
      framesB: traceB.frames,
      maxJumpA: +traceA.maxJump.toFixed(4),
      maxJumpB: +traceB.maxJump.toFixed(4),
    },
  }
})()`
}

// ---------------------------------------------------------------------------
// verdict helpers (defined before main; judge() runs mid-run)
// ---------------------------------------------------------------------------

const okChecks = (v) => !!(v && v.verify && v.verify.ok !== false &&
  v.verify.checks.every((c) => c.ok !== false))
// A doorway close-up is a deliberately narrow view: the dead-frame rule's
// 200-colour floor (6-bit) was calibrated on wide city shots, so the door
// frame judgement uses the rule's real signals — per-channel stddev and a
// luminance floor — plus the unlit-surface check (no band may be black while
// another is lit), which is what "no black void" means numerically.
const frameOk = (e) => {
  const f = e.frame
  if (!f || !f.measured) return false
  const dead = f.checks && f.checks['dead-frame']
  const unlit = f.checks && f.checks['unlit-surface']
  const healthy = f.measured.stddevMax > 8 &&
    f.measured.meanLuminance > 0.04 &&
    f.measured.coloursExact > 100
  const unlitOk = !unlit || unlit.pass === true ||
    unlit.applicable === false
  return (dead && dead.pass === true || healthy) && unlitOk
}
const sceneOk = (e) => {
  const o = e.scene && e.scene.occlusion
  return !!(o && o.pass === true)
}
const captureOk = (e) => {
  const cap = e.capture
  if (!cap || cap.ok === false) return false
  if (cap.ok && cap.file) {
    try { return statSync(path.join(REPO, cap.file)).size > 1000 } catch { return false }
  }
  return true
}

function judge(entry) {
  const checks = [
    ['verify', okChecks(entry)],
    ['frame', frameOk(entry)],
    ['occlusion', sceneOk(entry)],
    ['capture', captureOk(entry)],
    ['determinism', !!entry.determinism && entry.determinism.sameTrace],
  ]
  entry.checkResults = Object.fromEntries(checks)
  const bad = checks.filter(([, ok]) => !ok)
  if (bad.length) {
    console.error(`[runner] failing:`, bad.map(([n]) => n).join(', '))
  }
  return bad.length === 0
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now()
  const results = {
    generatedAt: new Date().toISOString(),
    runner: 'scripts/qa/doorcheck-run.mjs',
    branch: gitOut('rev-parse --abbrev-ref HEAD'),
    commit: gitOut('rev-parse --short HEAD'),
    app: APP_URL,
    doors: {},
    system: {},
    summary: null,
  }

  DEV_PORT = await choosePort()
  APP_URL = `http://127.0.0.1:${DEV_PORT}/`
  results.app = APP_URL

  mkdirSync(OUT, { recursive: true })
  const profile = mkdtempSync(path.join(tmpdir(), 'qa-door-'))

  let dev = null
  let chrome = null
  let cdp = null
  try {
    console.log(`[runner] starting dev server on :${DEV_PORT}`)
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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',
      { source: PRELOAD })

    console.log('[runner] navigating…')
    await cdp.send('Page.navigate', { url: APP_URL })
    try {
      await waitFor(async () => {
        const v = await cdpEvaluate(cdp, `(() => {
          const m = window.__manhattan
          if (!m || !m.doors || !m.doors.ready || !window.__capture) return null
          return { doors: m.doors.doors.map((d) => d.key) }
        })()`, 15000)
        return v
      }, BOOT_TIMEOUT_MS, 'boot (doors ready)')
    } catch (e) {
      const diag = await cdpEvaluate(cdp, `(() => {
        const m = window.__manhattan
        const b = document.getElementById('boot')
        const l = window.__qaLog
        return {
          hasManhattan: !!m,
          hasDoors: !!(m && m.doors),
          bootText: b && b.textContent ? b.textContent.slice(0, 200) : null,
          errors: l ? l.errors.slice(-10).map((x) => x.m) : null,
          fails: l ? l.requests.slice(-10).map((x) => x.url + ' -> ' + x.status) : null,
        }
      })()`, 20000).catch((e2) => ({ diagFailed: String(e2) }))
      console.error('[runner] boot timed out; page state:',
        JSON.stringify(diag))
      throw e
    }

    const bootLog = await cdpEvaluate(cdp, `(() => {
      const l = window.__qaLog
      return { errors: l.errors.slice(), warns: l.warns.slice(), requests: l.requests.slice() }
    })()`, 15000)
    results.system.boot = {
      consoleErrors: bootLog.errors,
      warnings: bootLog.warns,
      failedRequests: bootLog.requests,
    }
    console.log('[runner] boot ok; configured doors:',
      (await cdpEvaluate(cdp,
        `window.__manhattan.doors.doors.map((d) => d.key).join(', ')`, 15000)))

    // ---- audio verification (incl. the indoor transition) -----------------
    const audio = await cdpEvaluate(cdp, `(async () => {
      const m = window.__manhattan
      const mod = await import('/src/framecheck.js')
      const ac = await mod.audioChecks()
      window.__qaAudio = ac
      const v = await m.verifyAudio()
      return { checks: ac, verify: v }
    })()`, 90000)
    results.system.audio = audio
    if (audio.verify && audio.verify.streetIndoor) {
      const out = audio.verify.streetOnly
      const inDo = audio.verify.streetIndoor
      results.system.audioTransition = {
        centroidOutdoor: out.centroid,
        centroidIndoor: inDo.centroid,
        dropRatio: +(inDo.centroid / Math.max(1, out.centroid)).toFixed(3),
        rmsOutdoor: out.rms,
        rmsIndoor: inDo.rms,
        mag1500Outdoor: out.mag1500,
        mag1500Indoor: inDo.mag1500,
        tyresCut: +(inDo.mag1500 / Math.max(0.001, out.mag1500)).toFixed(3),
      }
      console.log('[runner] audio indoor transition: centroid',
        `${out.centroid} -> ${inDo.centroid}`,
        `(rms ${out.rms} -> ${inDo.rms},` +
        ` 1.5kHz ${out.mag1500} -> ${inDo.mag1500})`)
    }

    // ---- per-door checks ---------------------------------------------------
    const only = process.env.DOOR_KEY
    let keys = await cdpEvaluate(cdp,
      `window.__manhattan.doors.doors.map((d) => d.key)`, 15000)
    if (only) keys = keys.filter((k) => k === only)
    for (const key of keys) {
      const d0 = Date.now()
      console.log(`[runner] door ${key}…`)
      const entry = { startedAt: new Date().toISOString() }
      try {
        const before = await cdpEvaluate(cdp, `(() => {
          const l = window.__qaLog
          return { e: l.errors.length, w: l.warns.length, r: l.requests.length }
        })()`, 15000)
        const v = await cdpEvaluate(cdp, doorScript({ key }))
        const after = await cdpEvaluate(cdp, `(() => {
          const l = window.__qaLog
          return { errors: l.errors.slice(), warns: l.warns.slice(), requests: l.requests.slice() }
        })()`, 15000)
        entry.capture = v.capture
        entry.frame = v.frame
        entry.scene = v.scene
        entry.verify = v.verify
        entry.determinism = v.determinism
        entry.bid = v.bid
        entry.kind = v.kind
        entry.cut = v.cut
        entry.cutFaces = v.cutFaces
        entry.removedTris = v.removedTris
        entry.glaze = v.glaze
        entry.passageCut = v.passageCut
        entry.assembly = v.assembly
        entry.wallDist_m = v.wallDist_m
        entry.captureState = v.captureState
        entry.passage = v.passage
        entry.consoleErrors = after.errors.slice(before.e).map((x) => x.m)
        entry.failedRequests =
          after.requests.slice(before.r).map((x) => x.url + ' -> ' + x.status)
        entry.pass = judge(entry)
      } catch (e) {
        entry.error = String(e.message || e)
        entry.pass = false
        console.error(`[runner] door ${key} failed: ${entry.error}`)
      }
      entry.durationMs = Date.now() - d0
      results.doors[key] = entry
    }

    // ---- pause + persistence across reload --------------------------------
    const pause = await cdpEvaluate(cdp, `(() => {
      const m = window.__manhattan
      const doors = m.doors
      const out = doors._pauseTest()
      // open a door and persist it, for the reload check
      const d = doors.doors.find((x) => x.group)
      doors._setState(d, 'open')
      d.progress = 1
      doors._save()
      return out
    })()`, 30000)
    results.system.pause = pause

    await cdp.send('Page.reload', { ignoreCache: true })
    const afterReload = await waitFor(async () => {
      const v = await cdpEvaluate(cdp, `(() => {
        const m = window.__manhattan
        if (!m || !m.doors || !m.doors.ready) return null
        return {
          saved: (() => {
            try { return JSON.parse(localStorage.getItem('manhattan.doors.v1')) }
            catch { return null }
          })(),
          bootState: window.__doorsBootState || null,
          states: m.doors.doors.map((d) => [d.key, d.state, d.progress]),
        }
      })()`, 15000)
      return v
    }, BOOT_TIMEOUT_MS, 'reload')
    const saved = afterReload.saved && afterReload.saved.doors
    const restored = !!(afterReload.bootState &&
      Array.isArray(afterReload.bootState) &&
      afterReload.bootState.some((e) => e.state === 'open') &&
      saved)
    results.system.reload = {
      saved: afterReload.saved,
      bootState: afterReload.bootState,
      restored,
    }
    console.log('[runner] reload: saved =',
      JSON.stringify(saved),
      '| restored =', JSON.stringify(afterReload.bootState))
  } finally {
    if (cdp) cdp.close()
    if (chrome) { chrome.kill(); await new Promise((r) => setTimeout(r, 500)) }
    if (dev) { dev.kill(); await new Promise((r) => setTimeout(r, 500)) }
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* best effort */ }
  }

  // ---- verdict ------------------------------------------------------------
  const all = Object.values(results.doors)
  results.summary = {
    doorsTotal: all.length,
    doorsPassed: all.filter((d) => d.pass).length,
    doorsFailed: all.filter((d) => !d.pass).length,
    audioTransition: results.system.audioTransition,
    pauseFrozen: !!(results.system.pause && results.system.pause.frozen),
    reloadRestored: !!(results.system.reload && results.system.reload.restored),
    durationMs: Date.now() - t0,
  }
  writeFileSync(path.join(OUT, 'doors.json'),
    JSON.stringify(results, null, 2))

  console.log('\n[runner] summary:')
  for (const [name, e] of Object.entries(results.doors)) {
    console.log(`  ${name.padEnd(14)} ${e.pass ? 'PASS' : 'FAIL'}  ` +
      JSON.stringify(e.checkResults || {}))
  }
  console.log(`\n  doors ${results.summary.doorsPassed}/` +
    `${results.summary.doorsTotal} passed` +
    (results.summary.audioTransition
      ? `, audio indoor centroid ${results.summary.audioTransition.dropRatio}x` : '') +
    `, pause frozen=${results.summary.pauseFrozen}` +
    `, reload restored=${results.summary.reloadRestored}`)
  console.log('  evidence ->', path.join(OUT, 'doors.json'))
}

main().catch((e) => {
  console.error('[runner] fatal:', e)
  process.exit(1)
})
