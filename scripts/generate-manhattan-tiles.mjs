import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tileDir = join(root, 'public', 'models', 'manhattan')

function readGlbJson(path) {
  const data = readFileSync(path)
  if (data.toString('ascii', 0, 4) !== 'glTF') return null
  let offset = 12
  while (offset < data.length) {
    const length = data.readUInt32LE(offset)
    const type = data.readUInt32LE(offset + 4)
    const chunk = data.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) {
      return JSON.parse(chunk.toString('utf8').replace(/\0+$/, '').trimEnd())
    }
    offset += 8 + length
  }
  return null
}

function tileBounds(document) {
  let min = null
  let max = null
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const position = document.accessors[primitive.attributes.POSITION]
      if (!position || !position.min) continue
      min = min ? position.min.map((v, i) => Math.min(v, min[i])) : [...position.min]
      max = max ? position.max.map((v, i) => Math.max(v, max[i])) : [...position.max]
    }
  }
  return min ? { minX: Math.round(min[0]), minZ: Math.round(min[2]), maxX: Math.round(max[0]), maxZ: Math.round(max[2]) } : null
}

const buildingFiles = readdirSync(tileDir)
  .filter((name) => /^manhattan_[+-]\d\d_[+-]\d\d\.glb$/.test(name))
  .sort()

const streetFiles = readdirSync(tileDir)
  .filter((name) => /^streets_[+-]\d\d_[+-]\d\d\.glb$/.test(name))
  .sort()

const tiles = []
for (const name of buildingFiles) {
  const document = readGlbJson(join(tileDir, name))
  const bounds = document ? tileBounds(document) : null
  if (!bounds) throw new Error(`No POSITION bounds in ${name}`)
  tiles.push({ url: `/models/manhattan/${name}`, ...bounds })
}

const streetTiles = []
for (const name of streetFiles) {
  const document = readGlbJson(join(tileDir, name))
  const bounds = document ? tileBounds(document) : null
  if (!bounds) { console.warn(`Skipping ${name}: no POSITION bounds`); continue }
  streetTiles.push({ url: `/models/manhattan/${name}`, ...bounds })
}

const output = [
  '/* Generated from GLB bounding boxes — do not edit by hand.',
  '   Regenerate with: npm run generate:manhattan-tiles */',
  'export interface ManhattanTile {',
  '  url: string',
  '  minX: number',
  '  minZ: number',
  '  maxX: number',
  '  maxZ: number',
  '}',
  '',
  "export const MANHATTAN_BASE_URL = '/models/manhattan/manhattan_base.glb'",
  '',
  'export const MANHATTAN_TILES: ManhattanTile[] = [',
  ...tiles.map((tile) => `  { url: '${tile.url}', minX: ${tile.minX}, minZ: ${tile.minZ}, maxX: ${tile.maxX}, maxZ: ${tile.maxZ} },`),
  ']',
  '',
  'export const STREET_TILES: ManhattanTile[] = [',
  ...streetTiles.map((tile) => `  { url: '${tile.url}', minX: ${tile.minX}, minZ: ${tile.minZ}, maxX: ${tile.maxX}, maxZ: ${tile.maxZ} },`),
  ']',
  '',
]
writeFileSync(join(root, 'src', 'world', 'manhattan-tiles.ts'), output.join('\n'))
console.log(`Wrote ${tiles.length} Manhattan tiles + ${streetTiles.length} street tiles to src/world/manhattan-tiles.ts`)
