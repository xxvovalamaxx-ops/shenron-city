/* global document, window */
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const server = spawn('npx', ['vite', '--port', '9320', '--strictPort'], { stdio: 'ignore', shell: true })

async function main() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9320/')
      if (r.ok) break
    } catch {}
    await sleep(500)
  }
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  })
  const page = await browser.newPage()
  const msgs = []
  page.on('console', (m) => {
    if (m.type() === 'error') msgs.push(m.text().slice(0, 160))
  })
  await page.goto('http://127.0.0.1:9320/', { waitUntil: 'domcontentloaded' })
  for (let i = 0; i < 90; i++) {
    const v = await page.evaluate(() => document.documentElement.dataset.initialLoadMs ?? null)
    if (v) break
    await sleep(500)
  }
  const buttonReady = await page.waitForSelector('.title-card .enter-button', { timeout: 30000 })
  if (!buttonReady) throw new Error('title button never appeared')
  await page.evaluate(() => document.querySelector('.title-card .enter-button').click())
  await sleep(6500)

  const pos1 = await page.evaluate(() => document.documentElement.dataset.runtimePlayerPosition)
  console.log('pos after intro:', pos1)

  // Hold W for 1.5s → should walk forward.
  await page.keyboard.down('KeyW')
  await sleep(1500)
  await page.keyboard.up('KeyW')
  await sleep(300)
  const pos2 = await page.evaluate(() => document.documentElement.dataset.runtimePlayerPosition)
  console.log('pos after walk:', pos2)

  // Double-space → fly mode; prompt label should change.
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await sleep(400)
  const flyLabel = await page.evaluate(() => document.querySelector('.prompt')?.textContent ?? '')
  console.log('fly label:', flyLabel.includes('FLY') ? 'FLY MODE ON' : 'NO FLY LABEL')

  // F2 → dev menu.
  await page.keyboard.press('F2')
  await sleep(300)
  const devMenu = await page.evaluate(() => !!document.querySelector('.dev-menu'))
  console.log('dev menu:', devMenu ? 'OPEN' : 'MISSING')

  // Eric player mesh present?
  const eric = await page.evaluate(() => {
    const scene = window.__gameScene
    let found = false
    scene?.traverse?.((o) => {
      if (o.name?.toLowerCase().includes('eric') || o.name?.toLowerCase().includes('rp_')) found = true
    })
    return found
  })
  console.log('player mesh in scene:', eric)

  const moved =
    !!pos1 && !!pos2 && pos2.split(',')[0] !== pos1.split(',')[0] && pos2.split(',')[2] !== pos1.split(',')[2]
  console.log('walk moved player:', moved)

  const hard = msgs.filter((e) => /cannot|failed|undefined is not|violates/i.test(e) && !/Cannot update/i.test(e))
  console.log('hard console errors:', hard.length ? JSON.stringify(hard) : 'none')

  const ok = devMenu && flyLabel.includes('FLY') && eric && moved
  console.log(ok ? 'GAMEPLAY PROBE PASSED' : 'GAMEPLAY PROBE FAILED')
  await browser.close()
  process.exit(ok ? 0 : 1)
}

main()
  .catch((e) => {
    console.error('ERR', e.message)
    process.exit(1)
  })
  .finally(() => server.kill())
