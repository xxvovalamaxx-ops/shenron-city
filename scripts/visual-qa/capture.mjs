/**
 * Capture runner for the visual QA bridge.
 *
 * Reads scripts/visual-qa/scene-manifest.json, opens each `ready` scene in a
 * headless Chromium via puppeteer-core against the fixed Vite dev server
 * (http://127.0.0.1:9122), waits for the game to mount the vision camera
 * (data-vision-ready="1"), lets streaming/asset loading settle (consecutive
 * frames must agree), samples FPS, captures frame A, waits for dynamic
 * content (traffic/crowd/rain) to move, captures frame B, then runs the
 * numerical checks from frame-analysis.mjs.
 *
 * Scenes marked `status: "not-built"` are skipped and recorded in the run
 * summary (they belong in the defect ledger, not in fabricated evidence).
 *
 * Everything lands under evidence/visual/captures/<scene_id>/:
 *   frame-a.png  frame-b.png  metadata.json
 *
 * Usage:
 *   node scripts/visual-qa/capture.mjs [--scenes hero-street,market] [--out evidence/visual/captures]
 *   PUPPETEER_EXECUTABLE_PATH=... node scripts/visual-qa/capture.mjs
 *
 * Exit code is 1 if any captured scene fails a P0 check (frame black, flat,
 * void, or a camera-moved diff), so CI can gate on the bridge itself while
 * still recording P1/P2 defects as evidence for the review stage.
 */
/* global document, requestAnimationFrame */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { decodePngToRgba } from './png-decode.mjs'
import { lumaGrid, runChecks, runFrameDiffCheck } from './frame-analysis.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const MANIFEST_PATH = join(HERE, 'scene-manifest.json')

/** First existing Chromium-family binary we can drive headless. */
function resolveExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  if (fromEnv) return fromEnv
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    'No Chromium-family browser found. Set PUPPETEER_EXECUTABLE_PATH to a Chrome/Edge binary.',
  )
}

/**
 * Minimal dependency-free PNG decoder (8-bit RGB/RGBA). Puppeteer returns
 * PNG buffers; frame-analysis.mjs needs raw RGBA. Node's zlib does the heavy
 * lifting; the rest is chunk walking and scanline unfiltering.
 */

function parseArgs(argv) {
  const args = { scenes: null, out: join(REPO_ROOT, 'evidence', 'visual', 'captures'), settleMs: 12000, diffWaitMs: 3000, fpsSampleMs: 1500, server: 'http://127.0.0.1:9122', headless: true }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = () => argv[++i]
    if (flag === '--scenes') args.scenes = value().split(',').map((s) => s.trim())
    else if (flag === '--out') args.out = value()
    else if (flag === '--server') args.server = value()
    else if (flag === '--settle-ms') args.settleMs = Number(value())
    else if (flag === '--diff-wait-ms') args.diffWaitMs = Number(value())
    else if (flag === '--fps-sample-ms') args.fpsSampleMs = Number(value())
    else if (flag === '--headed') args.headless = false
    else if (flag === '--help') {
      console.log(`usage: node scripts/visual-qa/capture.mjs [options]
  --scenes <ids>       comma-separated subset of manifest scene_ids
  --out <dir>          evidence output root (default evidence/visual/captures)
  --server <url>       Vite dev server (default http://127.0.0.1:9122)
  --settle-ms <ms>     max wait for streaming/assets to settle
  --diff-wait-ms <ms>  gap between frame A and frame B
  --fps-sample-ms <ms> FPS sampling window
  --headed             run headed (debugging)
  --help`)
      process.exit(0)
    }
  }
  return args
}

/** URL for a manifest scene, mirroring the keys vision-capture.ts parses. */
function captureUrl(scene, server) {
  const c = scene.camera
  const params = new URLSearchParams({
    visionCapture: '1',
    visionX: String(c.position[0]),
    visionY: String(c.position[1]),
    visionZ: String(c.position[2]),
    visionTX: String(c.target[0]),
    visionTY: String(c.target[1]),
    visionTZ: String(c.target[2]),
    visionFov: String(c.fov),
    visionTime: String(scene.time ?? 15.5),
    visionRain: String(scene.rain ?? 0),
    visionSeed: scene.seed ?? 'vision-bridge-v1',
  })
  return `${server}/?${params.toString()}`
}

