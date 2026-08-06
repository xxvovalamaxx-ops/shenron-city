// cdp.js — minimal Chrome DevTools Protocol client (zero dependencies).
// Node >= 22 provides global WebSocket; this repo targets Node ^20.19 || >=22.12.

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

/** Launch Chrome headless with a remote debugging port. Returns cleanup fn. */
async function launchChrome({ chromePath, port = 9222, userDataDir, windowSize = '1280,720' }) {
  const profile = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'sc-bench-'))
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-features=Translate,OptimizationHints',
    '--hide-scrollbars',
    `--window-size=${windowSize}`,
    '--force-device-scale-factor=1',
    '--mute-audio',
    'about:blank',
  ]
  const child = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stderr.on('data', () => {})
  let wsUrl = null
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const info = await fetchJson(`http://127.0.0.1:${port}/json/version`)
      wsUrl = info.webSocketDebuggerUrl
    } catch { await sleep(250) }
  }
  if (!wsUrl) {
    child.kill()
    throw new Error('Chrome did not expose a debugging endpoint')
  }
  return {
    wsUrl,
    port,
    profile,
    close: () => { try { child.kill() } catch {} },
  }
}

/** Raw JSON-RPC over a WebSocket, request/response correlated by id. */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method) {
        this.events.push(msg)
      }
    }
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('ws connect failed'))
    })
    return new Cdp(ws)
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject: (e) => reject(new Error(`${method}: ${e.message}`)),
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close() { try { this.ws.close() } catch {} }
}

/**
 * Classify protocol events into the Phase 2O-A error buckets:
 * console errors, uncaught exceptions, console warnings, failed network loads.
 */
function classifyErrorEvents(events) {
  const out = { consoleErrors: 0, exceptions: 0, consoleWarnings: 0, networkFailures: 0, samples: [] }
  for (const e of events) {
    if (e.method === 'Runtime.exceptionThrown') {
      out.exceptions++
      out.samples.push('exception: ' + String(
        e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text).slice(0, 160))
    } else if (e.method === 'Runtime.consoleAPICalled') {
      const t = e.params.type
      if (t === 'error') { out.consoleErrors++; out.samples.push('console.error') }
      else if (t === 'warning') out.consoleWarnings++
    } else if (e.method === 'Log.entryAdded') {
      const l = e.params.entry.level
      if (l === 'error') { out.consoleErrors++; out.samples.push('log: ' + String(e.params.entry.text).slice(0, 160)) }
    } else if (e.method === 'Network.loadingFailed') {
      out.networkFailures++
      out.samples.push('net fail: ' + String(e.params.errorText).slice(0, 160))
    }
  }
  return out
}

/** CPU-side counters from the renderer process, as per-second rates over the window. */
async function cpuMetricsDelta(page, before, after, seconds) {
  const rate = (n, d) => (n && d ? +(n / d).toFixed(2) : null)
  const b = Object.fromEntries(before.map((m) => [m.name, m.value]))
  const a = Object.fromEntries(after.map((m) => [m.name, m.value]))
  return {
    taskMsPerSec: rate(a.TaskDuration - b.TaskDuration, seconds),
    scriptMsPerSec: rate(a.ScriptDuration - b.ScriptDuration, seconds),
    layoutMsPerSec: rate(a.LayoutDuration - b.LayoutDuration, seconds),
    recalcStyleMsPerSec: rate(a.RecalcStyleDuration - b.RecalcStyleDuration, seconds),
    layoutsPerSec: rate(a.LayoutCount - b.LayoutCount, seconds),
    recalcStylesPerSec: rate(a.RecalcStyleCount - b.RecalcStyleCount, seconds),
    nodesDelta: Math.round(a.Nodes - b.Nodes),
    heapDeltaMB: a.JSHeapUsedSize !== undefined && b.JSHeapUsedSize !== undefined
      ? +((a.JSHeapUsedSize - b.JSHeapUsedSize) / 1048576).toFixed(2) : null,
  }
}

/** Create a tab, connect directly to its page target. */
async function openTab(browser, { url, width = 1280, height = 720 }) {
  const bws = await Cdp.connect(browser.wsUrl)
  const { targetId } = await bws.send('Target.createTarget', { url: 'about:blank' })
  bws.close()
  const info = await fetchJson(`http://127.0.0.1:${browser.port}/json/list`)
  const target = info.find((t) => t.id === targetId)
  const page = await Cdp.connect(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Page.setLifecycleEventsEnabled', { enabled: true })
  await page.send('Network.enable')
  await page.send('Log.enable')
  await page.send('Performance.enable')
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  })
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  return { page, targetId }
}

async function navigate(page, url, { timeoutMs = 60000 } = {}) {
  await page.send('Page.navigate', { url })
  // wait for load event or timeout, whichever comes first
  await waitFor(page, timeoutMs, async () => {
    const r = await page.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    })
    return r.result.value === 'complete'
  })
  await sleep(200)
  try {
    await page.send('Page.captureScreenshot', {}) // ensure compositor is warm
  } catch { /* screenshot during load is not fatal */ }
}

async function waitFor(page, timeoutMs, predicate, { pollMs = 250 } = {}) {
  const t0 = Date.now()
  for (;;) {
    try {
      if (await predicate()) return
    } catch { /* not ready yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timeout')
    await sleep(pollMs)
  }
}

/** Evaluate an async expression in the page, returning by value. */
async function evaluate(page, expression) {
  const r = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (r.exceptionDetails) {
    throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 500))
  }
  return r.result.value
}

async function screenshot(page) {
  const r = await page.send('Page.captureScreenshot', { format: 'png' })
  return Buffer.from(r.data, 'base64')
}

const VK = { KeyW: 87, KeyS: 83, KeyA: 65, KeyD: 68, ShiftLeft: 16, KeyC: 67, KeyE: 69 }

async function key(page, code, down) {
  await page.send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp',
    code,
    windowsVirtualKeyCode: VK[code] || 0,
    nativeVirtualKeyCode: VK[code] || 0,
  })
}

module.exports = {
  launchChrome, openTab, navigate, evaluate, screenshot, key, waitFor, sleep,
  classifyErrorEvents, cpuMetricsDelta,
}
