// bench-run.mjs — Phase 2O-A honest benchmark runner.
//
// Zero-dependency Node script (Node >= 22; uses the global WebSocket and
// fetch). Starts the Vite dev server, launches Chrome headless, drives the
// real app over CDP, measures the documented cameras, fires evidence PNGs
// through the app's own /__capture sink, re-measures the Phase 2 claims with
// the app's own verify() functions, and writes one JSON.
//
//   node scripts/qa/bench-run.mjs
//
// Outputs:
//   docs/qa/evidence/2o-baseline/bench_results.json
//   evidence/phase2/bench_*.png          (gitignored, not committed)

import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const APP = path.join(REPO, 'apps', 'manhattan-threejs')
const OUT_DIR = path.join(REPO, 'docs', 'qa', 'evidence', '2o-baseline')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 5173 is this worker's port; 5174/5175 belong to the parallel workers and
// are never used here. If 5173 is taken (e.g. a leftover process), fall back
// to the first free port >= 5180 and record it in the run metadata.
async function pickPort() {
  for (const p of [5173, ...Array.from({ length: 21 }, (_, i) => 5180 + i)]) {
    const busy = await new Promise((resolve) => {
      const s = net.createConnection({ port: p, host: '127.0.0.1' })
      const done = (v) => { s.destroy(); resolve(v) }
      s.once('connect', () => done(true))
      s.once('error', () => done(false))
      s.setTimeout(300, () => done(false))
    })
    if (!busy) return p
  }
  throw new Error('no free port in 5173, 5180-5200')
}

// Kill the whole process tree: on Windows killing the cmd.exe wrapper leaves
// the vite node child holding the port.
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

async function waitFor(what, fn, timeoutMs, intervalMs = 250) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      // keep polling
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`timeout waiting for ${what}`)
    }
    await sleep(intervalMs)
  }
}

