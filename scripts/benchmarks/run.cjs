#!/usr/bin/env node
// run.js — Phase 2O-A deterministic benchmark harness.
//
// Usage:
//   node scripts/benchmarks/run.js --app manhattan --location times-square
//   node scripts/benchmarks/run.js --app shenron --location hq-lobby --scenario walk
//   node scripts/benchmarks/run.js --app manhattan --location lincoln-square --scenario night
//   node scripts/benchmarks/run.js --app manhattan --location harlem --scenario zone
//   node scripts/benchmarks/run.js --app shenron --location city-entry --scenario soak
//
// Options: --passes N (default 3), --seconds S (sample length, default 10),
//          --chrome PATH, --port P (CDP, default 9222), --out DIR,
//          --quality low|medium|high (shenron only), --no-start-dev
//
// Metrics are written as JSON next to screenshots under --out (default
// evidence/performance/phase2o-a). FPS stats come from rAF frame deltas in
// the page; renderer.info/traffic/crowd/weather stats come from the
// Manhattan app's own window.__manhattan when available.

const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')

const { launchChrome, openTab, navigate, evaluate, screenshot, key, sleep, waitFor } =
  require('./lib/cdp.cjs')
const { summarizeFrames, varianceAcrossPasses } = require('./lib/stat.cjs')
const { LOCATIONS, ll2xy } = require('./lib/locations.cjs')

const REPO = path.resolve(__dirname, '..', '..')
const MANHATTAN_APP = path.join(
  REPO, 'Made assets', 'Manhattan City', 'apps', 'manhattan-threejs')
const CHROME = process.env.CHROME ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SHENRON_URL = 'http://127.0.0.1:9132'
const MANHATTAN_URL = 'http://127.0.0.1:5176'

// ---------------------------------------------------------------- args ----

