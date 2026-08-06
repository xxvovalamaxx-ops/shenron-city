const { launchChrome, openTab, navigate, evaluate } = require('./lib/cdp.cjs')

async function main() {
  const browser = await launchChrome({ chromePath: process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', port: 9224 })
  const { page } = await openTab(browser, { width: 1280, height: 720 })
  const errors = []
  page.ws.onmessage = (ev) => { // capture protocol events too
    const m = JSON.parse(ev.data)
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXC: ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
    }
    if (m.method === 'Log.entryAdded') {
      errors.push('LOG: ' + m.params.entry.level + ' ' + m.params.entry.text)
    }
  }
  await page.send('Log.enable')
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  await page.send('Runtime.evaluate', { expression: `window.addEventListener('error', e => console.error('PAGEERR', e.message, e.filename + ':' + e.lineno))` })
  await navigate(page, 'http://127.0.0.1:5173')
  console.log('navigated, waiting for boot...')
  await new Promise((r) => setTimeout(r, 25000))
  const r = await evaluate(page, `({
    hasManhattan: !!window.__manhattan,
    hasCapture: !!window.__capture,
    canvas: document.querySelectorAll('canvas').length,
    bodySnippet: document.body ? document.body.innerHTML.slice(0, 300) : null,
    keys: Object.keys(window).filter(k => k.startsWith('__')),
    title: document.title,
  })`)
  console.log(JSON.stringify(r, null, 2))
  console.log('page errors:')
  for (const e of errors.slice(0, 30)) console.log('  ' + e)
  browser.close()
}
main().catch((e) => { console.error('FAIL', e.stack || e.message); process.exit(1) })
