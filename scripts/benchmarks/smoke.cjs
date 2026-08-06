// smoke.cjs — isolated test of the CDP layer (launch, tab, evaluate, screenshot).
const { launchChrome, openTab, evaluate, screenshot } = require('./lib/cdp.cjs')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const browser = await launchChrome({ chromePath: process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', port: 9223 })
  console.log('chrome up on', browser.port)
  const { page } = await openTab(browser, { width: 1280, height: 720 })
  console.log('tab open')
  const r = await evaluate(page, '1 + 2')
  console.log('evaluate 1+2 =', r)
  const png = await screenshot(page)
  fs.writeFileSync(path.join(__dirname, '..', '..', 'evidence', 'performance', 'phase2o-a', 'smoke.png'), png)
  console.log('screenshot bytes', png.length)
  browser.close()
  console.log('ok')
}
main().catch((e) => { console.error('FAIL', e); process.exit(1) })
