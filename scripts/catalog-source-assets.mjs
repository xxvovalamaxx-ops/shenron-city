import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const animationRoot = resolve(repoRoot, 'SourceAssets/Animations/Raw/Unverified')
const textureRoot = resolve(repoRoot, 'public/textures')
const catalogRoot = resolve(repoRoot, 'SourceAssets/Catalogs')

async function filesBelow(root, extension) {
  const files = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (!extension || entry.name.toLowerCase().endsWith(extension)) files.push(path)
    }
  }
  try {
    await visit(root)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return files.sort((a, b) => a.localeCompare(b, 'en'))
}

function animationFamily(filename) {
  const name = filename.toLowerCase()
  const families = [
    ['dance', /dance|salsa|samba|rumba|hip hop|breakdance|moonwalk/],
    ['combat', /attack|fight|punch|kick|sword|pistol|rifle|gun|shoot|aim|reload|grenade|hit|death|dying|block|evade|combat/],
    ['locomotion', /walk|run|jog|sprint|strafe|crawl|jump|fall|land|climb|turn|swim|vault/],
    ['interaction', /sit|stand up|pick|push|pull|carry|phone|typing|drink|eat|open|close|briefcase|button/],
    ['social', /talk|agree|disagree|wave|clap|laugh|cry|angry|gesture|greet|bow|point|cheer/],
    ['idle', /idle|breath|look around|waiting/],
    ['sports', /basketball|football|soccer|golf|tennis|baseball|volleyball|skate/],
    ['medical', /cpr|medical|injur|agony|faint|recovery/],
  ]
  return families.find(([, pattern]) => pattern.test(name))?.[0] ?? 'other'
}

function duplicateKey(filename) {
  return filename.replace(/ \(\d+\)(?=\.fbx$)/i, '').toLowerCase()
}

function csvCell(value) {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function csv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`
}

async function animationCatalog() {
  const files = await filesBelow(animationRoot, '.fbx')
  const duplicateCounts = new Map()
  for (const path of files) {
    const key = duplicateKey(path.split(/[\\/]/).at(-1))
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1)
  }

  const rows = [[
    'relative_path',
    'filename',
    'suggested_family',
    'duplicate_group_size',
    'size_bytes',
    'source_commit',
    'review_status',
  ]]
  for (const path of files) {
    const info = await stat(path)
    const filename = path.split(/[\\/]/).at(-1)
    rows.push([
      relative(repoRoot, path).replaceAll('\\', '/'),
      filename,
      animationFamily(filename),
      duplicateCounts.get(duplicateKey(filename)),
      info.size,
      'b50b5b2',
      'license-review-required',
    ])
  }
  return { rows, count: files.length }
}

async function textureCatalog() {
  const files = await filesBelow(textureRoot, '.jpg')
  const manifest = await readFile(resolve(repoRoot, 'docs/Assets/ASSET_MANIFEST.csv'), 'utf8')
  const manifestSha256 = createHash('sha256').update(manifest).digest('hex')
  const rows = [[
    'relative_path',
    'category',
    'asset_family',
    'map',
    'size_bytes',
    'license',
    'provenance_manifest_sha256',
  ]]
  for (const path of files) {
    const info = await stat(path)
    const relativePath = relative(repoRoot, path).replaceAll('\\', '/')
    const [, , category, filename] = relativePath.split('/')
    const match = filename.match(/^(.*)_(diffuse|normal|roughness)\.jpg$/)
    rows.push([
      relativePath,
      category,
      match?.[1] ?? filename.replace(/\.jpg$/, ''),
      match?.[2] ?? 'unknown',
      info.size,
      'CC0',
      manifestSha256,
    ])
  }
  return { rows, count: files.length }
}

const animations = await animationCatalog()
const textures = await textureCatalog()
await writeFile(resolve(catalogRoot, 'ANIMATION_CATALOG.csv'), csv(animations.rows), 'utf8')
await writeFile(resolve(catalogRoot, 'TEXTURE_CATALOG.csv'), csv(textures.rows), 'utf8')
process.stdout.write(
  `Cataloged ${animations.count} animations and ${textures.count} runtime textures.\n`,
)
