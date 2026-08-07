// bench.js — dev-only measurement harness for Phase 2O-A.
//
// Not imported by main.js. The headless runner (scripts/qa/bench-run.mjs)
// imports this module on demand and calls the functions below against the
// running app (window.__manhattan), so every number here is produced by the
// real renderer at a real camera rather than asserted.
//
// The pure parts (projection, percentiles, camera derivation) are exported
// with no DOM dependency so scripts/qa/bench.test.mjs can run them under
// node --test. Everything that touches the app reads window.__manhattan at
// call time.

export const LAT0 = 40.78
export const LON0 = -73.968
export const M_LAT = 110574.0
export const M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180)

// --- pure helpers ----------------------------------------------------------

// capture.js uses these same constants; the copy here is deliberate so the
// bench does not have to import the app's modules.
export function proj(lat, lon) {
  return [(lon - LON0) * M_LON, (lat - LAT0) * M_LAT]
}

export function median(a) {
  return pctl(a, 0.5)
}

export function pctl(a, p) {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  const ix = Math.min(s.length - 1, Math.max(0, p * (s.length - 1)))
  const lo = Math.floor(ix)
  const hi = Math.ceil(ix)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (ix - lo)
}

export function p95(a) {
  return pctl(a, 0.95)
}

// A SHOTS-style spec [lat, lon, alt, yaw, pitch, mode] -> world eye and at.
export function specToEyeAt(spec) {
  const [lat, lon, alt, yaw, pitch] = spec
  const [xM, yM] = proj(lat, lon)
  const eye = [xM, 12.0 + alt, -yM]
  // world forward for yaw a is (-sin a, 0, -cos a)
  const fwd = [-Math.sin(yaw), 0, -Math.cos(yaw)]
  return {
    eye,
    at: [eye[0] + fwd[0] * 500, eye[1] + Math.tan(pitch) * 500, eye[2] + fwd[2] * 500],
    yaw,
    pitch,
  }
}

// Battery Park, the south-west tip of the island, checked against the world
// extent data (city.json meta.bounds) so a stale coordinate cannot silently
// land the camera offshore.
export function batterySpec(bounds) {
  const [xM, yM] = proj(40.7003, -74.0158)
  const inside = bounds &&
    xM >= bounds.x[0] && xM <= bounds.x[1] &&
    yM >= bounds.y[0] && yM <= bounds.y[1]
  return {
    name: 'battery_1500',
    lat: 40.7003, lon: -74.0158, alt: 1500,
    eye: [xM, 1500, -yM],
    at: [xM + 200, 0, -yM + 6500],
    insideExtent: !!inside,
  }
}

// --- app-facing helpers ----------------------------------------------------

function app() {
  const m = window.__manhattan
  if (!m || !m.renderer) {
    throw new Error('bench: window.__manhattan not ready')
  }
  return m
}

function fmt4(n) {
  return +Number(n).toFixed(4)
}

