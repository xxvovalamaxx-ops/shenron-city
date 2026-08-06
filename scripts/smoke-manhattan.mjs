/**
 * Boot smoke test for the Manhattan build.
 *
 * Spawns the vite dev server, loads the game in headless Chrome, waits for the
 * island base to register, clicks ENTER MANHATTAN, verifies the intro plays
 * and hands over to gameplay, and checks for console errors.
 */
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9317
const URL = `http://127.0.0.1:${PORT}/`

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: false,
  shell: true,
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(URL)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error('vite dev server did not start')
}

async function main() {
  await waitForServer()
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  })
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err).slice(0, 300)))

  console.log('loading game...')
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // Wait for the world to be ready (App marks documentElement.dataset.initialLoadMs).
  let readyMs = null
  for (let i = 0; i < 120; i++) {
    readyMs = await page.evaluate(() => document.documentElement.dataset.initialLoadMs ?? null)
    if (readyMs !== null) break
    await sleep(500)
  }
  if (readyMs === null) throw new Error('world never became ready')
  console.log(`world ready in ${readyMs}ms`)

  const titleVisible = await page.evaluate(
    () => !!document.querySelector('.title-card .enter-button'),
  )
  if (!titleVisible) throw new Error('title screen not visible')
  console.log('title screen visible')

  // Enter the world.
  await page.evaluate(() => document.querySelector('.title-card .enter-button').click())
  await sleep(500)
  const introVisible = await page.evaluate(() => !!document.querySelector('.intro-overlay'))
  if (!introVisible) throw new Error('intro overlay did not appear')
  console.log('intro overlay appeared')

  // The intro should complete and vanish.
  let introGone = false
  for (let i = 0; i < 40; i++) {
    await sleep(300)
    introGone = await page.evaluate(() => !document.querySelector('.intro-overlay'))
    if (introGone) break
  }
  if (!introGone) throw new Error('intro overlay never completed')
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
  await browser.close()
}

main()
  .catch((err) => {
    console.error('SMOKE TEST FAILED:', err.message)
    process.exit(1)
  })
  .finally(() => {
    server.kill()
  })
