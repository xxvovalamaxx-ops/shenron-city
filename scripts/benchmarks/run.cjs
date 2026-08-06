#!/usr/bin/env node
// run.cjs — Phase 2O-A deterministic benchmark harness.
//
// Usage:
//   node scripts/benchmarks/run.cjs --app manhattan --location times-square
//   node scripts/benchmarks/run.cjs --app shenron --location hq-lobby --scenario walk
//   node scripts/benchmarks/run.cjs --app manhattan --location times-square --scenario rain
//   node scripts/benchmarks/run.cjs --app manhattan --location times-square --scenario elevator
//   node scripts/benchmarks/run.cjs --app manhattan --location times-square --scenario maxpeds
//   node scripts/benchmarks/run.cjs --app manhattan --location times-square --scenario maxtraffic
//   node scripts/benchmarks/run.cjs --app manhattan --location times-square --scenario soak
//   node scripts/benchmarks/run.cjs --app shenron --location hero-corridor-exterior --scenario soak
//
// Options: --passes N (default 3), --seconds S (sample length, default 10;
//          soak forces 600 unless overridden), --chrome PATH, --port P,
//          --out DIR, --quality low|medium|high (shenron only),
//          --no-start-dev
//
// Metrics: rAF frame deltas (avg/median/p1/p0.1, stall frames), long tasks,
// JS heap, load time, CPU counters (CDP Performance), console/network error
// buckets, per-frame render time (Manhattan app), scene actor counts
// (Manhattan app), screenshot integrity (sha256, luminance bands, frame diff
// vs pass 1).

const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')

const { launchChrome, openTab, navigate, evaluate, screenshot, key, sleep, waitFor,
  classifyErrorEvents, cpuMetricsDelta } = require('./lib/cdp.cjs')
const { summarizeFrames, varianceAcrossPasses } = require('./lib/stat.cjs')
const { LOCATIONS, ll2xy } = require('./lib/locations.cjs')
const { decodePng, luminanceBands, frameDiff, sha256 } = require('./lib/png.cjs')

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

function samplerScript(ms, bucketMs = 60000) {
  return `(async () => {
    const dur = ${ms};
    const bucketMs = ${bucketMs};
    const deltas = []; // { d, ts } frame deltas with timestamps
    const heap = [];   // heap samples every ~5 s
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
        deltas.push({ d: now - last, ts: now - t0 });
        last = now;
        if (performance.memory && now - t0 >= heap.length * 5000) {
          heap.push({ ts: now - t0, mb: performance.memory.usedJSHeapSize / 1048576 });
        }
        if (now - t0 < dur) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
    if (lo) lo.disconnect();
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      deltas, heap, longTasks,
      measuredMs: performance.now() - t0,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
    };
  })()`
}

/** Frame deltas -> per-bucket summaries (buckets of bucketMs). */
function bucketFrames(deltas, bucketMs) {
  const out = []
  let cur = null
  for (const f of deltas) {
    const idx = Math.floor(f.ts / bucketMs)
    if (!cur || cur.idx !== idx) {
      if (cur) out.push(cur)
      cur = { idx, deltas: [] }
    }
    cur.deltas.push(f.d)
  }
  if (cur) out.push(cur)
  return out.map((b) => {
    const s = summarizeFrames(b.deltas)
    return { bucket: b.idx, seconds: (b.idx + 1) * bucketMs / 1000, ...s.fps }
  })
}