// Render N frames at the current camera. CPU ms is measured in synchronous
// chunks so the app's own rAF loop cannot interleave (JS is single-threaded);
// GPU ms comes from EXT_disjoint_timer_query_webgl2 when the driver has it.
export async function measureFrames({
  n = 60, chunk = 6, warmup = 3, label = 'frame',
} = {}) {
  const m = app()
  const { renderer, scene, camera } = m
  const gl = renderer.getContext()
  const info = renderer.info

  // per-frame renderer.info: reset, one render, read
  info.reset()
  renderer.render(scene, camera)
  const perFrame = {
    calls: info.render.calls,
    triangles: info.render.triangles,
    points: info.render.points,
    lines: info.render.lines,
  }
  const geometries = info.memory.geometries
  const textures = info.memory.textures
  const programs = (info.programs || []).length

  for (let i = 0; i < warmup; i++) renderer.render(scene, camera)

  const gpuExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') ||
    gl.getExtension('EXT_disjoint_timer_query')
  const gpuTimer = gpuExt ? 'EXT_disjoint_timer_query_webgl2' : 'unavailable'

  const cpuSamples = []
  const queries = []
  let gpuFault = null
  let gpuDropped = false
  for (let c = 0; c < n / chunk; c++) {
    const t0 = performance.now()
    for (let j = 0; j < chunk; j++) {
      if (gpuExt && !gpuDropped) {
        try {
          const q = gl.createQuery()
          gl.beginQuery(gpuExt.TIME_ELAPSED_EXT, q)
          renderer.render(scene, camera)
          gl.endQuery(gpuExt.TIME_ELAPSED_EXT)
          queries.push(q)
        } catch (err) {
          gpuFault = String(err && err.message ? err.message : err)
          gpuDropped = true
          renderer.render(scene, camera)
        }
      } else {
        renderer.render(scene, camera)
      }
    }
    const t1 = performance.now()
    cpuSamples.push((t1 - t0) / chunk)
    // SwiftShader exposes EXT_disjoint_timer_query_webgl2 but never resolves
    // the queries (QUERY_RESULT_AVAILABLE stays false), so GPU time is
    // unavailable on this machine. Poll the first batch once; if it did not
    // resolve within 1.5 s, stop issuing queries and record the drop. The
    // old behaviour then polled every query for up to 3 s each -- ~19.5 s of
    // synchronous busy-wait per camera, enough to destabilise the GPU
    // process (two captures in the first full run rasterised nothing and
    // came back as uniform clear-colour PNGs).
    if (c === 0 && queries.length) {
      const deadline = performance.now() + 1500
      let avail = false
      while (performance.now() < deadline) {
        try {
          if (gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
            avail = true
            break
          }
        } catch {
          break
        }
      }
      if (!avail) gpuDropped = true
    }
  }

  const gpuSamples = []
  if (gpuExt && !gpuDropped) {
    for (const q of queries) {
      const deadline = performance.now() + 3000
      let avail = false
      while (performance.now() < deadline) {
        try {
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
            avail = true
            break
          }
        } catch {
          break
        }
      }
      if (avail) {
        try {
          gpuSamples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6)
        } catch {
          // driver error mid-poll; leave the sample out
        }
      }
      gl.deleteQuery(q)
    }
  }

  // cpuMs above is the wall time of the renderer.render() call on the main
  // thread. With Chrome's command-buffer architecture (and especially with
  // the SwiftShader software GL that runs in the GPU process) most of the
  // rasterization is deferred, so that number is command submission, not the
  // cost of producing the frame. Force the pipeline to finish synchronously
  // by reading the drawing buffer back: render + readPixels blocks until the
  // rasterizer has actually run, which is the honest per-frame cost of this
  // software-GL renderer.
  const rasterSamples = []
  const rasterN = 9
  const rBuf = new Uint8Array(renderer.domElement.width *
    renderer.domElement.height * 4)
  for (let i = 0; i < rasterN; i++) {
    const t0 = performance.now()
    renderer.render(scene, camera)
    gl.readPixels(0, 0, renderer.domElement.width,
      renderer.domElement.height, gl.RGBA, gl.UNSIGNED_BYTE, rBuf)
    rasterSamples.push(performance.now() - t0)
  }

  const memory = {}
  memory.webgl1 = info.memory ? {
    geometries: info.memory.geometries,
    textures: info.memory.textures,
  } : null
  if (performance.memory) {
    memory.performance = {
      usedJSHeapMB: fmt4(performance.memory.usedJSHeapSize / 1048576),
      totalJSHeapMB: fmt4(performance.memory.totalJSHeapSize / 1048576),
    }
  }

  const dims = {
    width: renderer.domElement.width,
    height: renderer.domElement.height,
    pixelRatio: renderer.getPixelRatio(),
  }

  return {
    label,
    camera: {
      x: fmt4(camera.position.x),
      y: fmt4(camera.position.y),
      z: fmt4(camera.position.z),
    },
    dims,
    perFrame,
    geometries,
    textures,
    programs,
    cpuMs: {
      n: cpuSamples.length,
      median: fmt4(median(cpuSamples)),
      p95: fmt4(p95(cpuSamples)),
      mean: fmt4(cpuSamples.reduce((a, b) => a + b, 0) /
        Math.max(1, cpuSamples.length)),
      kind: 'main-thread renderer.render() wall time; command submission, ' +
        'rasterization deferred to the GPU process',
    },
    rasterMs: {
      n: rasterSamples.length,
      median: fmt4(median(rasterSamples)),
      p95: fmt4(p95(rasterSamples)),
      mean: fmt4(rasterSamples.reduce((a, b) => a + b, 0) /
        Math.max(1, rasterSamples.length)),
      kind: 'render + readPixels per frame; forces the SwiftShader rasterizer ' +
        'to finish synchronously (includes the ~3.7 MB readback)',
    },
    gpuMs: gpuSamples.length
      ? {
        n: gpuSamples.length,
        median: fmt4(median(gpuSamples)),
        p95: fmt4(p95(gpuSamples)),
      }
      : null,
    gpuTimer,
    gpuFault,
    gpuDropped: gpuDropped ? {
      reason: 'EXT_disjoint_timer_query_webgl2 exposed but queries never ' +
        'became QUERY_RESULT_AVAILABLE (SwiftShader)',
    } : null,
    memory,
    software: !!renderer.capabilities && renderer.capabilities.isWebGL2 === false
      ? 'webgl1' : 'webgl2',
    note: 'gpuMs only when EXT_disjoint_timer_query_webgl2 exists; ' +
      'software-GL times are not hardware-GPU numbers',
  }
}

