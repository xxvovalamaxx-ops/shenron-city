// defect-to-test.mjs — turn confirmed visual-review defects into a runnable
// node:test regression file. Zero dependencies: Node built-ins only.
//
//   node scripts/vision/defect-to-test.mjs [defects.json] [--out file.test.mjs]
//
//   defects.json  array of defect records, or { defects: [...] }, in the
//                 schema of scripts/vision/defect-schema.json.
//                 Default: <repo>/docs/qa/evidence/vision/defects.json
//   --out         output path. Default: <repo>/scripts/vision/generated/defects.test.mjs
//
//   FRAMECHECK_PATH (env, optional) — path to the framecheck module. Used both
//   at generation time (to warn if it is missing) and honoured again when the
//   generated tests run. Default:
//   <repo>/apps/manhattan-threejs/src/framecheck.js
//
// Behaviour:
//   - Only status 'confirmed' defects with a numeric `check` are converted.
//     A confirmed defect with no check violates the round-trip rule and is
//     skipped with a warning: it cannot be closed until it is reduced to a
//     number.
//   - If the input file does not exist the converter exits 0 with a notice
//     (nothing to do) instead of crashing; if it is malformed it exits 1.
//   - If framecheck.js does not exist yet (the qa-integrity worker builds it
//     in parallel) the converter says so, and the generated tests fail with a
//     clear message instead of crashing when run.
//   - Run the generated file with: node --test scripts/vision/generated/defects.test.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

const DEFAULT_IN = path.join(REPO, 'docs', 'qa', 'evidence', 'vision', 'defects.json')
const DEFAULT_OUT = path.join(HERE, 'generated', 'defects.test.mjs')
const DEFAULT_FRAMECHECK = path.join(REPO, 'apps', 'manhattan-threejs', 'src', 'framecheck.js')

const OPERATORS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'approx']
const SEVERITIES = ['critical', 'major', 'minor']
const CATEGORIES = ['occlusion', 'culling', 'unlit', 'z-fighting', 'pop-in',
  'clipping', 'missing geometry', 'texture', 'audio', 'other']

function usage() {
  return [
    'usage: node scripts/vision/defect-to-test.mjs [defects.json] [--out file.test.mjs]',
    `  defects.json  defect records in the vision schema (default ${DEFAULT_IN})`,
    `  --out         generated node:test file (default ${DEFAULT_OUT})`,
    '  env FRAMECHECK_PATH overrides the framecheck module path',
  ].join('\n')
}

function parseArgs(argv) {
  const args = { in: null, out: null }
  const rest = [...argv]
  while (rest.length) {
    const a = rest.shift()
    if (a === '--out') args.out = rest.shift()
    else if (a.startsWith('--')) { console.error(usage()); process.exit(2) }
    else if (!args.in) args.in = a
    else { console.error('unexpected argument: ' + a + '\n' + usage()); process.exit(2) }
  }
  return args
}