function trace(msg) {
  const f = process.env.BENCH_TRACE
  if (f) fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`)
}

function parseArgs() {
  const a = process.argv.slice(2)
  const get = (name, def) => {
    const i = a.indexOf(name)
    return i >= 0 ? a[i + 1] : def
  }
  const app = get('--app', 'manhattan')
  const location = get('--location', 'times-square')
  const scenario = get('--scenario', 'stand')
  return {
    app,
    location,
    scenario,
    passes: parseInt(get('--passes', '3'), 10),
    seconds: parseInt(get('--seconds', '10'), 10),
    chrome: get('--chrome', CHROME),
    port: parseInt(get('--port', '9222'), 10),
    out: get('--out', path.join(REPO, 'evidence', 'performance', 'phase2o-a')),
    quality: get('--quality', 'high'),
    noStartDev: a.includes('--no-start-dev'),
    extra: a.filter((x) => x.startsWith('--extra=')).map((x) => x.slice(8)),
  }
}

// ---------------------------------------------------------- dev servers ----

async function urlReachable(url) {
  trace("urlReachable " + url)
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) })
    trace("urlReachable " + url + " -> " + r.status)
    return r.ok
  } catch (e) {
    trace("urlReachable " + url + " fail " + e.name)
    return false
  }
}

async function ensureDevServer(url, cwd, viteBin, port) {
  if (await urlReachable(url)) return { started: false, child: null }
  if (process.env.SKIP_DEV_START) {
    throw new Error(`${url} not reachable and dev-server start disabled`)
  }
  console.log(`[dev] starting vite in ${cwd}`)
  // Run the vite node process directly (not npm, whose wrapper shell orphans
  // the server when the harness is killed on Windows). --host pins IPv4 and
  // --strictPort makes a port collision fail loudly instead of silently
  // moving the server to another port where every probe times out.
  const child = spawn(process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd, stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    if (await urlReachable(url)) return { started: true, child }
  }
  try { child.kill() } catch {}
  throw new Error(`dev server at ${url} did not come up`)
}

// ------------------------------------------------------------- sampling ----

function gpuProbeExpr() {
  return `(() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return { renderer: null, vendor: null };
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null,
      };
    } catch (e) { return { renderer: null, vendor: null }; }
  })()`
}

function samplerScript(ms) {
  return `(async () => {
    const dur = ${ms};
    const deltas = [];
    let last = performance.now();
    const longTasks = [];
    let lo = null;
    try {
      lo = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(e.duration); });
      lo.observe({ entryTypes: ['longtask'] });
    } catch {}
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (now - t0 < dur) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    if (lo) lo.disconnect();
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      deltas,
      longTasks,
      heapUsedMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
      heapTotalMB: performance.memory ? performance.memory.totalJSHeapSize / 1048576 : null,
      measuredMs: performance.now() - t0,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
    };
  })()`
}

function manhattanSnapshotExpr() {
  return `(() => {
    const m = window.__manhattan;
    if (!m) return { ok: false };
    const st = m.streamer.update(m.camera);
    const info = m.renderer.info.render;
    let district = null;
    try {
      const i = m.city.nearest(m.camera.position.x, m.camera.position.z, 900);
      district = i >= 0 ? m.city.district(i) : 'off-island';
    } catch {}
    return {
      ok: true,
      drawCalls: info.calls,
      triangles: info.triangles,
      geometries: info.geometries,
      textures: info.textures,
      tilesResident: st.resident,
      tilesLoading: st.loading,
      tilesQueued: st.queued,
      tilesTotal: m.streamer.tileCount,
      vehicles: m.traffic.stats.vehicles,
      pedestrians: m.crowd.stats.people,
      demand: m.crowd.stats.demand,
      lod: m.lod.stats,
      weather: m.weather.stats,
      camera: { x: +m.camera.position.x.toFixed(1), y: +m.camera.position.y.toFixed(1), z: +m.camera.position.z.toFixed(1) },
      district,
    };
  })()`
}

// ------------------------------------------------------------- scenarios ----

async function setupManhattan(page, location, scenario, seconds) {
  const loc = LOCATIONS[location]
  // capture.js fetches the street/walk graphs asynchronously, so the first
  // place() can snap to the carriageway instead of the pavement. Prime both
  // fetches and wait before placing, or the camera lands somewhere different
  // on every pass (measured: -1475,2432 vs -1505,2466 on two runs).
  const placeExpr = `(async () => {
    const c = window.__capture;
    if (!c) return { ok: false, why: 'no __capture' };
    await Promise.all([
      fetch('/streets/walk_graph.json').catch(() => {}),
      fetch('/streets/street_graph.json').catch(() => {}),
    ]);
    await new Promise((r) => setTimeout(r, 1500));
    await c.place(${JSON.stringify(loc.spec)});
    await c.settle(20000);
    return { ok: true };
  })()`
  const r = await evaluate(page, placeExpr)
  if (!r.ok) throw new Error(`capture place failed: ${r.why}`)
  if (scenario === 'rain') {
    await evaluate(page, `window.__manhattan.weather.setRain(1)`)
  }
  if (scenario === 'night') {
    await evaluate(page, `window.__manhattan.weather.setTime(23.5)`)
  }
  if (scenario === 'zone') {
    // far shot to force streaming churn, then settle back to the main shot
    await evaluate(page, `(async () => {
      const c = window.__capture;
      await c.place([40.8090, -73.9480, 1.7, 0.35, 0.05, 'walk']);
      await c.settle(30000);
    })()`)
  }
  if (scenario === 'soak') {
    await sleep(1000) // sims settle before the 10-minute sample
  }
  // warm the renderer before sampling
  await sleep(3000)
}

async function setupShenron(page, url, scenario) {
  if (scenario === 'zone') return // caller reloads between phases
  // The first seconds after spawn are asset streaming + shader compilation;
  // a sample taken in that window measures loading, not steady state. Wait
  // for it so pass 1 measures the same thing as pass 2 (measured: a 5 s
  // stall in pass 1 with a 3 s warmup, gone with 8 s).
  await sleep(8000)
}

// Some presets compile shaders or stream assets a few seconds after the
// fixed warmup (measured: a ~4.5 s stall 8 s after load on the medium
// preset). A sample containing a >1 s stall measures loading, not steady
// state, so discard it and take another.
async function steadySample(page, seconds, moving) {
  let sample = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    sample = await evaluate(page, samplerScript(seconds * 1000))
    const stalled = (sample.deltas || []).filter((d) => d > 1000).length
    if (!stalled || attempt === 3) return { ...sample, stalledWarmups: attempt - 1 }
    if (moving) await key(page, 'ShiftLeft', false)
    await sleep(3000)
    if (moving) await key(page, 'ShiftLeft', true)
  }
  return { ...sample, stalledWarmups: 2 }
}

// ----------------------------------------------------------------- main ----

async function runPass({ page, app, url, location, scenario, seconds, quality, cwd }) {
  const gpu = await evaluate(page, gpuProbeExpr())
  if (app === 'shenron') {
    const view = LOCATIONS[location].view || location
    await navigate(page, `${url}/?spawn=${view}&inspect=1&quality=${quality}`)
    await waitFor(page, 60000, async () => {
      const r = await evaluate(page, `document.querySelectorAll('canvas').length`)
      return r > 0
    })
    await setupShenron(page, url, scenario)
    // scenario motion: hold W (walk) or W+Shift (sprint) for the sample
    const moving = scenario === 'walk' || scenario === 'sprint'
    if (moving) {
      await key(page, 'KeyW', true)
      if (scenario === 'sprint') await key(page, 'ShiftLeft', true)
      await sleep(500)
    }
    const sample = await steadySample(page, seconds, moving)
    if (moving) {
      await key(page, 'ShiftLeft', false)
      await key(page, 'KeyW', false)
    }
    const before = await screenshot(page)
    return { sample, stats: null, gpu, before }
  }

  // manhattan
  await navigate(page, url)
  await waitFor(page, 60000, async () => {
    const r = await evaluate(page, `!!window.__manhattan`)
    return r
  })
  await setupManhattan(page, location, scenario, seconds)
  const sample = await steadySample(page, seconds, false)
  const stats = await evaluate(page, manhattanSnapshotExpr())
  const before = await screenshot(page)
  return { sample, stats, gpu, before }
}

async function main() {
  const args = parseArgs()
  trace("main start " + JSON.stringify({ app: args.app, location: args.location, scenario: args.scenario }))
  const { app, location, scenario } = args
  if (!LOCATIONS[location]) throw new Error(`unknown location ${location}`)
  if (LOCATIONS[location].app !== app) {
    throw new Error(`location ${location} belongs to app ${LOCATIONS[location].app}, not ${app}`)
  }

  fs.mkdirSync(args.out, { recursive: true })
  const tag = `${app}-${location}-${scenario}` + (app === 'shenron' ? `-${args.quality}` : '')

  // dev servers
  const dev = []
  if (!args.noStartDev) {
    trace("ensure shenron")
    const shen = await ensureDevServer(
      SHENRON_URL, REPO, path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), 9132)
    if (shen.started) dev.push(shen.child)
    trace("ensure manhattan")
    const manh = await ensureDevServer(
      MANHATTAN_URL, MANHATTAN_APP,
      path.join(MANHATTAN_APP, 'node_modules', 'vite', 'bin', 'vite.js'), 5176)
    if (manh.started) dev.push(manh.child)
  }
  const url = app === 'manhattan' ? MANHATTAN_URL : SHENRON_URL

  trace("launching chrome")
  const browser = await launchChrome({ chromePath: args.chrome, port: args.port })
  trace("opening tab")
  const { page } = await openTab(browser, { width: 1280, height: 720 })

  const passes = []
  try {
    for (let p = 0; p < args.passes; p++) {
      trace("runPass start")
      const result = await runPass({
        page, app, url, location, scenario,
        seconds: args.seconds, quality: args.quality,
      })
      const summary = summarizeFrames(result.sample.deltas)
      const pass = {
        pass: p + 1,
        app, location, scenario,
        quality: app === 'shenron' ? args.quality : null,
        startedAtUtc: new Date().toISOString(),
        measuredMs: result.sample.measuredMs,
        stats: summary,
        longTasks: result.sample.longTasks,
        heapUsedMB: result.sample.heapUsedMB,
        heapTotalMB: result.sample.heapTotalMB,
        loadMs: result.sample.loadMs,
        appStats: result.stats,
        gpu: result.gpu,
      }
      passes.push(pass)
      fs.writeFileSync(
        path.join(args.out, `${tag}-pass${p + 1}.json`),
        JSON.stringify(pass, null, 2))
      fs.writeFileSync(path.join(args.out, `${tag}-pass${p + 1}.png`), result.before)
      console.log(`[${tag}] pass ${p + 1}: avg ${summary.fps.avg.toFixed(1)} fps, ` +
        `p1 ${summary.fps.p1.toFixed(1)}, p0.1 ${summary.fps.p01.toFixed(1)}, ` +
        `dead ${summary.deadFrames}, draws ${result.stats?.drawCalls ?? 'n/a'}, ` +
        `tris ${result.stats?.triangles ?? 'n/a'}`)
      if (app === 'manhattan' && result.stats?.district) {
        console.log(`[${tag}]   camera at ${result.stats.camera.x},${result.stats.camera.z} → ${result.stats.district}`)
      }
    }
  } finally {
    browser.close()
    for (const c of dev) { try { c.kill() } catch {} }
  }

  const variance = varianceAcrossPasses(
    passes.map((p) => ({ stats: {
      fpsAvg: p.stats.fps.avg,
      fpsP1: p.stats.fps.p1,
      fpsP01: p.stats.fps.p01,
      frameAvgMs: p.stats.frameMs.avg,
      heapUsedMB: p.heapUsedMB ?? 0,
    } })))

  const aggregate = {
    app, location, scenario, passes: passes.length,
    seconds: args.seconds, quality: args.quality,
    dateUtc: new Date().toISOString(),
    locations: LOCATIONS[location],
    variance,
    notes: {
      cameraAsserted: LOCATIONS[location].note,
      manhattanProjection: app === 'manhattan'
        ? ll2xy(LOCATIONS[location].spec[0], LOCATIONS[location].spec[1])
        : null,
    },
  }
  const aggFile = path.join(args.out, `${tag}.json`)
  fs.writeFileSync(aggFile, JSON.stringify(aggregate, null, 2))
  console.log(`[done] ${tag} → ${path.relative(REPO, aggFile)} (${passes.length} passes)`)
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1) })