// HANDOFF 2O §0.1, item 1: a real frame has stddev > 8 and > 300 distinct
// colours (8-bit per channel). A uniform frame (stddev 0, one colour) is the
// P2-032 / P2-071 dead-frame signature: the capture "succeeded" and wrote a
// PNG that is nothing. Also reports a lost WebGL context, the other way a
// renderer can draw nothing while still counting triangles.
export function frameHealth() {
  const m = app()
  const { renderer, scene, camera } = m
  const gl = renderer.getContext()
  const w = renderer.domElement.width
  const h = renderer.domElement.height
  const contextLost = !!gl.isContextLost && gl.isContextLost()
  renderer.render(scene, camera)
  const buf = new Uint8Array(w * h * 4)
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  let sum = 0
  let sum2 = 0
  let min = 255
  let max = 0
  const c8 = new Set()
  const c4 = new Set()
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i]
    const g = buf[i + 1]
    const b = buf[i + 2]
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sum += l
    sum2 += l * l
    if (l < min) min = l
    if (l > max) max = l
    c8.add((r << 16) | (g << 8) | b)
    c4.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4))
  }
  const n = buf.length / 4
  const mean = sum / n
  const stddev = Math.sqrt(Math.max(0, sum2 / n - mean * mean))
  return {
    w, h,
    meanLuma: +mean.toFixed(2),
    stddev: +stddev.toFixed(2),
    distinctColors8: c8.size,
    distinctColors4: c4.size,
    lumaMin: +min.toFixed(0),
    lumaMax: +max.toFixed(0),
    dead: stddev <= 8 || c8.size < 300,
    contextLost,
  }
}

// Count what is actually in the scene tree.
export function sceneStats(scene) {  let objects = 0
  let meshes = 0
  let instanced = 0
  let instances = 0
  let tris = 0
  const geometries = new Set()
  const materials = new Set()
  scene.traverse((o) => {
    objects++
    if (o.isMesh) {
      meshes++
      const g = o.geometry
      if (g) {
        geometries.add(g)
        tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3
        if (o.isInstancedMesh) {
          instanced++
          instances += o.count
        }
        if (o.material) {
          for (const mt of Array.isArray(o.material) ? o.material : [o.material]) {
            materials.add(mt)
          }
        }
      }
    }
  })
  return {
    objects,
    meshes,
    instancedMeshes: instanced,
    instances,
    triangles: Math.round(tris),
    geometries: geometries.size,
    materials: materials.size,
  }
}

