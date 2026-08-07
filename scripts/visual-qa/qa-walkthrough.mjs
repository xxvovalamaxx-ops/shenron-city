/* Browser globals below appear inside page.evaluate bodies, which are
   serialised and run in the page, not in Node. */
/* global document, window, HTMLElement, HTMLInputElement, KeyboardEvent */
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const DEFAULT_FFMPEG = 'C:\\Users\\xxvov\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin\\ffmpeg.exe'

function resolveExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  if (fromEnv) return fromEnv
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('No Chromium-family browser found. Set PUPPETEER_EXECUTABLE_PATH.')
}

function parseArgs(argv) {
  const args = {
    out: join(REPO_ROOT, 'evidence', 'visual', 'qa-walkthrough'),
    server: 'http://127.0.0.1:9122',
    headless: false,
    ffmpeg: DEFAULT_FFMPEG,
    width: 1600,
    height: 900,
    fps: 25,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = () => argv[++i]
    if (flag === '--out') args.out = value()
    else if (flag === '--server') args.server = value()
    else if (flag === '--ffmpeg') args.ffmpeg = value()
    else if (flag === '--headless') args.headless = true
    else if (flag === '--width') args.width = Number(value())
    else if (flag === '--height') args.height = Number(value())
    else if (flag === '--help') {
      console.log(`usage: node scripts/visual-qa/qa-walkthrough.mjs [options]
  --out <dir>      output root (default evidence/visual/qa-walkthrough)
  --server <url>   Vite dev server (default http://127.0.0.1:9122)
  --ffmpeg <path>  ffmpeg binary (default: winget Gyan ffmpeg)
  --headless       run headless (software WebGL, lower fps)
  --width, --height  viewport size (default 1600x900)
  --help`)
      process.exit(0)
    }
  }
  return args
}

function gitRev() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function startRecorder(ffmpegPath, outPath, fps) {
  const child = spawn(
    ffmpegPath,
    [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'mjpeg', '-i', 'pipe:0',
      '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outPath,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true },
  )
  let stderr = ''
  child.stderr.on('data', (data) => {
    stderr += data.toString('utf8')
  })
  const closed = new Promise((resolve) => child.once('close', resolve))
  let startTs = null
  let prev = null
  let emitted = 0
  const push = (buffer) => child.stdin.write(buffer)
  const emitGrid = (ts) => {
    const end = Math.round((ts - startTs) * fps)
    const count = end - emitted
    emitted = end
    for (let i = 0; i < count; i++) push(prev)
  }
  return {
    onFrame(data, ts) {
      if (startTs === null) {
        startTs = ts
      } else if (prev) {
        emitGrid(ts)
      }
      prev = data
    },
    async stop(nowSeconds) {
      if (prev && startTs !== null) emitGrid(nowSeconds)
      child.stdin.end()
      const code = await closed
      if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`)
    },
  }
}

const args = parseArgs(process.argv.slice(2))
mkdirSync(args.out, { recursive: true })

const mp4Path = join(args.out, 'qa-walkthrough.mp4')
const reportPath = join(args.out, 'qa-report.json')
for (const stale of [mp4Path]) {
  if (existsSync(stale)) unlinkSync(stale)
}

const browser = await puppeteer.launch({
  executablePath: resolveExecutablePath(),
  headless: args.headless,
  args: [
    '--mute-audio',
    '--window-size=' + args.width + ',' + args.height,
    ...(args.headless ? ['--enable-unsafe-swiftshader'] : []),
  ],
})

const page = await browser.newPage()
await page.setViewport({ width: args.width, height: args.height, deviceScaleFactor: 1 })

const cdp = await page.createCDPSession()
await cdp.send('Page.enable')
const recorder = startRecorder(args.ffmpeg, mp4Path, args.fps)
cdp.on('Page.screencastFrame', (event) => {
  void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {})
  recorder.onFrame(Buffer.from(event.data, 'base64'), event.metadata.timestamp)
})
await cdp.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 85,
  maxWidth: args.width,
  maxHeight: args.height,
})

const consoleErrors = []
const consoleWarnings = []
const pageErrors = []
const failedRequests = []
const fpsSamples = []
const steps = []

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
  else if (msg.type() === 'warning') consoleWarnings.push(msg.text())
})
page.on('pageerror', (err) => pageErrors.push(err.message))
page.on('requestfailed', (req) =>
  failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? 'unknown'})`),
)

const readPosition = () =>
  page.evaluate(() => document.documentElement.dataset.runtimePlayerPosition ?? '')

const readPrompt = () => page.evaluate(() => document.querySelector('.prompt')?.textContent ?? null)

const readFps = () => page.evaluate(() => document.documentElement.dataset.perfFps ?? '')

const spawnCount = () =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll('.dev-menu button')].find((b) =>
      /^Clear \(/.test(b.textContent.trim()),
    )
    return button ? Number(button.textContent.match(/\d+/)?.[0] ?? -1) : -1
  })