// ---------------------------------------------------------------- dev server
async function startVite(port) {
  // .cmd cannot be spawned directly on Windows; cmd /c avoids Node's
  // shell:true arg concatenation (DEP0190). --host 127.0.0.1 pins IPv4:
  // Vite's default localhost binding resolved to ::1-only on this machine,
  // which the 127.0.0.1 probe (and Chrome's navigation) then refused.
  const args = process.platform === 'win32'
    ? ['/c', 'npm', 'run', 'dev', '--', '--port', String(port), '--strictPort',
      '--host', '127.0.0.1']
    : ['npm', 'run', 'dev', '--', '--port', String(port), '--strictPort',
      '--host', '127.0.0.1']
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', args, {
      cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    : spawn(args[0], args.slice(1), {
      cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  const url = `http://127.0.0.1:${port}/`
  await waitFor(`vite on :${port}`, async () => {
    const r = await fetch(url).catch(() => null)
    return r && r.ok
  }, 60000, 400)
  return { child, url, log: () => log }
}

// -------------------------------------------------------------------- chrome
// CDP port: prefer 9223 (the documented default); another harness on this
// machine respawns a Chrome on 9223, so fall back to the first free port
// >= 9224 and record which one was used in the run metadata.
async function pickCdpPort() {
  for (const p of [9223, ...Array.from({ length: 20 }, (_, i) => 9224 + i)]) {
    const busy = await new Promise((resolve) => {
      const s = net.createConnection({ port: p, host: '127.0.0.1' })
      const done = (v) => { s.destroy(); resolve(v) }
      s.once('connect', () => done(true))
      s.once('error', () => done(false))
      s.setTimeout(300, () => done(false))
    })
    if (!busy) return p
  }
  throw new Error('no free CDP port in 9223-9243')
}

async function startChrome() {
  const cdpPort = await pickCdpPort()
  const dir = path.join(os.tmpdir(), 'opencode', `bench2o-${process.pid}`)
  fs.mkdirSync(dir, { recursive: true })
  const child = spawn(CHROME, [
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
  return { child, wsUrl, dir, cdpPort }
}

// ---------------------------------------------------------------------- CDP
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

  // `returns` is true for single expressions whose value is wanted (the
  // wrapper then `return`s them). Multi-statement scriptlets pass returns:
  // false and are allowed to `return` from inside themselves.
  async evaluate(expression, { returns = true } = {}) {
    const wrapped = returns
      ? `(async () => { return (${expression}) })()`
      : `(async () => { ${expression} })()`
    const r = await this.send('Runtime.evaluate', {
      expression: wrapped,
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

// ----------------------------------------------------------- pure measurements
// EPSG:2263 (US survey feet) -> WGS84, a straight port of scripts/phase2/nysp.py
const FT_US = 1200 / 3937
const A = 6378137.0
const F = 1 / 298.257222101
const E2 = F * (2 - F)
const E = Math.sqrt(E2)
const rad = (d) => (d * Math.PI) / 180
const LAT1 = rad(40 + 40 / 60)
const LAT2 = rad(41 + 2 / 60 + 20 / 60 / 60)
const LAT0 = rad(40 + 10 / 60)
const LON0C = rad(-74)
const FE = 984250.0 * FT_US
const m = (la) => Math.cos(la) / Math.sqrt(1 - E2 * Math.sin(la) ** 2)
const t = (la) => {
  const es = E * Math.sin(la)
  return Math.tan(Math.PI / 4 - la / 2) / ((1 - es) / (1 + es)) ** (E / 2)
}
const M1 = m(LAT1)
const M2 = m(LAT2)
const T1 = t(LAT1)
const T2 = t(LAT2)
const T0 = t(LAT0)
const N = (Math.log(M1) - Math.log(M2)) / (Math.log(T1) - Math.log(T2))
const F0 = M1 / (N * T1 ** N)
const R0 = A * F0 * T0 ** N

function toWgs84(eastFt, northFt) {
  const x = eastFt * FT_US - FE
  const y = northFt * FT_US
  const ry = R0 - y
  // Python's math.copysign(hypot, N): N is negative here, so r is negative
  const r = Math.hypot(x, ry) * (N < 0 ? -1 : 1)
  const tt = (r / (A * F0)) ** (1 / N)
  const theta = Math.atan2(x, ry)
  let lon = theta / N + LON0C
  let la = Math.PI / 2 - 2 * Math.atan(tt)
  for (let i = 0; i < 12; i++) {
    const es = E * Math.sin(la)
    const nxt = Math.PI / 2 - 2 * Math.atan(tt * ((1 - es) / (1 + es)) ** (E / 2))
    if (Math.abs(nxt - la) < 1e-12) break
    la = nxt
  }
  return [lon / (Math.PI / 180), la / (Math.PI / 180)]
}

const PROJ_LAT0 = 40.78
const PROJ_LON0 = -73.968
const M_LAT = 110574.0
const M_LON = 111320.0 * Math.cos((PROJ_LAT0 * Math.PI) / 180)

function proj(lat, lon) {
  return [(lon - PROJ_LON0) * M_LON, (lat - PROJ_LAT0) * M_LAT]
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const s = l2 <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return Math.hypot(px - (ax + dx * s), py - (ay + dy * s))
}

// The State Plane claim: every DOT count point converted with nysp must land
// near a LION street. 808 points -> distances to the nearest drivable edge.
function statePlaneClaim() {
  const counts = JSON.parse(fs.readFileSync(
    path.join(REPO, 'source_data', 'nyc', 'traffic_volume.json'), 'utf8'))
  const graph = JSON.parse(fs.readFileSync(
    path.join(REPO, 'data', 'manhattan', 'streets', 'street_graph.json'), 'utf8'))
  // the pipeline's own join (49_build_demand.py) snaps against every LION
  // edge, drivable or not, so "within 25 m of a LION street" means all edges
  const edges = graph.edges
  const CELL = 200
  const grid = new Map()
  for (const e of edges) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = e.pts[i]
      const b = e.pts[i + 1]
      const cx = Math.floor(((a[0] + b[0]) * 0.5) / CELL)
      const cy = Math.floor(((a[1] + b[1]) * 0.5) / CELL)
      const k = `${cx},${cy}`
      if (!grid.has(k)) grid.set(k, [])
      grid.get(k).push([a[0], a[1], b[0], b[1]])
    }
  }
  const dists = []
  let parsed = 0
  for (const c of counts) {
    const m2 = /POINT\s*\(([-\d.]+)\s+([-\d.]+)\)/i.exec(c.wktgeom || '')
    if (!m2) continue
    const [lon, lat] = toWgs84(parseFloat(m2[1]), parseFloat(m2[2]))
    const [x, y] = proj(lat, lon)
    parsed++
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)
    let best = Infinity
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const seg of grid.get(`${cx + dx},${cy + dy}`) || []) {
          const d = segDist(x, y, seg[0], seg[1], seg[2], seg[3])
          if (d < best) best = d
        }
      }
    }
    dists.push(best)
  }
  dists.sort((a, b) => a - b)
  const median = dists[Math.floor(dists.length / 2)]
  const within25 = dists.filter((d) => d <= 25).length
  // Infinity means no street segment in the point's 3x3 grid neighbourhood:
  // the distance is unknown but at least a cell-width-ish offset away.
  const unbounded = dists.filter((d) => !Number.isFinite(d)).length
  const finite = dists.filter((d) => Number.isFinite(d))
  return {
    source: 'source_data/nyc/traffic_volume.json + street_graph.json, nysp port in this script',
    claimedPoints: counts.length,
    parsed: parsed,
    within25m: within25,
    pctWithin25m: +(100 * within25 / Math.max(1, parsed)).toFixed(2),
    medianM: +median.toFixed(2),
    p90M: +finite[Math.floor(finite.length * 0.9)].toFixed(2),
    maxM: Number.isFinite(finite[finite.length - 1])
      ? +finite[finite.length - 1].toFixed(2) : null,
    unboundedM: unbounded,
    beyond25m: dists.filter((d) => d > 25).length,
  }
}

// Sidewalk net area: shoelace over the survey rings, outer minus holes.
function sidewalkAreaClaim() {
  const geo = JSON.parse(fs.readFileSync(
    path.join(REPO, 'data', 'manhattan', 'streets', 'sidewalk_geom.json'), 'utf8'))
  let net = 0
  let outer = 0
  let holes = 0
  let stated = 0
  for (const rings of geo.polygons) {
    for (const p of rings) {
      let a = 0
      const pts = p.pts
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i]
        const [x2, y2] = pts[(i + 1) % pts.length]
        a += x1 * y2 - x2 * y1
      }
      a = Math.abs(a) / 2
      stated += p.area
      if (p.outer) { outer += a } else { holes += a }
    }
  }
  net = outer - holes
  return {
    source: 'data/manhattan/streets/sidewalk_geom.json, shoelace in this script',
    polygons: geo.polygons.length,
    outerAreaM2: Math.round(outer),
    holeAreaM2: Math.round(holes),
    netAreaM2: Math.round(net),
    statedSumM2: Math.round(stated),
  }
}