function manhattanSetupExpr(location, scenario) {
  const loc = LOCATIONS[location]
  const parts = [
    // capture.js fetches the street/walk graphs asynchronously, so the first
    // place() can snap to the carriageway instead of the pavement. Prime both
    // fetches and wait before placing, or the camera lands somewhere different
    // on every pass (measured: -1475,2432 vs -1505,2466 on two runs).
    `await Promise.all([
      fetch('/streets/walk_graph.json').catch(() => {}),
      fetch('/streets/street_graph.json').catch(() => {}),
    ]);`,
    `await new Promise((r) => setTimeout(r, 1500));`,
  ]
  if (scenario === 'maxpeds') {
    parts.push(`window.__manhattan.demand.pedSmooth = () => 1.0; // max preset`)
  }
  if (scenario === 'maxtraffic') {
    parts.push(`(() => {
      const t = window.__manhattan.traffic;
      const lanes = t.lanes.values ? [...t.lanes.values()] : t.lanes;
      for (const l of lanes) if (typeof l.weight === 'number') l.weight = 1.0;
    })(); // max preset`)
  }
  if (scenario === 'rain') {
    parts.push(`window.__manhattan.weather.setRain(1)`)
  }
  if (scenario === 'night') {
    parts.push(`window.__manhattan.weather.setTime(23.5)`)
  }
  if (scenario === 'zone') {
    parts.push(`(() => {
      const c = window.__capture;
      return c.place([40.8090, -73.9480, 1.7, 0.35, 0.05, 'walk']).then(() => c.settle(30000));
    })()`)
  }
  return `(async () => {
    const c = window.__capture;
    if (!c) return { ok: false, why: 'no __capture' };
    ${parts.join('\n')}
    await c.place(${JSON.stringify(loc.spec)});
    await c.settle(20000);
    return { ok: true };
  })()`
}

const ELEVATOR_SCRIPT = `(async () => {
  const m = window.__manhattan;
  const t0 = performance.now();
  if (!m.corridor.active) m.corridor.start(m.camera, m.controls);
  const deltas = [];
  let last = performance.now();
  const legs = [];
  const ride = { start: null, end: null };
  let prev = null;
  const tMax = 300000;
  // Room legs wait for C (main.js: 'C advances a leg'); lift and drive legs
  // auto-complete. Skip everything until the HQ lobby, then let the ascend
  // lift play naturally — that is the elevator transition being measured.
  const SKIP = new Set(['Penthouse', 'Lift', 'Lobby', 'Street', 'Driving', 'Corner market']);
  const pressC = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', bubbles: true }));
  await new Promise((resolve) => {
    let advancing = false;
    let startedRide = false;
    const tick = () => {
      const now = performance.now();
      deltas.push({ d: now - last, ts: now - t0 });
      last = now;
      const title = m.corridor.stats.title;
      const prevLeg = legs.length ? legs[legs.length - 1].title : null;
      if (title !== prevLeg) legs.push({ title, at: Math.round(now - t0) });
      const ascendNow = title === 'Lift' && prev === 'HQ lobby';
      if (ascendNow && ride.start === null) ride.start = now - t0;
      if (ride.start !== null && title === 'Mission Control') ride.end = now - t0;
      if (!advancing && !startedRide && !ascendNow && (SKIP.has(title) || title === 'HQ lobby')) {
        advancing = true;
        if (title === 'HQ lobby') startedRide = true;
        pressC();
        setTimeout(() => { advancing = false }, 150);
      }
      prev = title;
      if (ride.end !== null || now - t0 > tMax) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return {
    rideMs: ride.start !== null && ride.end !== null ? Math.round(ride.end - ride.start) : null,
    legs,
    deltas,
    ended: m.corridor.stats.title,
    measuredMs: Math.round(performance.now() - t0),
  };
})()`

