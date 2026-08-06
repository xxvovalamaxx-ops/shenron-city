const fs = require('fs')
let s = fs.readFileSync('scripts/benchmarks/run.cjs', 'utf8')
const rep = (from, to) => {
  if (!s.includes(from)) { console.error('NOT FOUND:', from.slice(0, 60)); process.exit(1) }
  s = s.replace(from, to)
}
rep('async function urlReachable(url) {\n  try {\n    const r = await fetch(url)\n    trace("urlReachable " + url + " -> " + r.status)\n    return r.ok\n  } catch { return false }\n}',
  'async function urlReachable(url) {\n  try {\n    const r = await fetch(url, { signal: AbortSignal.timeout(3000) })\n    trace("urlReachable " + url + " -> " + r.status)\n    return r.ok\n  } catch (e) { trace("urlReachable " + url + " fail " + e.name)\n    return false }\n}')
rep('main().catch((e) => { console.error(e.message); process.exit(1) })',
  'main().catch((e) => { console.error(e.stack || e.message); process.exit(1) })')
fs.writeFileSync('scripts/benchmarks/run.cjs', s)
console.log('patched ok')
