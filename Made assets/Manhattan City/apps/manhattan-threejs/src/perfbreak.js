// perfbreak.js — dev-only per-subsystem attribution of the street-life block.
//
// Not imported by main.js. The Phase 2O-B runner (scripts/qa/2o-b-perf-run.mjs)
// imports this on demand against the running app, exactly like bench.js, so
// every number is produced by the real sims at a real camera. Purpose: the
// disputed street-life CPU claim (HANDOFF §1: "~0.4 ms/frame", re-measured at
// 0.8 ms in Phase 2O-A). Which subsystem owns the measured time?
//
// Two call patterns are measured, both with the bench's one-update(1/30) per
// subsystem semantics:
//
//   streetLifeBlock   the exact bench.streetLifeMs() sequence: props is
//                     *forced* to rebuild (the bench passes force=true), so
//                     this reproduces the 0.8 ms number and splits it.
//   mainLoopSims      the sequence the real frame loop runs at a static
//                     camera: props.update(camera) (early-out, no force),
//                     subway (early-out), traffic, crowd, weather, interiors,
//                     corridor (inactive), plus audio.update and
//                     renderer.render as main.js calls them. This is the
//                     honest per-frame sim cost at the disputed camera.
//
// Each measurement is taken in the same subsystem order the frame loop uses.
// Per-subsystem samples are timed with performance.now() around a single
// synchronous update; the whole block is timed separately on its own frames
// (no interleaved timers), so the block total is not inflated by the timer
// overhead the breakdown carries.

import { median, pctl } from './bench.js'

const fmt4 = (n) => +Number(n).toFixed(4)

function app() {
  const m = window.__manhattan
  if (!m || !m.renderer) {
    throw new Error('perfbreak: window.__manhattan not ready')
  }
  return m
}

function summarize(name, samples) {
  return {
    name,
    n: samples.length,
    medianMs: fmt4(median(samples)),
    p95Ms: fmt4(pctl(samples, 0.95)),
    meanMs: fmt4(samples.reduce((a, b) => a + b, 0) / samples.length),
  }
}

const SUBS = ['props', 'subway', 'traffic', 'crowd', 'weather', 'interiors',
  'corridor', 'audio', 'render']

// One measured pass: warm nWarm frames, then n frames of the block. Returns
// the per-subsystem samples plus the whole-block samples.
export function streetLifeBreakdown({
  n = 60, dt = 1 / 30, warm = 10,
  forceProps = true, includeAudio = true,
} = {}) {
  const m = app()
  const { scene, camera, renderer } = m
  const acc = { props: [], subway: [], traffic: [], crowd: [], weather: [],
    interiors: [], corridor: [], audio: [], render: [], block: [] }

  const step = (t, f) => { const a = performance.now(); f(); acc[t].push(performance.now() - a) }
  const block = () => {
    m.props.update(camera, forceProps)
    m.subway.update(camera)
    m.traffic.update(dt, camera)
    m.crowd.update(dt, camera)
    m.weather.update(dt, camera)
    m.interiors.update(camera)
    m.corridor.update(dt)
  }
  const audioArgs = () => ({ camera, traffic: m.traffic, crowd: m.crowd,
    weather: m.weather, controls: m.controls })

  for (let i = 0; i < warm; i++) block()

  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    m.props.update(camera, forceProps)
    acc.props.push(performance.now() - t0)
    step('subway', () => m.subway.update(camera))
    step('traffic', () => m.traffic.update(dt, camera))
    step('crowd', () => m.crowd.update(dt, camera))
    step('weather', () => m.weather.update(dt, camera))
    step('interiors', () => m.interiors.update(camera))
    step('corridor', () => m.corridor.update(dt))
    if (includeAudio) {
      step('audio', () => m.audio.update(dt, audioArgs()))
      step('render', () => renderer.render(scene, camera))
    }
    acc.block.push(performance.now() - t0)
  }

  // the same block again, but timed whole (no interleaved timers)
  const whole = []
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    block()
    whole.push(performance.now() - t0)
  }

  return {
    mode: forceProps ? 'streetLifeBlock (bench streetLifeMs pattern)'
      : 'mainLoopSims (real main-loop calls at a static camera)',
    includeAudio,
    dt,
    whole: summarize('block', whole),
    subs: SUBS.map((s) => summarize(s, acc[s])),
    counts: {
      vehicles: m.traffic.stats.vehicles,
      people: m.crowd.stats.people,
      propsDrawn: m.props.stats.drawn,
      trafficSimLanes: m.traffic.stats.simLanes,
      crowdSimLanes: m.crowd.stats.simLanes,
      corridorActive: m.corridor.active,
      audioCtxRunning: !!(m.audio && m.audio.ctx),
      camera: {
        x: fmt4(camera.position.x), y: fmt4(camera.position.y),
        z: fmt4(camera.position.z),
      },
    },
  }
}

// The single-number reproduction of bench.streetLifeMs(), sampled k times, so
// the disputed claim is re-measured exactly as Phase 2O-A measured it.
export function streetLifeSamples(k = 20) {
  const m = app()
  const out = []
  const dt = 1 / 30
  for (let i = 0; i < k; i++) {
    const t0 = performance.now()
    m.props.update(m.camera, true)
    m.subway.update(m.camera)
    m.traffic.update(dt, m.camera)
    m.crowd.update(dt, m.camera)
    m.weather.update(dt, m.camera)
    m.interiors.update(m.camera)
    m.corridor.update(dt)
    out.push(performance.now() - t0)
  }
  return {
    n: out.length,
    medianMs: fmt4(median(out)),
    p95Ms: fmt4(pctl(out, 0.95)),
    meanMs: fmt4(out.reduce((a, b) => a + b, 0) / out.length),
    samples: out,
  }
}

// Inside traffic.update: quantify the one per-frame cost that varies — the
// spawn top-up (the only O(n log n) + alloc block in the street-life sims).
// Runs the *real* update() and times it under two population states:
//
//   steady   the population is full (as at the disputed camera): the top-up
//            block runs only when despawn churn drops the count below want.
//   drained  vehicles emptied once; every subsequent update runs the full
//            top-up until the street refills — the worst case for that block.
//
// The difference between the two medians is what the spawn top-up costs when
// it does run; steady's p95 shows how often churn triggers it anyway.
export function trafficInternals(n = 60, dt = 1 / 30) {
  const m = app()
  const t = m.traffic
  const steady = []
  for (let i = 0; i < n; i++) {
    const a = performance.now()
    t.update(dt, m.camera)
    steady.push(performance.now() - a)
  }
  const drained = []
  t.vehicles = []
  for (let i = 0; i < n; i++) {
    const a = performance.now()
    t.update(dt, m.camera)
    drained.push(performance.now() - a)
  }
  const counts = { steady: t.stats.vehicles }
  // refill from the drained state so the caller leaves the street as found
  for (let i = 0; i < 90; i++) t.update(dt, m.camera)
  counts.refilled = t.stats.vehicles
  return {
    steady: summarize('traffic.update, full street', steady),
    drained: summarize('traffic.update, refilling after empty', drained),
    counts,
    note: 'same real Traffic.update() in both; the drained run forces the ' +
      'spawn top-up (withDist sort over ~680 lanes + occupancy Map) to run ' +
      'every frame until the street refills. Difference = worst case for ' +
      'that block; steady p95 = how often churn triggers it at the camera.',
  }
}