/** Install per-frame render() timing + scene actor counters (Manhattan only). */
const INSTALL_MEASURE = `(async () => {
  const m = window.__manhattan;
  if (m && !window.__renderTimingInstalled) {
    const r = m.renderer.render.bind(m.renderer);
    const rt = { acc: 0, n: 0, max: 0 };
    m.renderer.render = (sc, cam) => {
      const t = performance.now();
      r(sc, cam);
      const d = performance.now() - t;
      rt.acc += d; rt.n++; if (d > rt.max) rt.max = d;
    };
    window.__renderTimingInstalled = true;
    window.__renderTiming = rt;
  }
  return true;
})()`

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
    let skinned = 0, morph = 0, meshes = 0;
    try {
      m.scene.traverse((o) => {
        if (o.isSkinnedMesh) skinned++;
        if (o.morphTargetInfluences && o.morphTargetInfluences.length) morph++;
        if (o.isMesh) meshes++;
      });
    } catch {}
    const rt = window.__renderTiming;
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
      actors: { skinnedMeshes: skinned, morphTargetMeshes: morph, totalMeshes: meshes },
      renderMs: rt && rt.n ? { avg: +(rt.acc / rt.n).toFixed(3), max: +rt.max.toFixed(3), frames: rt.n } : null,
    };
  })()`
}

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

// Some presets compile shaders or stream assets a few seconds after the
// fixed warmup (measured: a ~4.5 s stall 8 s after load on the medium
// preset). A sample containing a >1 s stall measures loading, not steady
// state, so discard it and take another. Transitions and soaks keep stalls
// (they are the point).
async function steadySample(page, seconds, moving) {
  let sample = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    sample = await evaluate(page, samplerScript(seconds * 1000))
    const stalled = (sample.deltas || []).filter((d) => d.d > 1000).length
    if (!stalled || attempt === 3) return { ...sample, stalledWarmups: attempt - 1 }
    if (moving) await key(page, 'ShiftLeft', false)
    await sleep(3000)
    if (moving) await key(page, 'ShiftLeft', true)
  }
  return { ...sample, stalledWarmups: 2 }
}

// ----------------------------------------------------------------- main ----

async function runPass({ page, app, url, location, scenario, seconds, quality, passIdx, pass1Png }) {
  const gpu = await evaluate(page, gpuProbeExpr())
  let sample = null
  let stats = null
  let moving = false
  let transition = null
  let buckets = null

  if (app === 'shenron') {
    const view = LOCATIONS[location].view || location
    await navigate(page, `${url}/?spawn=${view}&inspect=1&quality=${quality}`)
    await waitFor(page, 60000, async () => {
      const r = await evaluate(page, `document.querySelectorAll('canvas').length`)
      return r > 0
    })
    if (scenario === 'zone') return { skip: true, why: 'zone not implemented for shenron' }
    await sleep(8000) // asset streaming + shader compile window (see setup notes)
    moving = scenario === 'walk' || scenario === 'sprint'
    if (moving) {
      await key(page, 'KeyW', true)
      if (scenario === 'sprint') await key(page, 'ShiftLeft', true)
      await sleep(500)
    }
    if (scenario === 'soak') {
      sample = await evaluate(page, samplerScript(seconds * 1000))
      buckets = bucketFrames(sample.deltas, 60000)
    } else {
      sample = await steadySample(page, seconds, moving)
    }
    if (moving) {
      await key(page, 'ShiftLeft', false)
      await key(page, 'KeyW', false)
    }
  } else {
    await navigate(page, url)
    await waitFor(page, 60000, async () => {
      const r = await evaluate(page, `!!window.__manhattan`)
      return r
    })
    await evaluate(page, INSTALL_MEASURE)
    if (scenario === 'elevator') {
      sample = await evaluate(page, ELEVATOR_SCRIPT)
      transition = { rideMs: sample.rideMs, legs: sample.legs, ended: sample.ended }
      sample = { ...sample, deltas: sample.deltas || [] }
      stats = await evaluate(page, manhattanSnapshotExpr())
    } else {
      const setup = manhattanSetupExpr(location, scenario)
      const r = await evaluate(page, setup)
      if (!r.ok) throw new Error(`capture setup failed: ${r.why}`)
      if (scenario === 'soak') {
        sample = await evaluate(page, samplerScript(seconds * 1000))
        buckets = bucketFrames(sample.deltas, 60000)
      } else {
        sample = await steadySample(page, seconds, false)
      }
      stats = await evaluate(page, manhattanSnapshotExpr())
    }
  }

  const before = await screenshot(page)

  // screenshot integrity: hash + luminance bands, and (pass > 1) frame diff
  // against pass 1 — a moving camera changes the image; a claim of "same
  // camera" needs a diff this small.
  const decoded = decodePng(before)
  const integrity = {
    sha256: sha256(before),
    luminanceBands4x4: luminanceBands(decoded, 4),
    pngBytes: before.length,
  }
  if (passIdx > 1 && pass1Png) {
    integrity.diffVsPass1 = frameDiff(pass1Png, decoded)
  }

  return {
    sample,
    stats,
    gpu,
    before,
    decoded,
    transition,
    buckets,
    integrity,
    errors: null,
    cpu: null,
  }
}

async function main() {
  const args = parseArgs()
  trace("main start " + JSON.stringify({ app: args.app, location: args.location, scenario: args.scenario }))
  const { app, location, scenario } = args
  if (!LOCATIONS[location]) throw new Error(`unknown location ${location}`)
  if (LOCATIONS[location].app !== app) {
    throw new Error(`location ${location} belongs to app ${LOCATIONS[location].app}, not ${app}`)
  }
  if (scenario === 'soak' && args.seconds === 10) args.seconds = 600

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
  let pass1Decoded = null
  try {
    for (let p = 0; p < args.passes; p++) {
      trace("runPass start")
      page.events.length = 0 // fresh error bucket for this pass
      const cpuBefore = await page.send('Performance.getMetrics')
      const result = await runPass({
        page, app, url, location, scenario,
        seconds: args.seconds, quality: args.quality,
        passIdx: p + 1, pass1Png: pass1Decoded,
      })
      if (result.skip) continue
      const cpuAfter = await page.send('Performance.getMetrics')
      const errors = classifyErrorEvents(page.events)
      const cpu = await cpuMetricsDelta(page, cpuBefore.metrics, cpuAfter.metrics, args.seconds)

      const summary = summarizeFrames(result.sample.deltas.map((d) => d.d))
      const pass = {
        pass: p + 1,
        app, location, scenario,
        quality: app === 'shenron' ? args.quality : null,
        startedAtUtc: new Date().toISOString(),
        measuredMs: result.sample.measuredMs,
        stats: summary,
        longTasks: result.sample.longTasks,
        heapUsedMB: result.sample.heap,
        loadMs: result.sample.loadMs,
        appStats: result.stats,
        gpu: result.gpu,
        transition: result.transition,
        buckets: result.buckets,
        integrity: result.integrity,
        cpu: cpu,
        errors: errors,
      }
      passes.push(pass)
      fs.writeFileSync(
        path.join(args.out, `${tag}-pass${p + 1}.json`),
        JSON.stringify(pass, null, 2))
      fs.writeFileSync(path.join(args.out, `${tag}-pass${p + 1}.png`), result.before)
      if (p === 0) pass1Decoded = result.decoded
      console.log(`[${tag}] pass ${p + 1}: avg ${summary.fps.avg.toFixed(1)} fps, ` +
        `p1 ${summary.fps.p1.toFixed(1)}, p0.1 ${summary.fps.p01.toFixed(1)}, ` +
        `dead ${summary.deadFrames}, draws ${result.stats?.drawCalls ?? 'n/a'}, ` +
        `tris ${result.stats?.triangles ?? 'n/a'}, cpu ${cpu?.scriptMsPerSec ?? 'n/a'} ms/s` +
        (result.transition?.rideMs ? `, ride ${result.transition.rideMs} ms` : '') +
        `, err ${errors.consoleErrors + errors.exceptions + errors.networkFailures}`)
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
      heapUsedMB: p.heapUsedMB?.length ? p.heapUsedMB[p.heapUsedMB.length - 1].mb : 0,
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
