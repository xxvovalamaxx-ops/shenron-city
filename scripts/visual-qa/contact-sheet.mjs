/**
 * Contact-sheet builder for the visual QA bridge.
 *
 * Reads evidence/visual/captures/run-summary.json plus each scene's
 * frame-a.png / frame-b.png / metadata.json and emits a single self-contained
 * HTML page (evidence/visual/contact-sheet.html) showing both frames of every
 * captured scene, the numerical check verdicts, and per-scene metadata.
 *
 * No dependencies: images are embedded by relative <img src>, checks are
 * rendered from the metadata JSON already written by the capture runner.
 *
 * Usage: node scripts/visual-qa/contact-sheet.mjs [--captures evidence/visual/captures]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')

function parseArgs(argv) {
  const args = { captures: join(REPO_ROOT, 'evidence', 'visual', 'captures') }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--captures') args.captures = argv[++i]
    else if (argv[i] === '--help') {
      console.log('usage: node scripts/visual-qa/contact-sheet.mjs [--captures <dir>]')
      process.exit(0)
    }
  }
  return args
}

const severityColor = {
  P0: '#d33',
  P1: '#e8a33d',
  P2: '#8a8a8a',
}

const args = parseArgs(process.argv.slice(2))
const summaryPath = join(args.captures, 'run-summary.json')
if (!existsSync(summaryPath)) {
  console.error(`No ${summaryPath} found. Run the capture runner first.`)
  process.exit(1)
}
const runSummary = JSON.parse(readFileSync(summaryPath, 'utf8'))
const manifest = JSON.parse(readFileSync(join(HERE, 'scene-manifest.json'), 'utf8'))
const byId = new Map(manifest.scenes.map((s) => [s.scene_id, s]))

const rows = []
for (const result of runSummary.results) {
  const metaPath = join(args.captures, result.scene_id, 'metadata.json')
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : null
  const scene = byId.get(result.scene_id)
  if (!meta) {
    rows.push(`
      <tr class="skipped">
        <td class="id">${result.scene_id}</td>
        <td colspan="4">${result.note ? escapeHtml(result.note) : 'no capture produced'}</td>
      </tr>`)
    continue
  }
  const checks = Object.entries(meta.checks)
    .map(([id, c]) => `<span class="chip ${c.pass ? 'pass' : 'fail'}" title="${escapeHtml(c.threshold)}">${id} ${c.pass ? 'PASS' : 'FAIL'}</span>`)
    .join('')
  const failed = Object.entries(meta.checks).filter(([, c]) => !c.pass)
  const issues = (meta.issues ?? []).map((i) => escapeHtml(i)).join('<br>')
  rows.push(`
    <tr class="scene">
      <td class="id">${result.scene_id}</td>
      <td class="pair">
        <figure><img src="${result.scene_id}/frame-a.png" loading="lazy" alt="frame A"><figcaption>A</figcaption></figure>
        <figure><img src="${result.scene_id}/frame-b.png" loading="lazy" alt="frame B"><figcaption>B</figcaption></figure>
      </td>
      <td class="meta">
        <div><strong>${escapeHtml(scene?.label ?? result.scene_id)}</strong></div>
        <div>fps: ${meta.fps ?? '?'} · settled: ${meta.settled ? 'yes' : 'no'}</div>
        <div>diff: ${meta.frame_diff.value.toFixed(2)} (${meta.frame_diff.pass ? 'PASS' : 'FAIL'})</div>
        <div>${failed.length} failed check${failed.length === 1 ? '' : 's'}:
          ${failed.map(([id, c]) => `<span class="chip fail" title="${escapeHtml(c.threshold)}">${id} (${c.severity})</span>`).join('') || '<em>none</em>'}</div>
        <div class="checks">${checks}</div>
        ${issues ? `<div class="issues">${issues}</div>` : ''}
      </td>
      <td class="verdict">${result.ok ? '<span class="ok">OK</span>' : `<span class="bad">${escapeHtml(result.failed.join(', '))}</span>`}</td>
    </tr>`)
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Shenron City — visual QA contact sheet</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #14161a; color: #dfe3ea; }
  h1 { font-size: 18px; }
  .sub { color: #9aa3b2; font-size: 13px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #2a2e36; padding: 8px; vertical-align: top; }
  .id { font-family: monospace; white-space: nowrap; }
  .pair figure { margin: 0; display: inline-block; }
  .pair img { width: 280px; height: 157px; object-fit: cover; display: block; }
  .pair figcaption { font-size: 11px; color: #9aa3b2; }
  .meta { font-size: 12px; line-height: 1.6; }
  .checks { margin-top: 6px; }
  .chip { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; margin-right: 3px; }
  .chip.pass { background: #14371f; color: #7ee2a8; }
  .chip.fail { background: #3b1414; color: #ff9d9d; }
  .ok { color: #7ee2a8; }
  .bad { color: #ff9d9d; }
  .issues { margin-top: 6px; color: #ffd39d; }
  .skipped td { color: #9aa3b2; }
  .verdict { white-space: nowrap; }
</style>
</head>
<body>
<h1>Shenron City — visual QA contact sheet</h1>
<div class="sub">generated ${new Date().toISOString()} · git ${runSummary.git_rev} · server ${escapeHtml(runSummary.server)}</div>
<table>
<thead><tr><th>scene</th><th>frames (A / B)</th><th>metadata & checks</th><th>verdict</th></tr></thead>
<tbody>${rows.join('\n')}</tbody>
</table>
</body>
</html>
`

const outPath = join(REPO_ROOT, 'evidence', 'visual', 'contact-sheet.html')
mkdirSync(join(REPO_ROOT, 'evidence', 'visual'), { recursive: true })
writeFileSync(outPath, html)
console.log(`contact sheet written to ${outPath}`)

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
