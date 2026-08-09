/**
 * Browser acceptance for the development-only Phase-1 3D Tiles route.
 *
 * Requires a Vite server (the repository default is http://127.0.0.1:9321).
 * This checks runtime/collision health and the explicit Phase-1 visual entry
 * gate. The fixture is intentionally grayscale technical geometry, so this
 * runner never reports it as reference-quality visual approval.
 *
 * Usage:
 *   node scripts/qa/phase1runtimecheck.mjs [--server URL] [--out FILE] [--screenshot FILE]
 */
/* global HTMLButtonElement, document, window */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { decodePngToRgba } from '../visual-qa/png-decode.mjs'
import { runChecks } from '../visual-qa/frame-analysis.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const HQ = Object.freeze({ x: -2318.735, y: 12, z: 1809.657 })
const VITE = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url))
const DEFAULT_PORT = 9321
const RELEASE_PATH = '/tests/fixtures/manhattan-phase1/generated/release.json'

const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

function resolveExecutablePath() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  if (fromEnv) return fromEnv
  for (const candidate of CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error('No Chromium-family browser found. Set PUPPETEER_EXECUTABLE_PATH.')
}

function parseArgs(argv) {
  const args = {
    server: null,
    out: join(REPO_ROOT, 'evidence', 'opus', 'performance', 'phase1runtimecheck.json'),
    screenshot: join(REPO_ROOT, 'evidence', 'visual', 'captures', 'phase1-runtime.png'),
  }
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--server') args.server = argv[++index]
    else if (argv[index] === '--out') args.out = resolve(argv[++index])
    else if (argv[index] === '--screenshot') args.screenshot = resolve(argv[++index])
    else if (argv[index] === '--help') {
      console.log('phase1runtimecheck [--server URL] [--out FILE] [--screenshot FILE]')
      process.exit(0)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))

let serverProcess = null
let serverError = ''

async function startServer() {
  if (args.server) return args.server
  const server = `http://127.0.0.1:${DEFAULT_PORT}`
  serverProcess = spawn(
    process.execPath,
    [VITE, '--port', String(DEFAULT_PORT), '--strictPort'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: false },
  )
  serverProcess.stderr.setEncoding('utf8')
  serverProcess.stderr.on('data', (chunk) => {
    serverError = `${serverError}${chunk}`.slice(-4000)
  })
  for (let attempt = 0; attempt < 120; attempt++) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`Vite exited before Phase-1 QA (${serverProcess.exitCode}): ${serverError}`)
    }
    try {
      const response = await fetch(server)
      if (response.ok) return server
    } catch {
      // Listener is not ready yet.
    }
    if (attempt === 119) throw new Error(`Vite did not start for Phase-1 QA: ${serverError}`)
    await sleep(250)
  }
  throw new Error('Phase-1 Vite startup loop ended unexpectedly')
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return
  let exited = new Promise((resolvePromise) => serverProcess.once('exit', resolvePromise))
  serverProcess.kill()
  await Promise.race([exited, sleep(3000)])
  if (serverProcess.exitCode !== null) return
  exited = new Promise((resolvePromise) => serverProcess.once('exit', resolvePromise))
  serverProcess.kill('SIGKILL')
  await Promise.race([exited, sleep(3000)])
}

function phase1Url(server, query = '') {
  return `${server.replace(/\/$/, '')}/?city=phase1&no-pointer-lock=1${query}`
}