function fmtNum(x) {
  if (Number.isInteger(x)) return String(x)
  return x.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const inPath = path.resolve(args.in || DEFAULT_IN)
  const outPath = path.resolve(args.out || DEFAULT_OUT)

  if (!fs.existsSync(inPath)) {
    console.log(`defect-to-test: no defect file at ${inPath} — nothing to generate (exiting cleanly).`)
    return
  }

  let raw
  try {
    raw = JSON.parse(fs.readFileSync(inPath, 'utf8'))
  } catch (e) {
    console.error(`defect-to-test: ${inPath} is not valid JSON: ${e.message}`)
    process.exit(1)
  }

  const defects = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.defects) ? raw.defects : null)
  if (!defects) {
    console.error('defect-to-test: expected a JSON array or { defects: [...] }')
    process.exit(1)
  }

  const problems = []
  for (const d of defects) {
    if (!d || typeof d !== 'object') { problems.push('non-object record'); continue }
    if (!/^V-[0-9]{4,}$/.test(d.id || '')) problems.push(`${d.id || '(no id)'}: id must match ^V-[0-9]{4,}$`)
    if (!SEVERITIES.includes(d.severity)) problems.push(`${d.id}: bad severity ${JSON.stringify(d.severity)}`)
    if (!CATEGORIES.includes(d.category)) problems.push(`${d.id}: bad category ${JSON.stringify(d.category)}`)
    if (!['open', 'confirmed', 'rejected'].includes(d.status)) problems.push(`${d.id}: bad status ${JSON.stringify(d.status)}`)
    if (d.status === 'confirmed') {
      if (!d.check) problems.push(`${d.id}: confirmed but has no check — violates the round-trip rule`)
      else {
        if (!d.check.fn || typeof d.check.fn !== 'string') problems.push(`${d.id}: check.fn must be a string`)
        if (!OPERATORS.includes(d.check.operator)) problems.push(`${d.id}: bad check.operator ${JSON.stringify(d.check.operator)}`)
        if (typeof d.check.threshold !== 'number') problems.push(`${d.id}: check.threshold must be a number`)
      }
    }
  }
  if (problems.length) {
    console.error('defect-to-test: invalid records in ' + inPath + ':')
    for (const p of problems) console.error('  - ' + p)
    process.exit(1)
  }

  const converted = defects.filter((d) => d.status === 'confirmed' && d.check)
  const skipped = defects.filter((d) => d.status !== 'confirmed' || !d.check)

  if (skipped.length) {
    console.log(`defect-to-test: skipping ${skipped.length} non-confirmed/no-check record(s): ` +
      skipped.map((d) => `${d.id || '(no id)'} (${d.status || '?'})`).join(', '))
  }

  const framecheckPath = process.env.FRAMECHECK_PATH
    ? path.resolve(process.cwd(), process.env.FRAMECHECK_PATH)
    : DEFAULT_FRAMECHECK

  if (!fs.existsSync(framecheckPath)) {
    console.warn(`defect-to-test: WARNING — framecheck module does not exist at ${framecheckPath}.`)
    console.warn(`defect-to-test: the generated tests will fail with a clear message (not crash) until ` +
      `apps/manhattan-threejs/src/framecheck.js lands from the qa-integrity worker.`)
  }

  const requiredExports = [...new Set(converted.map((d) => d.check.fn))].sort()
  const generatedAt = new Date().toISOString()

  const tests = converted.map((d) => {
    const c = d.check
    const args = (c.args || ['$IMAGE']).map((a) => {
      if (a === '$IMAGE') return JSON.stringify(path.resolve(REPO, d.image || ''))
      if (a === '$IMAGE_DIR') return JSON.stringify(path.dirname(path.resolve(REPO, d.image || '')))
      return JSON.stringify(a)
    })
    const unit = c.unit ? ` (${c.unit})` : ''
    const label = `${d.id}: ${c.fn}${args.length ? '(...)' : '()'} ${c.operator} ${fmtNum(c.threshold)}${unit}`
    const opExpr = {
      lt: '<', lte: '<=', gt: '>', gte: '>=',
      eq: '===', neq: '!==',
      approx: '≈',
    }[c.operator]
    const verdictExpr = c.operator === 'approx'
      ? `Math.abs(got - ${fmtNum(c.threshold)}) <= Math.abs(${fmtNum(c.threshold)}) * 0.05`
      : `got ${opExpr} ${fmtNum(c.threshold)}`
    return `test(${JSON.stringify(label)}, async () => {
  const fc = await loadFramecheck()
  const args = [${args.join(', ')}]
  const got = fc[${JSON.stringify(c.fn)}](...args)
  assert.ok(${verdictExpr},
    ${JSON.stringify(d.id)} + ': ' + ${JSON.stringify(c.fn)} + '(...) = ' + fmt(got) +
    ', expected ' + ${JSON.stringify(opExpr)} + ' ' + ${JSON.stringify(fmtNum(c.threshold))} + '\\n  ' + ${JSON.stringify(d.description)})
})`
  })

  const header = `// GENERATED FILE — do not edit by hand.
// Converter: scripts/vision/defect-to-test.mjs
// Source defects: ${inPath}
// Generated: ${generatedAt}
// Defects converted: ${converted.length} (${skipped.length} skipped)
// Regenerate with: node scripts/vision/defect-to-test.mjs
// Run with: node --test scripts/vision/generated/defects.test.mjs
// The framecheck module is built in parallel by the qa-integrity worker.
// Override its path at runtime with the FRAMECHECK_PATH env var.
`
  const code = `${header}
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_FRAMECHECK = ${JSON.stringify(framecheckPath)}
const REQUIRED_EXPORTS = ${JSON.stringify(requiredExports)}

let cached = null

function framecheckUrl() {
  const p = process.env.FRAMECHECK_PATH
    ? path.resolve(process.cwd(), process.env.FRAMECHECK_PATH)
    : DEFAULT_FRAMECHECK
  return pathToFileURL(p).href
}

// Loads the numeric check module and fails with an explicit message when it
// does not exist yet or does not export what the defects ask for. A missing
// module is a pipeline-stage problem, not a crash: the qa-integrity worker
// owns that file and it lands in parallel with this branch.
async function loadFramecheck() {
  if (cached) return cached
  const url = framecheckUrl()
  let mod
  try {
    mod = await import(url)
  } catch (e) {
    throw new Error(
      'vision: cannot load framecheck module from ' + url + '\\n' +
      'The module does not exist yet or is not importable — the qa-integrity worker ' +
      'builds apps/manhattan-threejs/src/framecheck.js in parallel. Re-run this test once it lands.\\n' +
      'Original error: ' + (e && e.message))
  }
  const missing = REQUIRED_EXPORTS.filter((f) => typeof mod[f] !== 'function')
  if (missing.length) {
    // Kept free of apostrophes so this emitted error message never needs
    // escaping inside a single-quoted string literal.
    throw new Error(
      'vision: framecheck module at ' + url + ' loaded but does not export: ' + missing.join(', ') + '\\n' +
      'The defect records were written against the export contract in docs/qa/DEFECT_SCHEMA.md. ' +
      'Update the records check.fn or the module exports, then regenerate with ' +
      'node scripts/vision/defect-to-test.mjs.')
  }
  cached = mod
  return mod
}

function fmt(x) {
  if (typeof x === 'number') return Number.isInteger(x) ? String(x) : x.toFixed(6)
  return String(x)
}

${tests.join('\n\n')}
`

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, code)
  console.log(`defect-to-test: wrote ${converted.length} test(s) -> ${outPath}`)
  console.log(`defect-to-test: framecheck module: ${framecheckPath}`)
}

main()