const clickButton = async (label, scope = '.dev-menu') => {
  const found = await page.evaluate(
    ([label, scope]) => {
      const root = scope ? document.querySelector(scope) : document
      const button = root
        ? [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
        : null
      if (!button) return false
      button.click()
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      return true
    },
    [label, scope],
  )
  if (!found) throw new Error(`button not found: ${label}`)
}

const setSlider = async (prefix, value) => {
  const found = await page.evaluate(
    ([prefix, value]) => {
      const row = [...document.querySelectorAll('.dev-menu-row')].find((r) =>
        r.querySelector('span')?.textContent.trim().startsWith(prefix),
      )
      const input = row?.querySelector('input[type="range"]')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, String(value))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    [prefix, String(value)],
  )
  if (!found) throw new Error(`slider row not found: ${prefix}`)
}

const key = async (code, ms) => {
  await page.keyboard.down(code)
  await sleep(ms)
  await page.keyboard.up(code)
}

const tap = async (code, ms = 70) => key(code, ms)

const doubleTap = async (code, gapMs = 200) => {
  await tap(code)
  await sleep(gapMs)
  await tap(code)
}

const engageFly = async () => {
  await sleep(500)
  const before = await readPrompt()
  if (before?.includes('FLY MODE')) return
  await doubleTap('Space')
  await sleep(300)
  const after = await readPrompt()
  if (!after?.includes('FLY MODE')) throw new Error(`fly mode not engaged: ${after}`)
}

const dragLook = async (dx, dy, stepsCount = 12) => {
  const x0 = Math.round(args.width / 2)
  const y0 = Math.round(args.height / 2)
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  for (let i = 1; i <= stepsCount; i++) {
    await page.mouse.move(Math.round(x0 + (dx * i) / stepsCount), Math.round(y0 + (dy * i) / stepsCount))
    await sleep(16)
  }
  await page.mouse.up()
}

const snapshot = (name) =>
  page.screenshot({ path: join(args.out, `snap-${name}.png`) }).catch(() => null)

async function step(name, fn) {
  const started = Date.now()
  let note
  let ok = true
  try {
    note = await fn()
  } catch (error) {
    ok = false
    note = error.message
    console.log(`  ! ${name}: ${note}`)
  }
  steps.push({ name, ok, ms: Date.now() - started, note })
  console.log(`[${ok ? 'ok ' : 'FAIL'}] ${name} (${Date.now() - started}ms)${ok && note ? ` — ${note}` : ''}`)
}

const fpsTimer = setInterval(async () => {
  try {
    const value = Number(await readFps())
    if (value > 0) fpsSamples.push(value)
  } catch {
    // page gone
  }
}, 2000)

try {
  await step('open game', async () => {
    await page.goto(`${args.server}/?quality=high&no-pointer-lock=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    })
    await page.waitForSelector('.enter-button', { timeout: 150000 })
    const loadMs = await page.evaluate(() => document.documentElement.dataset.initialLoadMs ?? '')
    return `to title in ${loadMs}ms`
  })

  await step('title screen', async () => {
    await sleep(2500)
    await snapshot('title')
    return 'title card visible, waiting on ENTER MANHATTAN'
  })

  await step('enter world', async () => {
    await clickButton('ENTER MANHATTAN', '.title-card')
    return 'clicked ENTER MANHATTAN'
  })

  await step('cinematic intro', async () => {
    await sleep(6200)
    const overlay = await page.evaluate(() => !!document.querySelector('.intro-overlay'))
    return overlay ? 'intro overlay still present' : 'intro complete, camera handed to player'
  })

  await step('first-person walk', async () => {
    await tap('v')
    await sleep(300)
    const start = await readPosition()
    await key('w', 5000)
    await dragLook(260, -40)
    await key('w', 2500)
    await key('a', 1200)
    await dragLook(-320, 0)
    await key('w', 2000)
    const end = await readPosition()
    return `moved ${start} -> ${end}`
  })

  await step('sprint', async () => {
    const start = await readPosition()
    await page.keyboard.down('Shift')
    await key('w', 4000)
    await page.keyboard.up('Shift')
    const end = await readPosition()
    return `sprinted ${start} -> ${end}`
  })

  await step('jump', async () => {
    await page.keyboard.down('w')
    await tap('Space', 120)
    await sleep(1400)
    await page.keyboard.up('w')
    return 'jumped while walking'
  })

  await step('double-space fly toggle', async () => {
    await doubleTap('Space')
    await sleep(300)
    const prompt = await readPrompt()
    if (!prompt?.includes('FLY MODE')) throw new Error(`fly mode not engaged: ${prompt}`)
    return prompt
  })

  await step('fly key-repeat check', async () => {
    const result = await page.evaluate(() => {
      const prompt = () => document.querySelector('.prompt')?.textContent ?? ''
      const before = prompt()
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }))
      }
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }))
      const after = prompt()
      return { beforeFlying: before.includes('FLY MODE'), afterFlying: after.includes('FLY MODE') }
    })
    if (!result.beforeFlying) throw new Error('expected to start flying')
    if (result.afterFlying !== result.beforeFlying) {
      return `FINDING: key-repeat toggles fly mode (no e.repeat guard) — holding Space while flying repeatedly flips fly on/off`
    }
    return 'no toggle on synthetic key repeat'
  })

  await step('fly skyline ascent', async () => {
    await engageFly()
    await key('Space', 2600)
    await key('w', 2200)
    await dragLook(-200, -260)
    await sleep(800)
    const pos = await readPosition()
    await snapshot('skyline-fly')
    return `flew to ${pos}`
  })

  await step('dev tools: teleport Times Square', async () => {
    await tap('F2')
    await sleep(400)
    await clickButton('Times Square')
    await sleep(4500)
    const pos = await readPosition()
    if (!pos) throw new Error('no position readback')
    return `at ${pos}`
  })

  await step('dev tools: night time', async () => {
    await setSlider('Time', 22)
    await sleep(4500)
    return 'clock set to 22:00'
  })

  await step('dev tools: spawn vehicles and props', async () => {
    const before = await spawnCount()
    for (const label of ['Sedan', 'Taxi', 'Police', 'Ambulance', 'Pedestrian', 'Tree']) {
      await clickButton(label)
      await sleep(500)
    }
    const after = await spawnCount()
    if (after !== before + 6) throw new Error(`spawn count ${before} -> ${after}`)
    await key('w', 2800)
    return `spawned 6 entities (${before} -> ${after})`
  })

  await step('dev tools: rain', async () => {
    await setSlider('Rain', 1)
    await sleep(4500)
    await snapshot('times-square-rain-night')
    return 'rain at 100%'
  })

  await step('dev tools: speed multiplier', async () => {
    await setSlider('Speed', 3)
    await sleep(2500)
    await setSlider('Speed', 1)
    await sleep(1200)
    return 'speed 3x briefly'
  })

  await step('dev tools: close', async () => {
    await tap('F2')
    return 'F2 closed'
  })

  await step('teleport Empire State via dev tools', async () => {
    await tap('F2')
    await sleep(400)
    await clickButton('Empire State')
    await sleep(4500)
    await tap('F2')
    const pos = await readPosition()
    await key('w', 2500)
    return `walked near ${pos}`
  })

  await step('central park daytime', async () => {
    await tap('F2')
    await sleep(400)
    await setSlider('Time', 14)
    await clickButton('Central Park')
    await sleep(4000)
    await tap('F2')
    await key('w', 3500)
    await dragLook(240, 30)
    await sleep(800)
    return 'walking the park'
  })

  await step('statue of liberty', async () => {
    await tap('F2')
    await sleep(400)
    await clickButton('Statue of Liberty')
    await sleep(5000)
    await tap('F2')
    await dragLook(300, -60)
    await sleep(1200)
    await snapshot('statue-of-liberty')
    return 'looked around the harbor'
  })

  await step('perf overlay F3', async () => {
    await tap('F3')
    await sleep(1800)
    const visible = await page.evaluate(() => !!document.querySelector('.perf'))
    if (!visible) throw new Error('.perf overlay not found after F3')
    await key('w', 2000)
    const fps = await readFps()
    await tap('F3')
    return `overlay visible, ${fps} fps`
  })

  await step('pause menu + settings', async () => {
    await tap('Escape')
    await sleep(1500)
    await snapshot('pause-menu')
    await clickButton('low', '.card')
    await sleep(800)
    await clickButton('high', '.card')
    await sleep(800)
    await clickButton('Resume', '.card')
    await sleep(2000)
    return 'cycled quality low -> high, resumed'
  })

  await step('final walk', async () => {
    await key('w', 2500)
    await sleep(500)
    return 'done'
  })
} finally {
  clearInterval(fpsTimer)
  try {
    await cdp.send('Page.stopScreencast')
  } catch {
    // already stopped
  }
  try {
    await recorder.stop(performance.now() / 1000)
  } catch (error) {
    console.error(`recorder stop failed: ${error.message}`)
  }
  await browser.close()
}

const fps = fpsSamples.length ? Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length) : 0
const minFps = fpsSamples.length ? Math.min(...fpsSamples) : 0
const findings = steps
  .filter((s) => !s.ok || s.note.startsWith('FINDING'))
  .map((s) => ({ step: s.name, ok: s.ok, detail: s.note }))

const report = {
  pipeline: 'shenron-city interactive QA walkthrough',
  generated_at: new Date().toISOString(),
  git_rev: gitRev(),
  server: args.server,
  headless: args.headless,
  resolution: `${args.width}x${args.height}`,
  video_mp4: mp4Path,
  fps: { samples: fpsSamples.length, avg: fps, min: minFps },
  steps,
  findings,
  console_errors: consoleErrors.slice(0, 30),
  console_warnings: consoleWarnings.slice(0, 30),
  page_errors: pageErrors.slice(0, 30),
  failed_requests: failedRequests.slice(0, 30),
}
writeFileSync(reportPath, JSON.stringify(report, null, 2))

const failedSteps = steps.filter((s) => !s.ok)
console.log('')
console.log(`video:  ${mp4Path}`)
console.log(`report: ${reportPath}`)
console.log(`fps:    avg ${fps}, min ${minFps}, samples ${fpsSamples.length}`)
console.log(`steps:  ${steps.length}, failed ${failedSteps.length}`)
if (consoleErrors.length) console.log(`console errors: ${consoleErrors.length}`)
if (pageErrors.length) console.log(`page errors:    ${pageErrors.length}`)
if (failedRequests.length) console.log(`failed requests: ${failedRequests.length}`)
for (const finding of findings) console.log(`finding: ${finding.step} — ${finding.detail}`)