// Resident payload in bytes, read off the streamers' own accounting plus the
// lod manifest for the far-tier files that are actually loaded.
export function residentPayload() {
  const m = app()
  const world = m.streamer.stats.bytes || 0
  const streets = m.streets.stats.bytes || 0
  let lod = 0
  let lodFiles = 0
  if (m.lod && m.lod.manifest && m.lod.tiles) {
    for (const t of m.lod.tiles.values()) {
      for (const tier of ['L2', 'L3', 'L4']) {
        const g = t.groups && t.groups[tier]
        if (!g) continue
        const rec = m.lod.manifest[tier] && m.lod.manifest[tier][t.key]
        lod += rec && rec.bytes ? rec.bytes : 0
        lodFiles++
      }
    }
  }
  return {
    worldMB: fmt4(world / 1048576),
    streetsMB: fmt4(streets / 1048576),
    lodMB: fmt4(lod / 1048576),
    totalMB: fmt4((world + streets + lod) / 1048576),
    lodFiles,
    residentTiles: m.streamer.stats.resident,
    streetTiles: m.streets.stats.resident,
  }
}

// The walk cycle claim: a control render of an identical scene changes 0 px,
// and advancing only the gait phase (positions untouched) changes the frame.
// Returns the two pixel counts and proof the positions were frozen.
export function walkCycleCheck(dt = 1 / 30) {
  const m = app()
  const { renderer, scene, camera, crowd, THREE } = m
  const gl = renderer.getContext()
  const w = renderer.domElement.width
  const h = renderer.domElement.height

  const read = () => {
    renderer.render(scene, camera)
    const buf = new Uint8Array(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    return buf
  }
  const diff = (a, b) => {
    let n = 0
    let nExact = 0
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) > 6 ||
        Math.abs(a[i + 1] - b[i + 1]) > 6 ||
        Math.abs(a[i + 2] - b[i + 2]) > 6
      if (d) n++
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] ||
          a[i + 2] !== b[i + 2]) nExact++
    }
    return { gt6: n, exact: nExact }
  }

  const people = crowd && crowd.people ? crowd.people : []
  if (!people.length) {
    return { error: 'no pedestrians in scope', people: 0 }
  }

  const a = read()
  const b = read()
  const control = diff(a, b)

  // positions frozen: snapshot s and lane per walker
  const before = people.map((p) => [p.s, p.lane, p.dir])
  // phase-only advance: exactly what update() would add to the phase if the
  // walker moved, but the walker does not move.
  for (const p of people) {
    p.phase += (p.v / 0.72) * dt * Math.PI
  }
  crowd._render()
  const c = read()
  const phaseAdvance = diff(b, c)
  const frozen = people.every((p, i) =>
    p.s === before[i][0] && p.lane === before[i][1] && p.dir === before[i][2])

  return {
    people: people.length,
    controlPx: control,
    phaseAdvancePx: phaseAdvance,
    positionsFrozen: frozen,
    phaseRadiansPerTick: fmt4((1.05 / 0.72) * dt * Math.PI),
    tolerance: 'per-channel >6 like hq.verify, plus exact-match count',
  }
}