// ------------------------------------------------------------ data re-measure
function dataClaims() {
  const city = JSON.parse(fs.readFileSync(
    path.join(REPO, 'data', 'manhattan', 'runtime', 'city.json'), 'utf8'))
  const graph = JSON.parse(fs.readFileSync(
    path.join(REPO, 'data', 'manhattan', 'streets', 'street_graph.json'), 'utf8'))
  const walk = JSON.parse(fs.readFileSync(
    path.join(REPO, 'data', 'manhattan', 'streets', 'walk_graph.json'), 'utf8'))
  const props = JSON.parse(fs.readFileSync(
    path.join(REPO, 'data', 'manhattan', 'props', 'props.json'), 'utf8'))
  const csv = fs.readFileSync(path.join(REPO, 'data', 'manhattan',
    'buildings', 'building_registry.csv'), 'utf8')
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length)
  const registryRows = lines.length - 1

  const drivable = graph.edges.filter((e) => e.drivable)
  let drivableKm = 0
  for (const e of drivable) {
    for (let i = 1; i < e.pts.length; i++) {
      drivableKm += Math.hypot(e.pts[i][0] - e.pts[i - 1][0],
        e.pts[i][1] - e.pts[i - 1][1])
    }
  }
  let walkKm = 0
  for (const l of walk.lanes) {
    for (let i = 1; i < l.pts.length; i++) {
      walkKm += Math.hypot(l.pts[i][0] - l.pts[i - 1][0],
        l.pts[i][1] - l.pts[i - 1][1])
    }
  }
  const oneway = { forward: 0, backward: 0, twoWay: 0 }
  for (const e of drivable) {
    if (e.oneway === 1) oneway.forward++
    else if (e.oneway === -1) oneway.backward++
    else oneway.twoWay++
  }

  return {
    registryRows,
    cityBuildings: city.buildings,
    archetypes: city.archetypes.length,
    districts: city.districts.length,
    tiles: city.tiles.count,
    streetTiles: city.street_tiles.count,
    bounds: city.bounds,
    graphEdges: graph.edges.length,
    graphNodes: graph.nodes.length,
    drivableEdges: drivable.length,
    drivableKm: +drivableKm.toFixed(1),
    walkLanes: walk.lanes.length,
    walkKm: +walkKm.toFixed(2),
    propsRecords: props.count,
    oneway,
    statePlane: statePlaneClaim(),
    sidewalk: sidewalkAreaClaim(),
  }
}

