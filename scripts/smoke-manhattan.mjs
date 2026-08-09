/**
 * Boot smoke test for the Manhattan build.
 *
 * Spawns the vite dev server, loads the game in headless Chrome, waits for the
 * island base to register, clicks ENTER MANHATTAN, verifies the intro plays
 * and hands over to gameplay, and checks for console errors.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9317
const GAME_URL = `http://127.0.0.1:${PORT}/`
const VITE = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))

const server = spawn(process.execPath, [VITE, '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'ignore', 'pipe'],
  detached: false,
})
let serverError = ''
server.stderr.setEncoding('utf8')
server.stderr.on('data', (chunk) => {
  serverError = `${serverError}${chunk}`.slice(-2000)
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) {
      throw new Error(`vite exited before boot (${server.exitCode}): ${serverError.trim()}`)
    }
    try {
      const res = await fetch(GAME_URL)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error('vite dev server did not start')
}

async function stopServer() {
  if (server.exitCode !== null) return
  let exited = new Promise((resolve) => server.once('exit', resolve))
  server.kill()
  await Promise.race([exited, sleep(3000)])
  if (server.exitCode !== null) return

  // A direct Node child should exit on the first signal. Keep a hard fallback
  // so a failed smoke run never leaves a Vite listener behind in CI or on a
  // developer's machine.
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
    const consoleErrors = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
    })
    page.on('pageerror', (err) => consoleErrors.push(String(err).slice(0, 300)))

    console.log('loading game...')
    await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

    // Readiness and the title transition happen in separate React effects.
    // Wait for both contracts rather than sampling the DOM in between them.
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.initialLoadMs !== undefined &&
        document.querySelector('.title-card .enter-button') !== null,
      { timeout: 60000 },
    )
    const readyMs = await page.evaluate(
      () => document.documentElement.dataset.initialLoadMs ?? null,
    )
    console.log(`world ready in ${readyMs}ms`)
    console.log('title screen visible')

    // Enter the world.
    await page.evaluate(() => {
      const button = document.querySelector('.title-card .enter-button')
      if (!(button instanceof HTMLButtonElement)) throw new Error('enter button missing')
      button.click()
    })
    await page.waitForSelector('.intro-video-overlay', { timeout: 10000 })
    console.log('intro overlay appeared')

    // The intro should complete and vanish.
    await page.waitForSelector('.intro-video-overlay', { hidden: true, timeout: 15000 })
    console.log('intro completed, world revealed')

    // Give the scene a moment, then check for fatal errors.
    await sleep(2000)
    const fatal = consoleErrors.filter((e) => !/favicon|404/.test(e))
    console.log('console errors:', fatal.length ? fatal : 'none')
    if (fatal.length > 0) {
      // WebGL in swiftshader may warn; only hard-fail on obvious boot errors.
      const hard = fatal.filter(
        (e) =>
          /cannot|failed|undefined is not|is not a function|disposed|violates/i.test(e) &&
          !/Warning/i.test(e) &&
          !/Cannot update a component/i.test(e),
      )
      if (hard.length > 0) throw new Error(`boot errors: ${hard.join(' | ')}`)
    }

    console.log('SMOKE TEST PASSED')
  } finally {
    await browser.close()
  }
}

main()
  .catch((err) => {
    console.error('SMOKE TEST FAILED:', err.message)
    process.exitCode = 1
  })
  .finally(stopServer)
