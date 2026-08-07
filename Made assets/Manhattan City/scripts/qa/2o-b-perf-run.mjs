// 2o-b-perf-run.mjs — Phase 2O-B street-life CPU attribution runner.
//
// Zero-dependency Node script (Node >= 22; uses the global WebSocket and
// fetch). Boots the Vite dev server on 5176 and Chrome headless on CDP 9226
// (this worker's assigned ports), drives the real app to the times_square
// street-level shot, fills the street the way bench-run.mjs does (90 sim
// ticks), then calls src/perfbreak.js for the per-subsystem breakdown of the
// disputed street-life CPU claim.
//
//   node scripts/qa/2o-b-perf-run.mjs
//
// Output: docs/qa/evidence/2o-b-perf/street_life_breakdown.json

import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const APP = path.join(REPO, 'apps', 'manhattan-threejs')
const OUT_DIR = path.join(REPO, 'docs', 'qa', 'evidence', '2o-b-perf')
const VITE_PORT = 5176
const CDP_PORT = 9226
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function killTree(child) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true })
    } else {
      child.kill()
    }
  } catch {
    try { child.kill() } catch {}
  }
}

async function portFree(p) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port: p, host: '127.0.0.1' })
    const done = (v) => { s.destroy(); resolve(v) }
    s.once('connect', () => done(false))
    s.once('error', () => done(true))
    s.setTimeout(300, () => done(true))
  })
}

async function waitFor(what, fn, timeoutMs, intervalMs = 250) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`timeout waiting for ${what}`)
    }
    await sleep(intervalMs)
  }
}

async function startVite() {
  if (!(await portFree(VITE_PORT))) {
    throw new Error(`vite port ${VITE_PORT} is taken`)
  }
  const child = spawn('cmd.exe',
    ['/c', 'npm', 'run', 'dev', '--', '--port', String(VITE_PORT),
      '--strictPort', '--host', '127.0.0.1'],
    { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  const url = `http://127.0.0.1:${VITE_PORT}/`
  await waitFor(`vite on :${VITE_PORT}`, async () => {
    const r = await fetch(url).catch(() => null)
    return r && r.ok
  }, 60000, 400)
  return { child, url, log: () => log }
}

async function startChrome() {
  if (!(await portFree(CDP_PORT))) {
    throw new Error(`CDP port ${CDP_PORT} is taken`)
  }
  const dir = path.join(os.tmpdir(), 'opencode', `perf2ob-${process.pid}`)
  fs.mkdirSync(dir, { recursive: true })
  const child = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true })
  let wsUrl = null
  await waitFor('chrome CDP endpoint', async () => {
    const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      .then((r) => r.json()).catch(() => null)
    if (!list) return null
    const page = list.find((t) => t.type === 'page')
    if (!page) return null
    wsUrl = page.webSocketDebuggerUrl
    return wsUrl
  }, 30000, 300)
  return { child, wsUrl, dir }
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`CDP ${msg.error.message}`))
        else resolve(msg.result)
      }
    })
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    return new Cdp(ws)
  }

  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  async evaluate(expression, { returns = true } = {}) {
    const wrapped = returns
      ? `(async () => { return (${expression}) })()`
      : `(async () => { ${expression} })()`
    const r = await this.send('Runtime.evaluate', {
      expression: wrapped, awaitPromise: true, returnByValue: true,
    })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails
      throw new Error('page exception: ' +
        (d.exception && d.exception.description
          ? d.exception.description : JSON.stringify(d)))
    }
    return r.result.value
  }
}