// ------------------------------------------------------------------- cameras
const SHOT_NAMES = [
  'times_square', 'midtown_air', 'skyline_from_east', 'downtown_air',
  'central_park_air', 'fifth_ave_34th', 'west_village', 'harlem_rowhouses',
  'fidi_canyon', 'soho_castiron',
]

function cameraExpressions() {
  const out = []
  // Sync the mouse-look state after aiming, or the next rAF tick of
  // controls.update() re-applies the stale yaw/pitch and turns the camera.
  const SYNC_LOOK = `
    const _e = new m.THREE.Euler().setFromQuaternion(m.camera.quaternion, 'YXZ')
    m.controls.yaw = _e.y
    m.controls.pitch = _e.x
    m.camera.updateMatrixWorld(true)`

  // a. START / Times Square, 620 m top-down, straight from main.js constants
  out.push({
    name: 'bench_start_ts_topdown',
    place: `
      const m = window.__manhattan
      m.controls.mode = 'fly'
      m.camera.position.set(-1476, 620, 2433)
      m.camera.lookAt(-1476, 0, 2433)
      ${SYNC_LOOK}
      await window.__capture.settle()`,
    evidence: `
      const m = window.__manhattan
      const V = m.THREE.Vector3
      return await window.__capture.shootFrom('bench_start_ts_topdown',
        new V(-1476, 620, 2433), new V(-1476, 0, 2433), 'fly')`,
    evidenceScript: true,
  })
  // the P2-075 old start (Lincoln Square) at the same altitude, for contrast
  out.push({
    name: 'bench_lincoln_square_topdown',
    place: `
      const m = window.__manhattan
      m.controls.mode = 'fly'
      m.camera.position.set(-1900, 620, 600)
      m.camera.lookAt(-1900, 0, 600)
      ${SYNC_LOOK}
      await window.__capture.settle()`,
    evidence: `
      const m = window.__manhattan
      const V = m.THREE.Vector3
      return await window.__capture.shootFrom('bench_lincoln_square_topdown',
        new V(-1900, 620, 600), new V(-1900, 0, 600), 'fly')`,
    evidenceScript: true,
  })
  // b-d. the SHOTS list, verbatim from capture.js
  for (const name of SHOT_NAMES) {
    out.push({
      name: `bench_${name}`,
      place: `
        const cap = window.__capture
        cap.place(cap.SHOTS[${JSON.stringify(name)}])
        await cap.settle()`,
      evidence: `
        await window.__capture.shoot('bench_${name}',
          window.__capture.SHOTS[${JSON.stringify(name)}])`,
    })
  }
  // e. Floor 45 interior, from hq.js FLOOR45.shot
  out.push({
    name: 'bench_floor45',
    place: `
      const m = window.__manhattan
      const { applyClip } = await import('/src/sky.js')
      const r = m.hq.rooms.floor45
      if (!r) { throw new Error('no floor45 room') }
      m.interiors.enter(r)
      const s = r.shot
      m.camera.position.copy(s.eye)
      m.camera.lookAt(s.at)
      const eu = new m.THREE.Euler().setFromQuaternion(m.camera.quaternion, 'YXZ')
      m.controls.yaw = eu.y
      m.controls.pitch = eu.x
      m.controls.mode = 'walk'
      applyClip(m.camera, 'walk')
      m.camera.updateMatrixWorld(true)
      await window.__capture.settle()`,
    evidence: `
      const m = window.__manhattan
      const s = m.hq.rooms.floor45.shot
      return await window.__capture.shootFrom('bench_floor45', s.eye, s.at, 'walk')`,
    evidenceScript: true,
  })
  // f. mid-drive on the corridor (route solved over the LION graph, car cabin)
  out.push({
    name: 'bench_corridor_drive',
    place: `
      const m = window.__manhattan
      if (!m.corridor.ready) { throw new Error('corridor not ready') }
      m.corridor.start(m.camera, m.controls)
      let guard = 0
      while (m.corridor.stats.leg !== 'drive_market' && guard++ < 15) m.corridor.next()
      let guard2 = 0
      while ((m.corridor.stats.leg !== 'drive_market' || m.corridor.stats.progress < 0.5)
          && guard2++ < 9000) m.corridor.update(1 / 30)
      if (m.corridor.stats.leg !== 'drive_market') {
        m.corridor.stop()
        throw new Error('corridor never reached the drive leg')
      }
      m.camera.updateMatrixWorld(true)
      await window.__capture.settle()`,
    evidence: `
      const m = window.__manhattan
      const eye = m.camera.position.clone()
      const dir = new m.THREE.Vector3()
      m.camera.getWorldDirection(dir)
      const at = eye.clone().add(dir.multiplyScalar(30))
      const res = await window.__capture.shootFrom('bench_corridor_drive', eye, at, 'walk')
      m.corridor.stop()
      return res`,
    evidenceScript: true,
  })
  // g. Battery at 1500 m, from the world extent data
  out.push({
    name: 'bench_battery_1500',
    place: `
      const m = window.__manhattan
      const b = window.__bench.batterySpec(m.city.meta.bounds)
      m.controls.mode = 'fly'
      m.camera.position.set(b.eye[0], b.eye[1], b.eye[2])
      m.camera.lookAt(b.at[0], b.at[1], b.at[2])
      ${SYNC_LOOK}
      await window.__capture.settle()
      b.district = m.city.district(m.city.nearest(b.eye[0], b.eye[2], 9000))
      b`,
    evidence: `
      const m = window.__manhattan
      const b = window.__bench.batterySpec(m.city.meta.bounds)
      const V = m.THREE.Vector3
      return await window.__capture.shootFrom('bench_battery_1500',
        new V(b.eye[0], b.eye[1], b.eye[2]),
        new V(b.at[0], b.at[1], b.at[2]), 'fly')`,
    evidenceScript: true,
  })
  return out
}