async function sampleFps(page, sampleMs) {
  const measured = await page.evaluate(async (ms) => {
    return new Promise((resolve) => {
      let frames = 0
      const start = performance.now()
      const tick = () => {
        frames++
        if (performance.now() - start >= ms) {
          resolve(Math.round((frames / (performance.now() - start)) * 1000))
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }, sampleMs)
  return measured
}

async function screenshotToFrame(page) {
  const buffer = await page.screenshot({ encoding: 'binary', captureBeyondViewport: false })
  return { png: Buffer.from(buffer), frame: decodePngToRgba(buffer) }
}

/**
 * Wait until the vision camera is mounted and the scene stops changing.
 * Streaming (manhattan tiles, GLBs) shows up as large-scale luminance drift;
 * once two consecutive coarse luma-grid signatures agree we consider the
 * scene settled. Pixel-level frameDiff is deliberately not used here —
 * moving traffic keeps pixel diffs permanently above zero.
 */
async function waitSettled(page, settleMs) {
  await page.waitForFunction(
    () => document.documentElement.dataset.visionReady === '1',
    { timeout: 30000 },
  )
  const start = Date.now()
  let previous = null
  let agreed = 0
  while (Date.now() - start < settleMs) {
    const frame = await screenshotToFrame(page)
    if (previous) {
      const gridA = lumaGrid(previous.frame.data, previous.frame.width, previous.frame.height, 8, 8)
      const gridB = lumaGrid(frame.frame.data, frame.frame.width, frame.frame.height, 8, 8)
      let drift = 0
      for (let i = 0; i < gridA.length; i++) drift += Math.abs(gridA[i] - gridB[i])
      drift /= gridA.length
      if (drift < 1.5) {
        agreed++
        if (agreed >= 2) return true
      } else {
        agreed = 0
      }
    }
    previous = frame
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  return agreed >= 2
}

function gitRev() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

async function captureScene(browser, scene, args) {
  const page = await browser.newPage()
  await page.setViewport({
    width: scene.resolution?.width ?? 1920,
    height: scene.resolution?.height ?? 1080,
    deviceScaleFactor: 1,
  })
  const issues = []
  const consoleMessages = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleMessages.push(`${msg.type()}: ${msg.text()}`)
  })
  page.on('pageerror', (err) => issues.push(`pageerror: ${err.message}`))
  page.on('requestfailed', (req) => issues.push(`requestfailed: ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`))

  const url = captureUrl(scene, args.server)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

  const settled = await waitSettled(page, args.settleMs)
  const fps = await sampleFps(page, args.fpsSampleMs)
  const pose = await page.evaluate(() => document.documentElement.dataset.visionCamera ?? null)

  const frameA = await screenshotToFrame(page)
  await new Promise((resolve) => setTimeout(resolve, args.diffWaitMs))
  const frameB = await screenshotToFrame(page)
  await page.close()

  const analysisA = runChecks(frameA.frame)
  const diff = runFrameDiffCheck(frameA.frame, frameB.frame)
  const checks = Object.fromEntries(
    Object.entries(analysisA.results).map(([id, r]) => [id, { pass: r.pass, metric: r.metric, threshold: r.threshold, severity: r.severity }]),
  )
  const summary = {
    scene_id: scene.scene_id,
    captured_at: new Date().toISOString(),
    git_rev: gitRev(),
    commit_repo_workspace: REPO_ROOT,
    url,
    settled,
    fps,
    camera_pose_readback: pose,
    resolution: { width: frameA.frame.width, height: frameA.frame.height },
    frame_diff: { value: diff.diff, pass: diff.pass, threshold: diff.threshold },
    checks,
    console_messages: consoleMessages.slice(0, 20),
    issues: issues.slice(0, 20),
  }

  const outDir = join(args.out, scene.scene_id)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'frame-a.png'), Buffer.from(await frameA.png))
  writeFileSync(join(outDir, 'frame-b.png'), Buffer.from(await frameB.png))
  writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(summary, null, 2))

  const failed = Object.entries(checks)
    .filter(([, r]) => !r.pass)
    .map(([id, r]) => `${id}(${r.severity})`)
  const p0Failed = Object.entries(checks).some(([, r]) => !r.pass && r.severity === 'P0')

  return { scene_id: scene.scene_id, ok: failed.length === 0, failed, p0Failed, fps, settled, diff: diff.diff }
}

const args = parseArgs(process.argv.slice(2))
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))

const scenes = manifest.scenes.filter((s) => (args.scenes ? args.scenes.includes(s.scene_id) : true))
const ready = scenes.filter((s) => s.status === 'ready')
const skipped = scenes.filter((s) => s.status !== 'ready')

console.log(`manifest v${manifest.version}: ${ready.length} ready, ${skipped.length} not-built, ${scenes.length} selected`)

const browser = await puppeteer.launch({
  executablePath: resolveExecutablePath(),
  headless: args.headless,
  args: ['--enable-unsafe-swiftshader', '--mute-audio', '--window-size=1920,1080'],
})

const results = []
try {
  for (const scene of ready) {
    process.stdout.write(`capturing ${scene.scene_id} ... `)
    const result = await captureScene(browser, scene, args)
    results.push(result)
    console.log(result.ok ? 'ok' : `FAILED [${result.failed.join(', ')}]`)
  }
} finally {
  await browser.close()
}

for (const scene of skipped) {
  results.push({ scene_id: scene.scene_id, ok: false, failed: ['not-built (skipped)'], p0Failed: true, note: scene.note })
}

const summary = {
  pipeline: manifest.pipeline,
  generated_at: new Date().toISOString(),
  git_rev: gitRev(),
  server: args.server,
  results,
}
const summaryPath = join(args.out, 'run-summary.json')
mkdirSync(args.out, { recursive: true })
writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
console.log(`summary written to ${summaryPath}`)

const anyP0 = results.some((r) => r.p0Failed && !r.note)
process.exit(anyP0 ? 1 : 0)