const isMain = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  main().catch((err) => {
    console.error('2o-b-perf-run failed:', err)
    process.exitCode = 1
  })
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const run = {
    startedAt: new Date().toISOString(),
    claim: 'HANDOFF §1 "street-life CPU ~0.4 ms/frame" (RTX 5070) vs 0.8 ms ' +
      'measured by Phase 2O-A at the real Times Square',
    machine: {
      platform: process.platform,
      node: process.version,
      chrome: 'headless=new, SwiftShader software GL',
      note: 'Software rendering: cpuMs is main-thread JS time only. ' +
        'Same harness pattern as bench-run.mjs, worker ports 5176/9226.',
    },
  }

  let vite = null
  let chrome = null
  let cdp = null
  try {
    vite = await startVite()
    run.vite = { url: vite.url }
    chrome = await startChrome()
    run.cdpPort = CDP_PORT
    cdp = await Cdp.connect(chrome.wsUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Page.navigate', { url: vite.url })

    await waitFor('app boot (window.__manhattan + __capture)', async () => {
      return cdp.evaluate(`
        !!window.__manhattan && !!window.__manhattan.renderer &&
        !!window.__capture && !!window.__capture.SHOTS &&
        document.getElementById('boot').classList.contains('gone')`)
    }, 360000, 500).catch((err) => {
      throw new Error(`${err.message}\nvite log:\n${vite.log()}`)
    })

    await cdp.evaluate(`window.__perfbreak = await import('/src/perfbreak.js')`,
      { returns: false })
    // pin the drawing buffer like bench-run.mjs does
    await cdp.evaluate(`(() => {
      const m = window.__manhattan
      m.renderer.setSize(1280, 720, false)
      m.camera.aspect = 1280 / 720
      m.camera.updateProjectionMatrix()
      return { w: m.renderer.domElement.width, h: m.renderer.domElement.height }
    })()`)

    // the disputed shot: times_square street level, exactly as the bench
    // places it, then fill the street with 90 sim ticks like bench-run.mjs
    await cdp.evaluate(`(() => {
      const m = window.__manhattan
      const cap = window.__capture
      cap.place(cap.SHOTS.times_square)
      return cap.settle()
    })()`)
    await cdp.evaluate(`(() => {
      const m = window.__manhattan
      m.props.update(m.camera, true)
      for (let i = 0; i < 90; i++) {
        m.traffic.update(1 / 30, m.camera)
        m.crowd.update(1 / 30, m.camera)
        m.weather.update(1 / 30, m.camera)
      }
      return true
    })()`)

    run.streetLife = await cdp.evaluate(
      `window.__perfbreak.streetLifeSamples(20)`)
    run.block = await cdp.evaluate(
      `window.__perfbreak.streetLifeBreakdown({ n: 60, forceProps: true, includeAudio: true })`)
    run.mainLoop = await cdp.evaluate(
      `window.__perfbreak.streetLifeBreakdown({ n: 60, forceProps: false, includeAudio: true })`)
    run.traffic = await cdp.evaluate(
      `window.__perfbreak.trafficInternals(60)`)
    run.endedAt = new Date().toISOString()
  } finally {
    if (cdp && cdp.ws && cdp.ws.readyState === WebSocket.OPEN) {
      try { cdp.ws.close() } catch {}
    }
    if (chrome) killTree(chrome.child)
    if (vite) killTree(vite.child)
  }

  const outFile = path.join(OUT_DIR, 'street_life_breakdown.json')
  fs.writeFileSync(outFile, JSON.stringify(run, null, 2))
  console.log('\nwrote', path.relative(REPO, outFile))
  const table = (r) => {
    const total = r.subs.reduce((a, s) => a + s.medianMs, 0)
    console.log(`  ${r.mode}`)
    for (const s of r.subs) {
      console.log(`    ${s.name.padEnd(10)} ${String(s.medianMs).padStart(7)} ms ` +
        `(p95 ${String(s.p95Ms).padStart(7)})  ${(100 * s.medianMs / Math.max(1e-9, total)).toFixed(0)}% of breakdown sum`)
    }
    console.log(`    block whole  ${String(r.whole.medianMs).padStart(7)} ms ` +
      `(p95 ${r.whole.p95Ms})`)
    console.log(`    counts: ${r.counts.vehicles} vehicles, ${r.counts.people} people, ` +
      `${r.counts.propsDrawn} props`)
  }
  console.log('\nstreetLifeSamples median:', run.streetLife.medianMs, 'ms')
  table(run.block)
  table(run.mainLoop)
  console.log('  traffic steady median:', run.traffic.steady.medianMs, 'ms | ' +
    'drained median:', run.traffic.drained.medianMs, 'ms (spawn top-up worst case)')
}
