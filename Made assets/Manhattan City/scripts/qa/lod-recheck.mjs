// lod-recheck.mjs -- Phase 2O-B focused LOD re-measurement.
//
// Zero-dependency Node script (Node >= 22; global WebSocket + fetch). Boots
// the real app (Vite + Chrome headless over CDP) and re-measures the LOD
// claim against the real L2 glb tiles.
//
//   node scripts/qa/lod-recheck.mjs --label before
//   node scripts/qa/lod-recheck.mjs --label after
//
// Each run appends one object to
// docs/qa/evidence/2o-b-lod/lod_recheck.json with:
//   harness    bench.measureLodL2({tiles:15, perTile:26}) -- the 2O-A call
//   both       inline measurement, every candidate tile, perTile=26, each
//              sample raycast on the tile L2 glb AND its L0 full-detail glb:
//                legacy     err = hitY - h            (pre-fix convention)
//                corrected  err = hitY - (LAND_LEVEL+h) (full-detail datum)
//                delta      err = hitY_L2 - hitY_L0  (L0->L2 swap movement)
//   bid20009   ring-vertex/centroid/interior ray hits on -02_-03_L2.glb and
//              on the L0 full-detail tile manhattan_-02_-03.glb vs LAND_LEVEL+h
//
// Run before the rebuild (old tiles, original harness convention) and again
// after; the before/after table comes from the same two runs.

import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const APP = path.join(REPO, 'apps', 'manhattan-threejs')
const OUT_FILE = path.join(REPO, 'docs', 'qa', 'evidence', '2o-b-lod',
  'lod_recheck.json')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// bid 20009's footprint from the frozen source_data/cache/buildings.pkl
// (ring vertices + polygon centroid); surveyed height h = 3.0.
const B20009 = {
  h: 3.0,
  pts: [
    ['pt0', -1876.4619760671214, -3599.150527800456],
    ['pt1', -1877.1194698532834, -3598.796691000249],
    ['pt2', -1891.6349095825117, -3624.825810600372],
    ['pt3', -1896.869571645992, -3623.366233799814],
    ['pt4', -1897.7462300263435, -3624.6267774004027],
    ['pt5', -1892.342979813118, -3627.612275399936],
  ],
  centroid: [-1887.8873953004772, -3617.0259306751263],
}

function pickFreePort(base) {
  return (async () => {
    for (const p of Array.from({ length: 40 }, (_, i) => base + i)) {
      const busy = await new Promise((resolve) => {
        const s = net.createConnection({ port: p, host: '127.0.0.1' })
        const done = (v) => { s.destroy(); resolve(v) }
        s.once('connect', () => done(true))
        s.once('error', () => done(false))
        s.setTimeout(300, () => done(false))
      })
      if (!busy) return p
    }
    throw new Error(`no free port near ${base}`)
  })()
}

