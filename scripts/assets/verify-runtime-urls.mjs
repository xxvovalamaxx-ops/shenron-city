/**
 * Every asset URL the game can ask for must resolve to a file it will get.
 *
 * 0E.1 gated a model's *internal* dependencies — the textures a GLB reaches for
 * once loaded. This gates the other direction: the URLs the source reaches for
 * in the first place, plus the ones that come out of generated manifests.
 *
 * The failure this prevents is the one 0E.1 was written for, one level up. A
 * manifest of hand-listed files cannot fail on the file nobody listed, and the
 * tile and LOD sets are far too large to list by hand — 251 literal URLs in
 * source and 246 more inside the LOD manifest. Renaming one export, or
 * regenerating tiles with a different grid, produces a 404 at runtime and a
 * green asset check.
 *
 * Coverage is reported honestly rather than implied. URLs built at runtime
 * from template literals cannot be resolved statically; this counts them and
 * names where they are, so "everything checks out" never quietly means
 * "everything I could see checks out".
 *
 * Usage:
 *   node scripts/assets/verify-runtime-urls.mjs [--json]
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, relative } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const PUBLIC = join(REPO_ROOT, 'public')
const SRC = join(REPO_ROOT, 'src')

/** Path prefixes that mean "a file served out of public/". */
const ASSET_ROOTS = ['/models', '/hdr', '/draco', '/textures', '/audio', '/fonts']

/** A quoted string starting with one of the asset roots. */
const LITERAL = new RegExp(
  `['"\`](${ASSET_ROOTS.map((r) => r.replace('/', '\\/')).join('|')})/[^'"\`\\n]*['"\`]`,
  'g',
)

/** A template literal that interpolates into an asset path. */
const DYNAMIC = new RegExp(
  '`(' + ASSET_ROOTS.map((r) => r.replace('/', '\\/')).join('|') + ')/[^`\\n]*\\$\\{',
  'g',
)

function walk(dir, test, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, test, out)
    else if (test(entry)) out.push(full)
  }
  return out
}

/** Strip a cache-busting query and any hash. */
function cleanUrl(url) {
  return url.split('?')[0].split('#')[0]
}

export function collectFromSource() {
  const files = walk(SRC, (n) => /\.(ts|tsx|js|jsx)$/.test(n) && !/\.test\./.test(n))
  const urls = new Map()
  const dynamic = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(REPO_ROOT, file)

    for (const match of text.matchAll(LITERAL)) {
      const raw = match[0].slice(1, -1)
      // A template literal's fixed prefix matches this pattern too — the
      // regex stops at the first interpolation, leaving a half-URL like
      // `/models/manhattan/lod/${`. Resolving that as a filename reports a
      // missing asset that was never asked for. Those are counted separately
      // as dynamic constructions instead.
      if (raw.includes('${')) continue
      const url = cleanUrl(raw)
      // A bare directory (the Draco decoder path) is a prefix, not a file.
      if (url.endsWith('/')) continue
      if (!urls.has(url)) urls.set(url, rel)
    }
    for (const match of text.matchAll(DYNAMIC)) {
      const line = text.slice(0, match.index).split('\n').length
      dynamic.push({ file: rel, line, snippet: match[0].replace(/\s+/g, ' ').slice(0, 60) })
    }
  }
  return { urls, dynamic }
}

/**
 * URLs named inside generated manifests.
 *
 * These are the ones a hand-written list cannot cover: the LOD manifest alone
 * names 246 files, and it is regenerated whenever the world is rebuilt.
 */
export function collectFromManifests() {
  const urls = new Map()

  const lodPath = join(PUBLIC, 'models', 'manhattan', 'lod', 'lod_manifest.json')
  if (existsSync(lodPath)) {
    const text = readFileSync(lodPath, 'utf8')
    for (const name of new Set(text.match(/[A-Za-z0-9_+\-.]+\.glb/g) ?? [])) {
      urls.set(`/models/manhattan/lod/${name}`, 'lod_manifest.json')
    }
  }

  // The tile lists the streamer actually reads.
  //
  // Not manhattan-tiles.ts. That file looks authoritative — 196 generated
  // lines listing 132 building tiles and 61 street tiles, with a regeneration
  // command in its header — and nothing imports it. TileStreamer takes its
  // list from city.json's `meta.tiles` and `meta.street_tiles`, so those are
  // the ones a 404 would come from.
  const cityPath = join(PUBLIC, 'models', 'manhattan', 'data', 'city.json')
  if (existsSync(cityPath)) {
    const city = JSON.parse(readFileSync(cityPath, 'utf8'))
    for (const [key, origin] of [
      ['tiles', 'city.json meta.tiles'],
      ['street_tiles', 'city.json meta.street_tiles'],
    ]) {
      for (const entry of city[key]?.list ?? []) {
        const file = typeof entry === 'string' ? entry : entry.file
        if (file) urls.set(`/models/manhattan/${file}`, origin)
      }
    }
  }

  const doorsPath = join(PUBLIC, 'models', 'manhattan', 'doors', 'doors.json')
  if (existsSync(doorsPath)) {
    const doors = JSON.parse(readFileSync(doorsPath, 'utf8'))
    // Doors name buildings, not files, so nothing to resolve — recorded so a
    // reader knows it was looked at rather than skipped.
    void doors
  }

  return urls
}

function main() {
  const asJson = process.argv.includes('--json')
  const { urls: sourceUrls, dynamic } = collectFromSource()
  const manifestUrls = collectFromManifests()

  const all = new Map([...sourceUrls, ...manifestUrls])
  const missing = []
  for (const [url, origin] of all) {
    const file = join(PUBLIC, url.replace(/^\//, ''))
    if (!existsSync(file) || !statSync(file).isFile()) {
      missing.push({ url, origin })
    }
  }

  const report = {
    generatedBy: 'scripts/assets/verify-runtime-urls.mjs',
    fromSource: sourceUrls.size,
    fromManifests: manifestUrls.size,
    checked: all.size,
    missing,
    /** Cannot be resolved statically. Counted so the gap is visible. */
    dynamicConstructions: dynamic,
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(
      `verify-runtime-urls: ${all.size} URL(s) — ` +
        `${sourceUrls.size} from source, ${manifestUrls.size} from manifests`,
    )
    if (dynamic.length) {
      console.log(
        `  ${dynamic.length} URL(s) built at runtime and NOT checked here:`,
      )
      for (const d of dynamic.slice(0, 6)) {
        console.log(`    ${d.file}:${d.line}  ${d.snippet}`)
      }
    }
    for (const m of missing) {
      console.error(`  MISSING ${m.url}  (referenced by ${m.origin})`)
    }
    console.log(`  ${missing.length} missing`)
  }

  process.exit(missing.length ? 1 : 0)
}

const entry = process.argv[1]
if (entry && import.meta.url === new URL(`file://${entry.split('\\').join('/')}`).href) {
  main()
}
