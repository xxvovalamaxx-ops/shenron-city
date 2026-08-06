/**
 * Phase 3C perf A/B: night-variant vs day-variant, in-page, settle-gated.
 *
 * Same page, same camera, same content: the scene is gated to the same
 * "settled" condition as the capture pipeline (two consecutive agreeing
 * luma-grid probes), then the compiled CITY_NIGHT variant flips in place.
 * Nothing else changes, so the fps delta is exactly the cost of the
 * lighting shaders. The settle gate also makes the variant screenshots a
 * valid off-state check: at 14:00 the two programs must be pixel-near-
 * identical, at 02:00 they differ by the windows themselves.
 *
 * Output: evidence/performance/phase3c/city-lighting-ab.json
 */
/* global document, requestAnimationFrame, window */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { existsSync } from 'node:fs'
import { decodePngToRgba } from './png-decode.mjs'
import { frameDiff, lumaGrid } from './frame-analysis.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const OUT = join(REPO, 'evidence', 'performance', 'phase3c')

const CHROME =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const SCENES = [
  { id: 'manhattan-night-0200', time: 2, pos: [300, 13.7, 300], tgt: [280, 8, 260] },
  { id: 'manhattan-day-1400', time: 14, pos: [300, 13.7, 300], tgt: [280, 8, 260] },
  { id: 'manhattan-night-aerial', time: 2, pos: [900, 380, -2600], tgt: [700, 0, -1600] },
]

function url(scene) {
  const [x, y, z] = scene.pos
  const [tx, ty, tz] = scene.tgt
  const p = new URLSearchParams({
    visionCapture: '1',
    visionX: String(x), visionY: String(y), visionZ: String(z),
    visionTX: String(tx), visionTY: String(ty), visionTZ: String(tz),
    visionFov: '60',
    visionTime: String(scene.time),
    visionRain: '0',
    visionSeed: 'phase3c-ab',
  })
  return `http://127.0.0.1:9122/?${p.toString()}`
}

async function waitSettled(page, settleMs = 60000) {
  await page.waitForFunction(
    () => document.documentElement.dataset.visionReady === '1',
    { timeout: 60000 },
  )
  const start = Date.now()
  let previous = null
  let agreed = 0
  while (Date.now() - start < settleMs) {
    const probe = decodePngToRgba(
      Buffer.from(await page.screenshot({ encoding: 'binary', clip: { x: 0, y: 0, width: 960, height: 540 } })),
    )
    if (previous) {
      const a = lumaGrid(previous.data, previous.width, previous.height, 8, 8)
      const b = lumaGrid(probe.data, probe.width, probe.height, 8, 8)
      let drift = 0
      for (let i = 0; i < a.length; i++) drift += Math.abs(a[i] - b[i])
      drift /= a.length
      if (drift < 1.5) {
        agreed++
        if (agreed >= 3) return true
      } else {
        agreed = 0
      }
    }
    previous = probe
    await new Promise((r) => setTimeout(r, 750))
  }
  return agreed >= 3
}

async function sampleFps(page, ms) {
  return page.evaluate(async (dur) => {
    return await new Promise((resolve) => {
      let frames = 0
      const start = performance.now()
      const tick = () => {
        frames++
        if (performance.now() - start >= dur) {
          resolve(Math.round((frames / (performance.now() - start)) * 1000))
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }, ms)
}

const browser = await puppeteer.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--mute-audio',
    '--window-size=1920,1080',
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
  ],
})

const results = []
try {
  for (const scene of SCENES) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
    await page.goto(url(scene), { waitUntil: 'domcontentloaded', timeout: 60000 })
    const settled = await waitSettled(page)
    await new Promise((r) => setTimeout(r, 3000))

    const shots = {}
    const fpsByVariant = { night: [], day: [] }
    const order = [['night', 'day'], ['day', 'night']]
    for (let pass = 0; pass < 2; pass++) {
      for (const mode of order[pass]) {
        await page.evaluate((m) => {
          window.__setCityNightMode(m === 'night')
          window.__cityLighting.uCityPractical.value = m === 'night' ? 1 : 0
        }, mode)
        await new Promise((r) => setTimeout(r, 2000))
        const samples = []
        for (let s = 0; s < 3; s++) samples.push(await sampleFps(page, 3000))
        fpsByVariant[mode].push(...samples)
        shots[mode] = decodePngToRgba(
          Buffer.from(await page.screenshot({ encoding: 'binary' })),
        )
      }
    }
    await page.close()

    const nightMax = Math.max(...fpsByVariant.night)
    const dayMax = Math.max(...fpsByVariant.day)
    results.push({
      scene: scene.id,
      settled,
      nightMaxFps: nightMax,
      dayMaxFps: dayMax,
      nightFpsAll: fpsByVariant.night.sort((a, b) => a - b),
      dayFpsAll: fpsByVariant.day.sort((a, b) => a - b),
      visualDiffLuma: +frameDiff(shots.night, shots.day).toFixed(3),
    })
  }
} finally {
  await browser.close()
}

const summary = {
  pipeline: 'Phase 3C city-lighting A/B (in-page variant flip, settle-gated)',
  generated_at: new Date().toISOString(),
  method:
    'One page load per scene; scene gated to the capture-pipeline settle condition; the compiled CITY_NIGHT variant flips in place with nothing else changing. fps = max of 6 x 3s rAF samples per variant. visualDiffLuma is the same-content frame diff between the two variants: at 14:00 it must be ~0 (daytime off-state), at 02:00 it is the windows themselves.',
  scenes: {},
}

for (const r of results) {
  const on = r.nightMaxFps
  const off = r.dayMaxFps
  const frameTimeOn = 1000 / on
  const frameTimeOff = 1000 / off
  const regression = ((frameTimeOn - frameTimeOff) / frameTimeOff) * 100
  summary.scenes[r.scene] = {
    fpsOn: on,
    fpsOff: off,
    frameTimeOnMs: +frameTimeOn.toFixed(2),
    frameTimeOffMs: +frameTimeOff.toFixed(2),
    frameTimeRegressionPct: +regression.toFixed(2),
    allFpsOn: r.nightFpsAll,
    allFpsOff: r.dayFpsAll,
    visualDiffLuma: r.visualDiffLuma,
    settled: r.settled,
  }
  console.log(
    `${r.scene} (settled=${r.settled}): night ${on} fps vs day ${off} fps -> ` +
      `regression ${regression.toFixed(2)}% (visual diff ${r.visualDiffLuma} luma)`,
  )
}

mkdirSync(OUT, { recursive: true })
const path = join(OUT, 'city-lighting-ab.json')
writeFileSync(path, JSON.stringify(summary, null, 2))
console.log(`written to ${path}`)