function killTree(child) {
  return new Promise((resolve) => {
    try {
      if (process.platform === 'win32') {
        const k = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'],
          { stdio: 'ignore', windowsHide: true })
        k.once('exit', () => resolve())
        k.once('error', () => resolve())
      } else {
        child.kill()
        resolve()
      }
    } catch {
      try { child.kill() } catch {}
      resolve()
    }
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

async function startVite(port) {
  const child = process.platform === 'win32'
    ? spawn('cmd.exe',
        ['/c', 'npm', 'run', 'dev', '--', '--port', String(port), '--strictPort',
          '--host', '127.0.0.1'],
        { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    : spawn('npm', ['run', 'dev', '--', '--port', String(port), '--strictPort',
        '--host', '127.0.0.1'],
        { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const url = `http://127.0.0.1:${port}/`
  await waitFor(`vite on :${port}`, async () => {
    const r = await fetch(url).catch(() => null)
    return r && r.ok
  }, 60000, 400)
  return { child, url }
}

async function startChrome() {
  const cdpPort = await pickFreePort(9223)
  const dir = path.join(os.tmpdir(), 'opencode', `lodrecheck-${process.pid}`)
  fs.mkdirSync(dir, { recursive: true })
  spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
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
    const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
      .then((r) => r.json()).catch(() => null)
    if (!list) return null
    const page = list.find((t) => t.type === 'page')
    if (!page) return null
    wsUrl = page.webSocketDebuggerUrl
    return wsUrl
  }, 30000, 300)
  return { cdpPort, wsUrl }
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
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => (${expression}))()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      const d = r.exceptionDetails
      throw new Error('page exception: ' +
        (d.exception && d.exception.description ? d.exception.description : JSON.stringify(d)))
    }
    return r.result.value
  }
}

// Inline measurement over every candidate tile, computing the legacy and
// corrected conventions AND the L2-vs-L0 delta from the same ray samples,
// so before/after numbers are method-controlled. Self-contained async IIFE
// (Cdp.evaluate wraps it in `return ( <expr> )`).
const BOTH_SCRIPT = `(async () => {
  const m = window.__manhattan
  const { city, lod, THREE } = m
  const ground = city.meta && city.meta.land_level_m != null
    ? city.meta.land_level_m : 12.0
  const grid = lod.manifest.grid_m || 1400
  const perTile = 26
  const tileOf = new Map()
  for (let i = 0; i < city.count; i++) {
    if (city.isContext(i) || city.height(i) < 3) continue
    const k = \`\${Math.floor(city.x(i) / grid) >= 0 ? '+' : '-'}\${String(Math.abs(Math.floor(city.x(i) / grid))).padStart(2, '0')}_\${Math.floor(city.y(i) / grid) >= 0 ? '+' : '-'}\${String(Math.abs(Math.floor(city.y(i) / grid))).padStart(2, '0')}\`
    if (!tileOf.has(k)) tileOf.set(k, [])
    tileOf.get(k).push(i)
  }
  const tsq = [-1476, -2433]
  const ranked = Object.keys(lod.manifest.L2)
    .filter((k) => (tileOf.get(k) || []).length >= perTile)
    .map((k) => {
      const mm = /^([+-]\\d+)_([+-]\\d+)$/.exec(k)
      const c = [(+mm[1] + 0.5) * grid, (+mm[2] + 0.5) * grid]
      return { k, d: Math.hypot(c[0] - tsq[0], c[1] - tsq[1]) }
    })
    .sort((a, b) => a.d - b.d)
  const ray = new THREE.Raycaster()
  const down = new THREE.Vector3(0, -1, 0)
  const load = (url) => new Promise((resolve) => {
    lod.loader.load(url, (g) => {
      const grp = new THREE.Group()
      grp.add(g.scene)
      m.scene.add(grp)
      grp.updateMatrixWorld(true)
      resolve(grp)
    }, undefined, () => resolve(null))
  })
  const hitY = (group, x, y, h) => {
    ray.set(new THREE.Vector3(x, Math.max(ground, 0) + h + 30, -y), down)
    ray.firstHitOnly = true
    ray.far = 60
    const hit = ray.intersectObjects(group.children, true)[0]
    return hit ? hit.point.y : null
  }
  const legacy = []
  const corrected = []
  const delta = []
  let failed = 0
  let l0failed = 0
  const tiles = []
  const worstLegacy = { err: null }
  const worstCorr = { err: null }
  const worstDelta = { err: null }
  const track = (w, e, k, i, x, y, h, y2, y0) => {
    if (w.err == null || Math.abs(e) > Math.abs(w.err)) {
      w.err = +e.toFixed(4); w.tile = k; w.bid = i
      w.x = +x.toFixed(1); w.y = +y.toFixed(1)
      w.registryH = +h.toFixed(2)
      w.l2HitY = y2 != null ? +y2.toFixed(3) : null
      w.l0HitY = y0 != null ? +y0.toFixed(3) : null
    }
  }
  for (const { k } of ranked) {
    const rec = lod.manifest.L2[k]
    const group = await load('/lod/' + rec.file)
    if (!group) { failed++; continue }
    const l0 = await load('/tiles/manhattan_' + k + '.glb')
    if (!l0) l0failed++
    const want = tileOf.get(k) || []
    const sstep = Math.max(1, Math.floor(want.length / perTile))
    let n = 0
    const tl = { legacy: [], corrected: [], delta: [] }
    for (let q = 0; q < want.length; q += sstep) {
      const i = want[q]
      const x = city.x(i)
      const y = city.y(i)
      const h = city.height(i)
      const y2 = hitY(group, x, y, h)
      if (y2 == null) continue
      const y0 = l0 ? hitY(l0, x, y, h) : null
      const eLegacy = y2 - h
      const eCorr = y2 - (ground + h)
      legacy.push(eLegacy)
      corrected.push(eCorr)
      if (y0 != null) delta.push(y2 - y0)
      n++
      track(worstLegacy, eLegacy, k, i, x, y, h, y2, y0)
      track(worstCorr, eCorr, k, i, x, y, h, y2, y0)
      if (y0 != null) track(worstDelta, y2 - y0, k, i, x, y, h, y2, y0)
      tl.legacy.push(eLegacy)
      tl.corrected.push(eCorr)
      if (y0 != null) tl.delta.push(y2 - y0)
    }
    const tStats = (arr) => {
      if (!arr.length) return null
      const s = [...arr].sort((a, b) => a - b)
      return { samples: s.length,
        max: +s[s.length - 1].toFixed(4), min: +s[0].toFixed(4) }
    }
    tiles.push({ key: k, file: rec.file, buildings: want.length, samples: n,
      legacy: tStats(tl.legacy), corrected: tStats(tl.corrected),
      delta: tStats(tl.delta) })
    m.scene.remove(group)
    group.traverse((o) => { if (o.isMesh) o.geometry.dispose() })
    if (l0) {
      m.scene.remove(l0)
      l0.traverse((o) => { if (o.isMesh) o.geometry.dispose() })
    }
  }
  const stats = (arr) => {
    const s = [...arr].sort((a, b) => a - b)
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
    return { samples: s.length, median: +q(0.5).toFixed(4),
             p90: +q(0.9).toFixed(4), p95: +q(0.95).toFixed(4),
             max: s.length ? +s[s.length - 1].toFixed(4) : null,
             min: s.length ? +s[0].toFixed(4) : null }
  }
  return { ground, tiles, failed, l0failed,
           legacy: { ...stats(legacy), worst: worstLegacy },
           corrected: { ...stats(corrected), worst: worstCorr },
           delta: { ...stats(delta), worst: worstDelta } }
})()`

const CORNER_SCRIPT = `(async () => {
  const m = window.__manhattan
  const pts = ${JSON.stringify(B20009.pts)}
  const cx = ${JSON.stringify(B20009.centroid[0])}
  const cy = ${JSON.stringify(B20009.centroid[1])}
  // strictly interior point of the ring (0.37 m from every edge)
  const interior = [-1884.8073423829999, -3613.3485611220913]
  const h = ${B20009.h}
  const ground = m.city.meta && m.city.meta.land_level_m != null
    ? m.city.meta.land_level_m : 12.0
  const rec = m.lod.manifest.L2['-02_-03']
  if (!rec) throw new Error('no L2 -02_-03 in manifest')
  const load = (url) => new Promise((resolve) => {
    m.lod.loader.load(url, (g) => {
      const grp = new m.THREE.Group()
      grp.add(g.scene)
      m.scene.add(grp)
      grp.updateMatrixWorld(true)
      resolve(grp)
    }, undefined, (err) => resolve(null))
  })
  const group = await load('/lod/' + rec.file)
  if (!group) throw new Error('L2 tile load failed')
  const l0 = await load('/tiles/manhattan_-02_-03.glb')
  const ray = new m.THREE.Raycaster()
  const down = new m.THREE.Vector3(0, -1, 0)
  const cast = (px, py, target) => {
    ray.set(new m.THREE.Vector3(px, ground + h + 30, -py), down)
    ray.firstHitOnly = true
    ray.far = 60
    const hit = ray.intersectObjects(target.children, true)[0]
    if (!hit) return { hitY: null, errM: null }
    return { hitY: +hit.point.y.toFixed(3),
             errM: +(hit.point.y - (ground + h)).toFixed(4) }
  }
  const one = (tag, px, py) => {
    const l2 = cast(px, py, group)
    const l0r = l0 ? cast(px, py, l0) : { hitY: null, errM: null }
    const delta = (l2.hitY != null && l0r.hitY != null)
      ? +(l2.hitY - l0r.hitY).toFixed(4) : null
    return { tag, x: px, y: py, l2, l0: l0r, deltaM: delta }
  }
  const ring = pts.map(([tag, px, py]) => one(tag, px, py))
  const center = one('centroid', cx, cy)
  const inner = one('interior', interior[0], interior[1])
  m.scene.remove(group)
  group.traverse((o) => { if (o.isMesh) o.geometry.dispose() })
  if (l0) {
    m.scene.remove(l0)
    l0.traverse((o) => { if (o.isMesh) o.geometry.dispose() })
  }
  return { tile: '-02_-03', file: rec.file, l0File: 'manhattan_-02_-03.glb',
           l0Loaded: !!l0, ground,
           expectedRoofM: +(ground + h).toFixed(3),
           registryHeightM: h, ring, center, interior: inner }
})()`

async function main() {
  const a = process.argv
  const label = (a.find((x) => x.startsWith('--label=')) || '').split('=')[1]
    || a[a.indexOf('--label') + 1] || 'run'
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })

  let vite = null
  let cdp = null
  let chrome = null
  const run = {
    label,
    startedAt: new Date().toISOString(),
    machine: { platform: process.platform, node: process.version,
      chrome: 'headless=new, SwiftShader software GL' },
  }
  try {
    const port = await pickFreePort(5173)
    const devUrl = `http://127.0.0.1:${port}/`
    vite = await startVite(port)
    chrome = await startChrome()
    cdp = await Cdp.connect(chrome.wsUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Page.navigate', { url: devUrl })

    await waitFor('app boot', async () => {
      return cdp.evaluate(
        `!!window.__manhattan && !!window.__manhattan.renderer &&
         !!window.__manhattan.city && !!window.__manhattan.lod &&
         !!window.__manhattan.lod.manifest &&
         !!window.__manhattan.lod.manifest.L2`)
    }, 180000, 500)
    await cdp.evaluate(`window.__bench = await import('/src/bench.js')`)

    run.boot = await cdp.evaluate(`(() => {
      const m = window.__manhattan
      return {
        buildings: m.city.count,
        landLevelM: m.city.meta.land_level_m,
        lodTiles: Object.keys(m.lod.manifest.L2).length,
        manifestBase: m.lod.manifest.base || null,
        manifestLandLevel: m.lod.manifest.land_level_m ?? null,
      }
    })()`)

    run.harness = await cdp.evaluate(
      `window.__bench.measureLodL2({ tiles: 15, perTile: 26 })`)
    run.both = await cdp.evaluate(BOTH_SCRIPT)
    run.bid20009 = await cdp.evaluate(CORNER_SCRIPT)

    console.log(`[${label}] harness: samples=${run.harness.samples} ` +
      `median=${run.harness.medianErrM} p90=${run.harness.p90ErrM} ` +
      `max=${run.harness.maxErrM} worst=${JSON.stringify(run.harness.worstSample)}`)
    console.log(`[${label}] both: legacy(max=${run.both.legacy.max}, ` +
      `median=${run.both.legacy.median}) corrected(max=${run.both.corrected.max}, ` +
      `median=${run.both.corrected.median}) delta(max=${run.both.delta.max}, ` +
      `median=${run.both.delta.median})`)
    console.log(`[${label}] bid20009 ring:`,
      run.bid20009.ring.map((s) => `${s.tag}=l2:${s.l2.errM}/l0:${s.l0.errM}/d:${s.deltaM}`).join(' '),
      `centroid=l2:${run.bid20009.center.l2.errM}/l0:${run.bid20009.center.l0.errM}/d:${run.bid20009.center.deltaM} ` +
      `interior=l2:${run.bid20009.interior.l2.errM}/l0:${run.bid20009.interior.l0.errM}/d:${run.bid20009.interior.deltaM} ` +
      `(expected roof ${run.bid20009.expectedRoofM})`)
  } finally {
    if (cdp && cdp.ws && cdp.ws.readyState === WebSocket.OPEN) {
      try { cdp.ws.close() } catch {}
    }
    if (chrome) await killTree(chrome)
    if (vite) await killTree(vite.child)
  }

  const all = fs.existsSync(OUT_FILE)
    ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'))
    : { schema: '2o-b-lod lod recheck: before/after L2 measurements', runs: [] }
  if (!all.runs) all.runs = []
  run.endedAt = new Date().toISOString()
  all.runs.push(run)
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2))
  console.log('appended run to', path.relative(REPO, OUT_FILE))
  process.exit(0)
}

main().catch((err) => {
  console.error('lod-recheck failed:', err)
  process.exit(1)
})
