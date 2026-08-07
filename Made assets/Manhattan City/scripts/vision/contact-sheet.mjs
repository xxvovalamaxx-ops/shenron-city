// contact-sheet.mjs — build a self-contained HTML contact sheet from a
// directory of PNG captures, plus a plain-text index for non-visual review.
//
// Zero dependencies: Node built-ins only. This is the first stage of the
// vision bridge (see scripts/vision/README.md): it turns raw evidence PNGs
// into something a human or an external critic can actually review, with the
// provenance (name, bytes, mtime) of every image right next to it.
//
//   node scripts/vision/contact-sheet.mjs [dir] [--out sheet.html] [--info manifest.json]
//
//   dir      directory of PNG captures (default <repo>/evidence/phase2)
//   --out    output HTML path (default <repo>/docs/qa/vision/contact_sheet.html)
//   --info   JSON file with free-form build info rendered in the header
//   --out-md textual index path (default <repo>/scripts/vision/contact-sheet.md)
//
// The images are embedded as base64 data URLs, so the HTML opens offline in
// any browser with no server. Captures run 50-300 KB, so a sheet embeds to a
// few hundred KB per image; that is the intended trade for reviewability.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

const DEFAULT_DIR = path.join(REPO, 'evidence', 'phase2')
const DEFAULT_OUT = path.join(REPO, 'docs', 'qa', 'vision', 'contact_sheet.html')
const DEFAULT_OUT_MD = path.join(HERE, 'contact-sheet.md')

function usage() {
  return [
    'usage: node scripts/vision/contact-sheet.mjs [dir] [options]',
    '  dir      PNG directory (default ' + DEFAULT_DIR + ')',
    '  --out <file.html>       output HTML (default ' + DEFAULT_OUT + ')',
    '  --info <manifest.json>  build info rendered in the header',
    '  --out-md <file.md>      textual index (default ' + DEFAULT_OUT_MD + ')',
  ].join('\n')
}

