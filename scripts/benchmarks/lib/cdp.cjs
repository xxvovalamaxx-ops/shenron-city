// cdp.cjs — minimal Chrome DevTools Protocol client (zero dependencies).
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
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
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

async function key(page, code, down) {
  await page.send('Input.dispatchKeyEvent', {
    type: down ? 'keyDown' : 'keyUp',
    code,
    windowsVirtualKeyCode: code === 'KeyW' ? 87 : code === 'KeyS' ? 83 : code === 'ShiftLeft' ? 16 : 0,
    nativeVirtualKeyCode: code === 'KeyW' ? 87 : code === 'KeyS' ? 83 : code === 'ShiftLeft' ? 16 : 0,
  })
}

module.exports = {
  launchChrome, openTab, navigate, evaluate, screenshot, key, waitFor, sleep,
}