// ---------------------------------------------------------------- main flow
export { toWgs84, proj, segDist, statePlaneClaim, sidewalkAreaClaim, dataClaims }

const isMain = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  main().catch((err) => {
    console.error('bench-run failed:', err)
    process.exitCode = 1
  })
}
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const run = {
    startedAt: new Date().toISOString(),
    machine: {
      platform: process.platform,
      node: process.version,
      chrome: 'headless=new, SwiftShader software GL',
      note: 'Software rendering: absolute fps is not hardware-GPU performance. ' +
        'cpuMs is main-thread command submission; rasterMs forces the ' +
        'SwiftShader rasterizer to finish (render + readPixels), which is the ' +
        'honest per-frame cost on this machine. Draw calls, triangles, ' +
        'resident bytes and CPU times are the load metrics.',
    },
  }

  let vite = null
  let chrome = null
  let cdp = null
  let port = null
  try {
    port = await pickPort()
    run.port = port
    const devUrl = `http://127.0.0.1:${port}/`
    vite = await startVite(port)
    run.vite = { url: devUrl }
    chrome = await startChrome()
    run.cdpPort = chrome.cdpPort
    cdp = await Cdp.connect(chrome.wsUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Page.navigate', { url: devUrl })

    await waitFor('app boot (window.__manhattan + __capture)', async () => {
      return cdp.evaluate(`
        !!window.__manhattan && !!window.__manhattan.renderer &&
        !!window.__capture && !!window.__capture.SHOTS &&
        document.getElementById('boot').classList.contains('gone')`)
    }, 180000, 500)

    await cdp.evaluate(
      `window.__bench = await import('/src/bench.js')`, { returns: false })
    // Pin the drawing buffer to the evidence resolution (1280x720). The page
    // sizes the canvas from innerWidth/innerHeight, which is 1264x625 in this
    // headless window, and mixing two resolutions makes every per-camera
    // number a hostage of window chrome. The HUD is DOM, so this does not
    // hide anything; it fixes the render target.
    await cdp.evaluate(`(() => {
      const m = window.__manhattan
      m.renderer.setSize(1280, 720, false)
      m.camera.aspect = 1280 / 720
      m.camera.updateProjectionMatrix()
      return { w: m.renderer.domElement.width, h: m.renderer.domElement.height }
    })()`)
    const boot = await cdp.evaluate(`(() => {
      const m = window.__manhattan
      return {
        buildings: m.city.count,
        archetypes: m.city.meta.archetypes.length,
        districts: m.city.meta.districts.length,
        renderer: {
          software: m.renderer.capabilities.isWebGL2 === false ? 'webgl1' : 'webgl2',
          precision: m.renderer.capabilities.precision,
          maxTextureSize: m.renderer.capabilities.maxTextureSize,
        },
        timesSquare: { x: -1476, y: -2433 },
        camera: { x: m.camera.position.x, y: m.camera.position.y,
          z: m.camera.position.z },
        canvas: { w: m.renderer.domElement.width, h: m.renderer.domElement.height },
      }
    })()`)
    run.boot = boot

    // ---------------------------------------------------------- data claims
    try {
      run.data = dataClaims()
    } catch (err) {
      run.data = { error: String(err && err.message ? err.message : err) }
    }

    // -------------------------------------------------------------- cameras
    run.cameras = []
    const withTimeout = (promise, ms, what) => Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(
        () => rej(new Error(`${what} exceeded ${ms / 1000} s`)), ms)),
    ])
    for (const cam of cameraExpressions()) {
      const record = { name: cam.name }
      const tCam = Date.now()
      try {
        await withTimeout(cdp.evaluate(cam.place, { returns: false }), 120000,
          'placement')
        record.placement = await cdp.evaluate(`(() => {
          const m = window.__manhattan
          const c = m.camera
          return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2),
            z: +c.position.z.toFixed(2) }
        })()`)
        record.measure = await withTimeout(cdp.evaluate(`
          window.__bench.measureFrames({ label: ${JSON.stringify(cam.name)}, n: 60 })`), 240000, 'measure')
        record.payload = await cdp.evaluate(`window.__bench.residentPayload()`)
        record.scene = await cdp.evaluate(`window.__bench.sceneStats(window.__manhattan.scene)`)
        record.sim = await cdp.evaluate(`(() => {
          const m = window.__manhattan
          return {
            vehicles: m.traffic.stats.vehicles,
            people: m.crowd.stats.people,
            propsDrawn: m.props.stats.drawn,
            lod: m.lod.stats,
            corridorLeg: m.corridor.stats.leg,
          }
        })()`)
        record.evidence = await withTimeout(cdp.evaluate(cam.evidence,
          { returns: !cam.evidenceScript }), 120000, 'evidence')
        // HANDOFF 2O §0.1: never accept a capture without the dead-frame
        // check. A uniform clear-colour PNG has happened here twice (the GPU
        // process dropped a frame under the old busy-poll load); if the frame
        // after the capture is dead, re-shoot once and say so.
        record.frameHealth = await cdp.evaluate(
          `window.__bench.frameHealth()`)
        if (record.frameHealth.dead || record.frameHealth.contextLost) {
          const retry = await cdp.evaluate(cam.evidence,
            { returns: !cam.evidenceScript })
          record.evidenceRetry = { first: record.evidence, second: retry }
          record.evidence = retry
          record.frameHealthAfterRetry = await cdp.evaluate(
            `window.__bench.frameHealth()`)
        }
        const evFile = record.evidence && record.evidence.file
          ? path.join(REPO, record.evidence.file) : null
        if (evFile && fs.existsSync(evFile)) {
          record.evidenceSha = await import('node:crypto')
            .then((c) => c.createHash('sha256').update(fs.readFileSync(evFile))
              .digest('hex'))
        }
      } catch (err) {
        record.error = String(err && err.message ? err.message : err)
      }
      run.cameras.push(record)
      console.log(`[camera] ${cam.name} (${(Date.now() - tCam) / 1000 | 0}s):`,
        record.error ? `ERROR ${record.error}` :
          `${record.measure.perFrame.triangles} tris / ` +
          `${record.measure.perFrame.calls} draws / ` +
          `cpu ${record.measure.cpuMs.median} ms / ` +
          `raster ${record.measure.rasterMs.median} ms / ` +
          `frame ${record.frameHealth && !record.frameHealth.dead ? 'ok' : 'DEAD'} / ` +
          `evidence ${record.evidence && record.evidence.ok ? record.evidence.bytes : String(record.evidence).slice(0, 60)}`)
    }

    // ---------------------------------------------------------------- claims
    // the street-life and crowd/props claims need a street camera in scope
    await cdp.evaluate(`(() => {
      const m = window.__manhattan
      const cap = window.__capture
      cap.place(cap.SHOTS.times_square)
      return cap.settle()
    })()`)
    // let the crowd and traffic actually fill the street first
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

    run.claims = {}
    const claim = async (name, fn) => {
      try {
        run.claims[name] = await fn()
      } catch (err) {
        run.claims[name] = {
          error: String(err && err.message ? err.message : err),
        }
      }
      console.log(`[claims] ${name}:`, run.claims[name].error
        ? `ERROR ${run.claims[name].error}`
        : 'ok')
      return run.claims[name]
    }

    await claim('streetLifeMs',
      () => cdp.evaluate(`window.__bench.streetLifeMs()`))
    await claim('walkCycle',
      () => cdp.evaluate(`window.__bench.walkCycleCheck()`))
    await claim('propsOnPavement',
      () => cdp.evaluate(`window.__bench.propsOnPavement(400)`))
    await claim('audio', () => cdp.evaluate(`window.__manhattan.verifyAudio()`))
    await claim('hq', () => cdp.evaluate(`(() => {
      const m = window.__manhattan
      return m.hq.verify(m.renderer, m.scene, m.camera)
    })()`))
    await claim('corridor',
      () => cdp.evaluate(`window.__manhattan.corridor.verify()`))
    await claim('lodL2',
      () => cdp.evaluate(`window.__bench.measureLodL2({ tiles: 15, perTile: 26 })`))

    run.endedAt = new Date().toISOString()
  } finally {
    if (cdp && cdp.ws && cdp.ws.readyState === WebSocket.OPEN) {
      try { cdp.ws.close() } catch {}
    }
    if (chrome) {
      killTree(chrome.child)
    }
    if (vite) {
      killTree(vite.child)
    }
  }

  const outFile = path.join(OUT_DIR, 'bench_results.json')
  // identical evidence SHA across cameras = the same frame served twice
  const seen = new Map()
  run.evidenceDuplicates = []
  for (const c of run.cameras) {
    if (!c.evidenceSha) continue
    if (seen.has(c.evidenceSha)) {
      run.evidenceDuplicates.push({
        first: seen.get(c.evidenceSha), second: c.name,
      })
    } else {
      seen.set(c.evidenceSha, c.name)
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(run, null, 2))
  console.log('\nwrote', path.relative(REPO, outFile))
  const summary = {
    cameras: run.cameras.map((c) => ({
      name: c.name,
      error: c.error || null,
      tris: c.measure && c.measure.perFrame.triangles,
      draws: c.measure && c.measure.perFrame.calls,
      cpuMedianMs: c.measure && c.measure.cpuMs.median,
      rasterMedianMs: c.measure && c.measure.rasterMs.median,
      gpuTimer: c.measure && c.measure.gpuTimer,
      gpuMedianMs: c.measure && c.measure.gpuMs && c.measure.gpuMs.median,
      residentMB: c.payload && c.payload.totalMB,
      frameHealth: c.frameHealth && (c.frameHealth.dead
        ? `DEAD ${c.frameHealth.stddev}/${c.frameHealth.distinctColors8}`
        : `ok ${c.frameHealth.stddev}/${c.frameHealth.distinctColors8}`),
      evidenceRetry: c.evidenceRetry ? true : undefined,
      evidenceSha: c.evidenceSha && c.evidenceSha.slice(0, 12),
    })),
    evidenceDuplicates: run.evidenceDuplicates,
    claims: {
      walkCycle: run.claims && run.claims.walkCycle,
      props: run.claims && run.claims.propsOnPavement &&
        `${run.claims.propsOnPavement.onPavement}/${run.claims.propsOnPavement.sampled}`,
      audioSilentRms: run.claims && run.claims.audio && run.claims.audio.silent.rms,
      hqPixelsChanged: run.claims && run.claims.hq &&
        (run.claims.hq.checks.find((c) => c.name === 'suppression changes the frame')
          || {}).pixels_changed,
      corridorWorstM: run.claims && run.claims.corridor &&
        (run.claims.corridor.checks
          .find((c) => c.name === 'route market stays on the road') || {}).worst_offset_m,
      lodL2: run.claims && run.claims.lodL2 &&
        { samples: run.claims.lodL2.samples, medianM: run.claims.lodL2.medianErrM,
          maxM: run.claims.lodL2.maxErrM, worst: run.claims.lodL2.worstSample },
    },
  }
  console.log(JSON.stringify(summary, null, 2))
}