function parseArgs(argv) {
  const args = { dir: null, out: null, info: null, outMd: null }
  const rest = [...argv]
  while (rest.length) {
    const a = rest.shift()
    if (a === '--out') args.out = rest.shift()
    else if (a === '--info') args.info = rest.shift()
    else if (a === '--out-md') args.outMd = rest.shift()
    else if (a.startsWith('--')) { console.error(usage()); process.exit(2) }
    else if (!args.dir) args.dir = a
    else { console.error('unexpected argument: ' + a + '\n' + usage()); process.exit(2) }
  }
  return args
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function humanSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

function fmtNum(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function relRepo(p) {
  return path.relative(REPO, p).split(path.sep).join('/')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const dir = path.resolve(args.dir || DEFAULT_DIR)
  const out = path.resolve(args.out || DEFAULT_OUT)
  const outMd = path.resolve(args.outMd || DEFAULT_OUT_MD)

  if (!fs.existsSync(dir)) {
    console.error(`contact-sheet: directory not found: ${dir}`)
    process.exit(1)
  }

  let info = {}
  if (args.info) {
    const infoPath = path.resolve(args.info)
    if (!fs.existsSync(infoPath)) {
      console.error(`contact-sheet: --info manifest not found: ${infoPath}`)
      process.exit(1)
    }
    try {
      info = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
    } catch (e) {
      console.error(`contact-sheet: --info manifest is not valid JSON: ${e.message}`)
      process.exit(1)
    }
  }

  const files = fs.readdirSync(dir)
    .filter((f) => /\.png$/i.test(f))
    .sort((a, b) => a.localeCompare(b))

  if (!files.length) {
    console.warn(`contact-sheet: no PNGs in ${dir} -- sheet will be empty`)
  }

  const images = files.map((f) => {
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    const b64 = fs.readFileSync(p).toString('base64')
    return { name: f, file: p, bytes: st.size, mtime: st.mtime, b64 }
  })

  const total = images.reduce((s, i) => s + i.bytes, 0)
  const generatedAt = new Date().toISOString()

  const infoRows = Object.entries(info).map(([k, v]) =>
    `<tr><th>${esc(k)}</th><td>${esc(JSON.stringify(v))}</td></tr>`).join('\n')

  const cards = images.map((i) => `
    <figure class="card">
      <a href="data:image/png;base64,${i.b64}" target="_blank" title="open raw PNG">
        <img loading="lazy" alt="${esc(i.name)}" src="data:image/png;base64,${i.b64}">
      </a>
      <figcaption>
        <div class="name">${esc(i.name)}</div>
        <div class="meta">${humanSize(i.bytes)} · ${fmtNum(i.bytes)} bytes · ${esc(i.mtime.toISOString())}</div>
      </figcaption>
    </figure>`).join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contact sheet — ${esc(path.basename(dir))}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
         margin: 0; background: #16181d; color: #e8e6e3; }
  header { padding: 16px 20px 8px; border-bottom: 1px solid #2c2f36; }
  header h1 { font-size: 18px; margin: 0 0 8px; }
  .summary { font-size: 13px; color: #9aa0a8; margin-bottom: 10px; }
  .summary b { color: #e8e6e3; }
  table.info { border-collapse: collapse; font-size: 12px; margin-bottom: 10px; }
  table.info th { text-align: left; color: #9aa0a8; font-weight: 500;
                  padding: 2px 12px 2px 0; white-space: nowrap; }
  table.info td { padding: 2px 0; word-break: break-all; }
  main { padding: 16px 20px 40px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
          gap: 14px; }
  .card { margin: 0; background: #1e2127; border: 1px solid #2c2f36; border-radius: 6px;
          overflow: hidden; }
  .card img { width: 100%; display: block; background: #0d0e11; }
  .card figcaption { padding: 8px 10px; }
  .card .name { font-size: 13px; font-weight: 600; word-break: break-all; }
  .card .meta { font-size: 11px; color: #9aa0a8; margin-top: 2px; }
  footer { padding: 12px 20px 24px; font-size: 11px; color: #6b7178;
           border-top: 1px solid #2c2f36; }
  footer code { color: #9aa0a8; }
</style>
</head>
<body>
<header>
  <h1>Contact sheet — ${esc(relRepo(dir))}</h1>
  <div class="summary">
    <b>${images.length}</b> capture(s) · ${humanSize(total)} total · generated ${esc(generatedAt)}
  </div>
  ${infoRows ? `<table class="info">${infoRows}</table>` : ''}
</header>
<main>
  ${images.length ? `<div class="grid">${cards}</div>` : '<p>No PNG captures found in this directory.</p>'}
</main>
<footer>
  Generated by <code>scripts/vision/contact-sheet.mjs</code> ·
  images embedded as base64 data URLs, reviewable offline ·
  index file: <code>${esc(relRepo(outMd))}</code>
</footer>
</body>
</html>
`

  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, html)

  const rows = images.map((i) =>
    `| ${esc(i.name)} | ${relRepo(i.file)} | ${fmtNum(i.bytes)} | ${esc(i.mtime.toISOString())} |`).join('\n')

  const md = `# Contact sheet — ${relRepo(dir)}

Generated: ${generatedAt}

${Object.entries(info).map(([k, v]) => `- **${k}**: ${JSON.stringify(v)}`).join('\n')}

- Images: ${images.length}
- Total bytes: ${fmtNum(total)}

| name | file | size (bytes) | mtime |
|---|---|---|---|
${rows}

*Index written by scripts/vision/contact-sheet.mjs for non-visual review.*
`

  fs.mkdirSync(path.dirname(outMd), { recursive: true })
  fs.writeFileSync(outMd, md)

  console.log(`contact-sheet: ${images.length} image(s) -> ${relRepo(out)}`)
  console.log(`contact-sheet: textual index -> ${relRepo(outMd)}`)
}

main()