// The props claim: raycast down from sampled prop records and compare the
// surface height with the pavement top the runtime places them on (12.20 m).
export function propsOnPavement(n = 400) {
  const m = app()
  const { props, THREE } = m
  if (!props || !props.records) return { error: 'no props layer' }
  const ray = new THREE.Raycaster()
  const baseY = 12.2
  const down = new THREE.Vector3(0, -1, 0)
  const colliders = [...m.streamer.pickables(), ...m.streets.pickables()]

  const camX = m.camera.position.x
  const camY = -m.camera.position.z
  const near = []
  for (let i = 0; i < props.count; i++) {
    const o = i * 12
    const x = props.records.getFloat32(o, true)
    const y = props.records.getFloat32(o + 4, true)
    const d = Math.hypot(x - camX, y - camY)
    if (d <= 420) near.push([i, x, y])
  }
  if (near.length < n) return { error: `only ${near.length} props within 420 m` }

  const samples = []
  for (let k = 0; k < n; k++) {
    const [i, x, y] = near[Math.floor((k / n) * near.length)]
    ray.set(new THREE.Vector3(x, 32.2, -y), down)
    ray.firstHitOnly = true
    ray.far = 30
    const hit = ray.intersectObjects(colliders, true)[0]
    if (!hit) {
      samples.push({ i, x, y, surface: null })
      continue
    }
    samples.push({ i, x, y, surface: +hit.point.y.toFixed(3),
      hitName: hit.object.name || hit.object.type })
  }
  const on = samples.filter((s) =>
    s.surface != null && Math.abs(s.surface - baseY) <= 0.05)
  const errs = samples.filter((s) => s.surface != null)
    .map((s) => Math.abs(s.surface - baseY))
  return {
    sampled: samples.length,
    onPavement: on.length,
    notOnPavement: samples.length - on.length,
    noSurface: samples.filter((s) => s.surface == null).length,
    medianSurfaceErrM: errs.length ? fmt4(median(errs)) : null,
    worstSurfaceErrM: errs.length ? fmt4(Math.max(...errs)) : null,
    toleranceM: 0.05,
    pavementTopM: baseY,
    propRecordsTotal: props.count,
  }
}

