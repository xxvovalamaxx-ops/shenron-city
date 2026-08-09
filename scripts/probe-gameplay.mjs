/* global HTMLButtonElement, KeyboardEvent, document, window */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9320
const BASE_URL = `http://127.0.0.1:${PORT}/`
const GAME_URL = `${BASE_URL}?no-pointer-lock=1`
const VITE = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const server = spawn(process.execPath, [VITE, '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'pipe'],
  detached: false,
})
let serverError = ''
server.stderr.setEncoding('utf8')
server.stderr.on('data', (chunk) => {
  serverError = `${serverError}${chunk}`.slice(-2000)
})

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) {
      throw new Error(`vite exited before boot (${server.exitCode}): ${serverError.trim()}`)
    }
    try {
      const response = await fetch(BASE_URL)
      if (response.ok) return
    } catch {
      // The listener is not ready yet.
    }
    await sleep(250)
  }
  throw new Error('vite dev server did not start')
}

async function stopServer() {
  if (server.exitCode !== null) return
  let exited = new Promise((resolve) => server.once('exit', resolve))
  server.kill()
  await Promise.race([exited, sleep(3000)])
  if (server.exitCode !== null) return
  exited = new Promise((resolve) => server.once('exit', resolve))
  server.kill('SIGKILL')
  await Promise.race([exited, sleep(3000)])
}

async function main() {
  await waitForServer()
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 720 })
    const messages = []
    page.on('console', (message) => {
      if (message.type() === 'error') messages.push(message.text().slice(0, 300))
    })
    page.on('pageerror', (error) => messages.push(String(error).slice(0, 300)))

    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.initialLoadMs !== undefined &&
        document.querySelector('.title-card .enter-button') !== null,
      { timeout: 60000 },
    )
    await page.evaluate(() => {
      const button = document.querySelector('.title-card .enter-button')
      if (!(button instanceof HTMLButtonElement)) throw new Error('enter button missing')
      button.click()
    })
    await page.waitForSelector('.intro-video-overlay', { timeout: 10000 })
    await page.keyboard.press('Space')
    await page.waitForSelector('.intro-video-overlay', { hidden: true, timeout: 10000 })
    await page.waitForFunction(
      () => window.__rt && window.__gameScene && window.__rt.paused === false,
      { timeout: 10000 },
    )

    const position = () =>
      page.evaluate(() => {
        const p = window.__rt?.player.pos
        return p ? { x: p.x, y: p.y, z: p.z } : null
      })

    const before = await position()
    console.log('pos after intro:', before)

    // Hold W for 1.5 s: movement in either horizontal axis counts.
    await page.keyboard.down('w')
    await sleep(1500)
    await page.keyboard.up('w')
    await sleep(300)
    const after = await position()
    console.log('pos after walk:', after)
    const walked =
      before !== null &&
      after !== null &&
      Math.hypot(after.x - before.x, after.z - before.z) > 0.25
    console.log('walk moved player:', walked)

    // Double-space toggles fly mode and publishes the player-facing prompt.
    await page.evaluate(() => {
      const tap = () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }),
        )
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ', bubbles: true }))
      }
      tap()
      // Keep both events in one task. Under SwiftShader one render can block
      // the main thread for longer than the 350 ms user-facing double-tap
      // window, which would turn a timing probe into a GPU-speed probe.
      tap()
    })
    await sleep(300)
    const fly = await page.evaluate(() => ({
      enabled: window.__rt?.player.flying === true,
      label: document.querySelector('.prompt')?.textContent ?? '',
      paused: window.__rt?.paused,
      screen: window.__hud?.getState?.().screen,
      playerVehicleId: window.__vehicleSim?.registry?.playerVehicleId,
    }))
    console.log('fly mode:', fly.enabled && fly.label.includes('FLY') ? 'ON' : 'FAILED', fly)

    await page.keyboard.press('F2')
    await page.waitForSelector('.dev-menu', { timeout: 3000 })
    const devMenu = await page.evaluate(() => document.querySelector('.dev-menu') !== null)
    console.log('dev menu:', devMenu ? 'OPEN' : 'MISSING')

    const playerMesh = await page.evaluate(() => {
      let found = false
      window.__gameScene?.traverse?.((object) => {
        const name = object.name?.toLowerCase?.() ?? ''
        if (name.includes('eric') || name.includes('rp_')) found = true
      })
      return found
    })
    console.log('player mesh in scene:', playerMesh)

    const hard = messages.filter(
      (message) =>
        /cannot|failed|undefined is not|is not a function|violates|normalpass/i.test(message) &&
        !/Cannot update a component/i.test(message),
    )
    console.log('hard console errors:', hard.length ? hard : 'none')

    const ok = walked && fly.enabled && fly.label.includes('FLY') && devMenu && playerMesh && hard.length === 0
    console.log(ok ? 'GAMEPLAY PROBE PASSED' : 'GAMEPLAY PROBE FAILED')
    return ok
  } finally {
    await browser.close()
  }
}

main()
  .then((ok) => {
    if (!ok) process.exitCode = 1
  })
  .catch((error) => {
    console.error('GAMEPLAY PROBE ERROR:', error.message)
    process.exitCode = 1
  })
  .finally(stopServer)