function capturePage(page, label = '') {
  const errors = []
  const failedRequests = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${label}pageerror: ${error.message}`))
  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      errorText: request.failure()?.errorText ?? 'failed',
    })
  })
  return { errors, failedRequests }
}

function isExpectedStrictModeAbort(request) {
  if (request.errorText !== 'net::ERR_ABORTED') return false
  try {
    return new URL(request.url).pathname === RELEASE_PATH
  } catch {
    return false
  }
}

function requestLabel(request) {
  return `${request.url}: ${request.errorText}`
}

function hardConsoleErrors(errors) {
  return errors.filter((message) =>
    /cannot|failed|undefined is not|is not a function|disposed|violates|normalpass|phase1/i.test(message) &&
    !/Cannot update a component/i.test(message),
  )
}

async function waitForEntryGate(page, timeout = 90_000, requireTitle = true) {
  await page.waitForFunction(
    (needsTitle) => {
      const data = document.documentElement.dataset
      const required = Number(data.phase1TilesRequired)
      return data.phase1TilesStatus === 'ready' &&
        data.phase1TilesReleaseVerified === '1' &&
        required > 0 &&
        Number(data.phase1TilesRequiredLoaded) === required &&
        Number(data.phase1TilesRequiredVisible) > 0 &&
        Number(data.phase1TilesTerminalVisualErrors) === 0 &&
        data.phase1TilesEnterable === '1' &&
        data.phase1GameplayStatus === 'ready' &&
        Number(data.phase1GameplayResident) > 0 &&
        Number(data.phase1GameplayColliders) > 0 &&
        (!needsTitle || document.querySelector('.title-card .enter-button') !== null)
    },
    { timeout },
    requireTitle,
  )
}

async function entryDiagnostic(page) {
  return page.evaluate(() => ({
    dataset: { ...document.documentElement.dataset },
    diagnostics: window.__phase1TilesDiagnostics ?? null,
    title: document.querySelector('.title-card .enter-button') !== null,
  }))
}

async function collectWorldState(page) {
  return page.evaluate(async (hq) => {
    const collisionModule = await import('/src/world/manhattan-collision.ts')
    const collision = collisionModule.manhattanCollision
    const renderer = window.__phase1TilesRenderer
    const scene = window.__gameScene
    const group = scene?.getObjectByName?.('phase1-city') ?? null
    let meshes = 0
    let triangles = 0
    group?.traverse?.((object) => {
      if (!object.isMesh || !object.geometry) return
      meshes += 1
      const geometry = object.geometry
      triangles += geometry.index
        ? geometry.index.count / 3
        : (geometry.attributes.position?.count ?? 0) / 3
    })

    const ground = collision.groundHeightAt(hq.x, hq.z)
    const roof = collision.buildingTopAt(hq.x, hq.z)
    const inside = ground === null ? false : collision.isInsideBuilding(hq.x, ground, hq.z)
    const sweepStart = { x: hq.x, y: ground ?? hq.y, z: hq.z + 40 }
    const swept = collision.move(sweepStart, 0, -30)
    const player = window.__rt?.player.pos
    const diagnostics = window.__phase1TilesDiagnostics
    return {
      player: player ? { x: player.x, y: player.y, z: player.z } : null,
      diagnostics,
      visual: {
        meshes,
        triangles,
        visibleTiles: renderer?.visibleTiles?.size ?? 0,
        activeTiles: renderer?.activeTiles?.size ?? 0,
        rootLoaded: renderer?.root != null,
      },
      collision: {
        ground,
        roof,
        inside,
        sweepStart,
        swept,
        stoppedBeforeCentre: swept.z > hq.z + 1,
      },
      rendererMemory: window.__gameRenderer?.info?.memory ?? null,
      rendererCalls: window.__gameRenderer?.info?.render?.calls ?? null,
    }
  }, HQ)
}

function isInjectedUrl(kind, url) {
  const path = new URL(url).pathname
  if (kind === 'visual-glb') {
    return path.includes('/tests/fixtures/manhattan-phase1/generated/visual/') && path.endsWith('.glb')
  }
  return path.includes('/tests/fixtures/manhattan-phase1/generated/gameplay/tiles/') && path.endsWith('.json')
}

async function verifyFaultInjection(browser, server, kind) {
  const page = await browser.newPage()
  const capture = capturePage(page, `[fault:${kind}] `)
  let injectedUrl = null
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    if (injectedUrl === null && isInjectedUrl(kind, request.url())) {
      injectedUrl = request.url()
      void request.abort('failed').catch(() => {})
      return
    }
    void request.continue().catch(() => {})
  })

  try {
    await page.goto(phase1Url(server, `&fault=${kind}`), {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await page.waitForFunction(
      (faultKind) => {
        const data = document.documentElement.dataset
        const noEntry = data.phase1TilesEnterable !== '1' &&
          document.querySelector('.title-card .enter-button') === null
        if (faultKind === 'visual-glb') {
          return data.phase1TilesStatus === 'error' &&
            Number(data.phase1TilesTerminalVisualErrors) > 0 && noEntry
        }
        return data.phase1TilesStatus === 'error' &&
          data.phase1GameplayStatus === 'error' && noEntry
      },
      { timeout: 60_000 },
      kind,
    )
    const state = await entryDiagnostic(page)
    const technicalReady = state.diagnostics?.status === 'ready' &&
      state.diagnostics?.enterable === true &&
      state.diagnostics?.gameplayStatus === 'ready'
    const pass = injectedUrl !== null && technicalReady === false && state.title === false
    return {
      kind,
      injectedUrl,
      diagnostic: state,
      technicalReady,
      consoleErrors: capture.errors,
      failedRequests: capture.failedRequests.map(requestLabel),
      pass,
    }
  } catch (error) {
    return {
      kind,
      injectedUrl,
      diagnostic: await entryDiagnostic(page).catch(() => null),
      technicalReady: null,
      consoleErrors: capture.errors,
      failedRequests: capture.failedRequests.map(requestLabel),
      pass: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await page.close()
  }
}

let browser = null

try {
  const server = await startServer()
  browser = await puppeteer.launch({
    executablePath: resolveExecutablePath(),
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1920, height: 1080 },
  })

  const page = await browser.newPage()
  const capture = capturePage(page)
  const url = phase1Url(server)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  try {
    await waitForEntryGate(page)
  } catch (error) {
    throw new Error(
      `Phase-1 entry gate timed out: ${error.message}; ` +
      `page=${JSON.stringify(await entryDiagnostic(page))}; ` +
      `console=${JSON.stringify(capture.errors.slice(-8))}; ` +
      `requests=${JSON.stringify(capture.failedRequests.slice(-8).map(requestLabel))}`,
      { cause: error },
    )
  }

  await page.evaluate(() => {
    const button = document.querySelector('.title-card .enter-button')
    if (!(button instanceof HTMLButtonElement)) throw new Error('enter button missing')
    button.click()
  })
  await page.waitForFunction(
    () => window.__rt?.paused === false && window.__hud?.getState?.().screen === 'playing',
    { timeout: 10_000 },
  )
  await sleep(1500)
  const browserState = await collectWorldState(page)
  await page.close()

  const visualPage = await browser.newPage()
  const visualCapture = capturePage(visualPage, '[visual] ')
  const visualUrl = `${server.replace(/\/$/, '')}/?city=phase1&visionCapture=1` +
    `&visionX=${HQ.x}&visionY=180&visionZ=${HQ.z + 250}` +
    `&visionTX=${HQ.x}&visionTY=50&visionTZ=${HQ.z}` +
    '&visionFov=55&visionTime=16.5&visionRain=0&visionSeed=phase1-runtime'
  await visualPage.goto(visualUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await waitForEntryGate(visualPage, 90_000, false)
  await visualPage.waitForFunction(() => document.documentElement.dataset.visionReady === '1', { timeout: 30_000 })
  await sleep(1500)
  const visualState = await visualPage.evaluate(() => {
    const renderer = window.__phase1TilesRenderer
    const scene = window.__gameScene
    const group = scene?.getObjectByName?.('phase1-city') ?? null
    let meshes = 0
    let triangles = 0
    group?.traverse?.((object) => {
      if (!object.isMesh || !object.geometry) return
      meshes += 1
      const geometry = object.geometry
      triangles += geometry.index
        ? geometry.index.count / 3
        : (geometry.attributes.position?.count ?? 0) / 3
    })
    return {
      meshes,
      triangles,
      visibleTiles: renderer?.visibleTiles?.size ?? 0,
      activeTiles: renderer?.activeTiles?.size ?? 0,
      rootLoaded: renderer?.root != null,
      diagnostics: window.__phase1TilesDiagnostics ?? null,
      camera: document.documentElement.dataset.visionCamera ?? null,
    }
  })
  browserState.visual = {
    meshes: visualState.meshes,
    triangles: visualState.triangles,
    visibleTiles: visualState.visibleTiles,
    activeTiles: visualState.activeTiles,
    rootLoaded: visualState.rootLoaded,
  }
  browserState.visualDiagnostics = visualState.diagnostics
  browserState.visualCamera = visualState.camera

  const screenshot = Buffer.from(await visualPage.screenshot({ type: 'png' }))
  const frameAnalysis = runChecks(decodePngToRgba(screenshot))
  mkdirSync(dirname(args.screenshot), { recursive: true })
  writeFileSync(args.screenshot, screenshot)
  await visualPage.close()

  const visualGlbFault = await verifyFaultInjection(browser, server, 'visual-glb')
  const colliderJsonFault = await verifyFaultInjection(browser, server, 'collider-json')
  const errors = [...capture.errors, ...visualCapture.errors]
  const failedRequests = [...capture.failedRequests, ...visualCapture.failedRequests]
  const expectedAborts = failedRequests.filter(isExpectedStrictModeAbort)
  const hardFailedRequests = failedRequests.filter((request) => !isExpectedStrictModeAbort(request))
  const hardErrors = hardConsoleErrors(errors)
  const player = browserState.player
  const playerNearSpawn = player !== null &&
    Math.hypot(player.x - HQ.x, player.z - (HQ.z + 80)) < 2 &&
    Math.abs(player.y - HQ.y) < 1
  const visualDiagnostics = browserState.visualDiagnostics
  const requiredVisualCount = visualDiagnostics?.requiredVisualModels ?? 0
  const visualGateChecks = {
    releaseDescriptorVerified: visualDiagnostics?.releaseVerified === true,
    everyRequiredVisualModelLoaded: requiredVisualCount > 0 &&
      visualDiagnostics?.loadedRequiredVisualModels === requiredVisualCount,
    requiredVisualContentVisible: (visualDiagnostics?.visibleRequiredVisualModels ?? 0) > 0,
    zeroTerminalVisualErrors: visualDiagnostics?.terminalVisualErrors === 0,
    componentReportsEnterable: visualDiagnostics?.enterable === true,
  }
  const visualGatePass = Object.values(visualGateChecks).every(Boolean)
  const technicalChecks = {
    phase1StatusReady: browserState.diagnostics?.status === 'ready',
    gameplayReady: browserState.diagnostics?.gameplayStatus === 'ready',
    visualGeometryResident: browserState.visual.meshes > 0 && browserState.visual.triangles > 0,
    rendererHasVisibleTiles: browserState.visual.visibleTiles > 0,
    frameTechnicalSanity: frameAnalysis.results['frame-not-black'].pass &&
      frameAnalysis.results['frame-not-flat'].pass &&
      frameAnalysis.results['no-void'].pass,
    playerNearPhase1Spawn: playerNearSpawn,
    groundAtHq: browserState.collision.ground !== null &&
      Math.abs(browserState.collision.ground - HQ.y) < 0.05,
    buildingColliderAtHq: browserState.collision.inside === true &&
      browserState.collision.roof !== null && browserState.collision.roof > HQ.y + 90,
    sweepStoppedAtBuilding: browserState.collision.stoppedBeforeCentre === true,
    noUnexpectedFailedRequests: hardFailedRequests.length === 0,
    noHardConsoleErrors: hardErrors.length === 0,
  }
  const technicalRuntimePass = Object.values(technicalChecks).every(Boolean)
  const faultInjectionChecks = {
    missingVisualGlbBlocksTechnicalReadiness: visualGlbFault.pass && visualGlbFault.technicalReady === false,
    missingColliderJsonBlocksTechnicalReadiness: colliderJsonFault.pass && colliderJsonFault.technicalReady === false,
  }
  const faultInjectionPass = Object.values(faultInjectionChecks).every(Boolean)
  const failed = [
    ...Object.entries(technicalChecks)
      .filter(([, pass]) => !pass)
      .map(([name]) => `technical:${name}`),
    ...Object.entries(visualGateChecks)
      .filter(([, pass]) => !pass)
      .map(([name]) => `visual-gate:${name}`),
    ...Object.entries(faultInjectionChecks)
      .filter(([, pass]) => !pass)
      .map(([name]) => `fault-injection:${name}`),
  ]
  const report = {
    generatedBy: 'scripts/qa/phase1runtimecheck.mjs',
    url,
    checkedAt: new Date().toISOString(),
    hqWorld: HQ,
    technicalRuntimePass,
    visualGatePass,
    faultInjectionPass,
    referenceQualityPass: null,
    referenceQualityNote: 'Not assessed: the grayscale Phase-1 fixture is technical runtime geometry, not reference-quality art.',
    checks: {
      technical: technicalChecks,
      visualGate: visualGateChecks,
      faultInjection: faultInjectionChecks,
    },
    failed,
    browserState,
    visualUrl,
    frameAnalysis: {
      classification: 'technical-frame-sanity-only',
      metrics: frameAnalysis.metrics,
      checks: frameAnalysis.results,
    },
    consoleErrors: errors,
    hardErrors,
    failedRequests: failedRequests.map(requestLabel),
    expectedAborts: expectedAborts.map(requestLabel),
    hardFailedRequests: hardFailedRequests.map(requestLabel),
    faultInjection: {
      visualGlb: visualGlbFault,
      colliderJson: colliderJsonFault,
    },
    screenshot: args.screenshot,
    pass: technicalRuntimePass && visualGatePass && faultInjectionPass,
  }
  mkdirSync(dirname(args.out), { recursive: true })
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`)

  console.log(`phase1runtimecheck: ${report.pass ? 'PASS' : 'FAIL'}`)
  console.log(`  technicalRuntimePass: ${technicalRuntimePass}`)
  console.log(`  visualGatePass: ${visualGatePass}`)
  console.log(`  faultInjectionPass: ${faultInjectionPass}`)
  console.log('  reference quality: not assessed (grayscale technical fixture)')
  console.log(`  visual: ${browserState.visual.meshes} meshes, ${browserState.visual.triangles} triangles, ${browserState.visual.visibleTiles} visible tiles`)
  console.log(`  gameplay: ${browserState.diagnostics?.residentGameplayTiles ?? 0} resident tiles, ${browserState.diagnostics?.colliders ?? 0} colliders`)
  console.log(`  ground/roof at HQ: ${browserState.collision.ground} / ${browserState.collision.roof}`)
  console.log(`  player: ${player ? `${player.x.toFixed(2)}, ${player.y.toFixed(2)}, ${player.z.toFixed(2)}` : 'missing'}`)
  console.log(`  failed: ${failed.length ? failed.join(', ') : 'none'}`)
  console.log(`  report: ${args.out}`)
  console.log(`  screenshot: ${args.screenshot}`)
  if (!report.pass) process.exitCode = 1
} finally {
  try {
    if (browser) await browser.close()
  } finally {
    await stopServer()
  }
}