// The LOD claim: re-sample L2 roof heights against the registry. Loads the
// real L2 glb per sampled tile (the same draco loader the runtime uses),
// raycasts down from above each sampled building's registry height, and
// reports the error distribution.
export async function measureLodL2({ tiles = 20, perTile = 20 } = {}) {
  const m = app()
  const { city, lod, THREE } = m
  if (!lod || !lod.manifest || !lod.manifest.L2) {
    return { error: 'no lod manifest' }
  }
  const grid = lod.manifest.grid_m || 1400
  const keys = Object.keys(lod.manifest.L2)
  // Registry rows are grouped into tiles exactly like 56_build_lods.py does.
  // Context buildings (outer boroughs, water) carry L2 files too, so a tile
  // whose rows are all context has no non-context buildings and is skipped.
  const tileOf = new Map()
  for (let i = 0; i < city.count; i++) {
    if (city.isContext(i) || city.height(i) < 3) continue
    const k = `${Math.floor(city.x(i) / grid) >= 0 ? '+' : '-'}${String(Math.abs(Math.floor(city.x(i) / grid))).padStart(2, '0')}_${Math.floor(city.y(i) / grid) >= 0 ? '+' : '-'}${String(Math.abs(Math.floor(city.y(i) / grid))).padStart(2, '0')}`
    if (!tileOf.has(k)) tileOf.set(k, [])
    tileOf.get(k).push(i)
  }
  // spread tiles across the island, biased to the dense core, keeping only
  // tiles with enough buildings to sample
  const tsq = [-1476, -2433]
  const ranked = keys
    .filter((k) => (tileOf.get(k) || []).length >= perTile)
    .map((k) => {
      const mm = /^([+-]\d+)_([+-]\d+)$/.exec(k)
      const c = [(+mm[1] + 0.5) * grid, (+mm[2] + 0.5) * grid]
      return { k, d: Math.hypot(c[0] - tsq[0], c[1] - tsq[1]) }
    })
    .sort((a, b) => a.d - b.d)
  const step = Math.max(1, Math.floor(ranked.length / tiles))
  const chosen = []
  for (let i = 0; i < ranked.length; i += step) chosen.push(ranked[i].k)
  if (!chosen.length) {
    return { error: 'no L2 tile has enough non-context buildings' }
  }

  const ray = new THREE.Raycaster()
  const down = new THREE.Vector3(0, -1, 0)
  const errs = []
  const perTileReport = []
  let failedFiles = 0
  let worst = null

  for (const key of chosen) {
    const rec = lod.manifest.L2[key]
    const mm = /^([+-]\d+)_([+-]\d+)$/.exec(key)
    const tx = +mm[1]
    const ty = +mm[2]
    const group = await new Promise((resolve) => {
      const gltf = lod.loader.load(`/lod/${rec.file}`, (g) => {
        const grp = new THREE.Group()
        grp.name = `BENCH_L2_${key}`
        grp.add(g.scene)
        m.scene.add(grp)
        grp.updateMatrixWorld(true)
        resolve(grp)
      }, undefined, (err) => {
        failedFiles++
        console.warn('[bench] L2 load failed', rec.file, err)
        resolve(null)
      })
    })
    if (!group) continue

    const wantIdx = tileOf.get(key) || []
    const sstep = Math.max(1, Math.floor(wantIdx.length / perTile))
    let n = 0
    for (let k = 0; k < wantIdx.length; k += sstep) {
      const i = wantIdx[k]
      const x = city.x(i)
      const y = city.y(i)
      const h = city.height(i)
      // Buildings are extruded from y=0 (buried 12 m under the land plane,
      // P2-017), so a roof at registry height h sits at world y = h, and the
      // land offset cancels out of the error either way.
      ray.set(new THREE.Vector3(x, h + 30, -y), down)
      ray.firstHitOnly = true
      ray.far = 60
      const hit = ray.intersectObjects(group.children, true)[0]
      if (!hit) continue
      const err = hit.point.y - h
      errs.push(err)
      n++
      if (!worst || Math.abs(err) > Math.abs(worst.err)) {
        worst = {
          err: +err.toFixed(4),
          tile: key,
          bid: i,
          x: +x.toFixed(1),
          y: +y.toFixed(1),
          registryH: +h.toFixed(2),
          hitY: +hit.point.y.toFixed(3),
          hitObject: hit.object.name || hit.object.type,
          buildingName: city.name(i) || city.address(i) || '',
        }
      }
    }
    perTileReport.push({ key, file: rec.file, buildingsInTile: wantIdx.length,
      samples: n })
    m.scene.remove(group)
    group.traverse((o) => { if (o.isMesh) o.geometry.dispose() })
  }

  const sorted = [...errs].sort((a, b) => a - b)
  return {
    samples: errs.length,
    files: chosen.length,
    failedFiles,
    medianErrM: errs.length ? fmt4(median(errs)) : null,
    p90ErrM: errs.length ? fmt4(pctl(errs, 0.9)) : null,
    maxErrM: errs.length ? fmt4(Math.max(...errs)) : null,
    minErrM: errs.length ? fmt4(Math.min(...errs)) : null,
    worstSample: worst,
    tiles: perTileReport,
    method: 'raycast from registry height+30m onto the tile L2 glb',
  }
}

// Time one real simulation tick (the street-life block), excluding render.
export function streetLifeMs() {
  const m = app()
  const t0 = performance.now()
  m.props.update(m.camera, true)
  m.subway.update(m.camera)
  m.traffic.update(1 / 30, m.camera)
  m.crowd.update(1 / 30, m.camera)
  m.weather.update(1 / 30, m.camera)
  m.interiors.update(m.camera)
  m.corridor.update(1 / 30)
  const t1 = performance.now()
  return {
    streetLifeMs: fmt4(t1 - t0),
    vehicles: m.traffic.stats.vehicles,
    people: m.crowd.stats.people,
    propsDrawn: m.props.stats.drawn,
    note: 'one update(1/30) of each sim, CPU only, render excluded',
  }
}
