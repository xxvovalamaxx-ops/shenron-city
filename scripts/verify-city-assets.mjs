import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const assets = {
  'public/models/city/buildings/building-g.glb':
    '9a28fa2fdfac07492ee95589882213cfd6eb32d6752cb3b2f5404604c676d27a',
  'public/models/city/buildings/building-j.glb':
    'eedc2690cda345b62351f03a218a817a6ad59f399c12e064ca5ff37333d059f5',
  'public/models/city/buildings/building-k.glb':
    'afd36f573b9d6a6a890675aa0fbe762b29efb6258f322990752d79d9f0da42c6',
  'public/models/city/buildings/building-l.glb':
    '0c3d1b346c142198b7f504d12b40cb1630bb14c3ff38a013922b700d09f9dcff',
  'public/models/city/buildings/building-skyscraper-c.glb':
    'e73c357554f7561fedb8c1cbecf9d7163ba09ada264d661c59a0f0a180e0185f',
  'public/models/city/nature/plant_bushDetailed.glb':
    '2e0487020d68ccf664435db9d829c78ae00e6d2785ee3ec10b9f89cc70a10406',
  'public/models/city/nature/rock_largeB.glb':
    'caa8b025833d4dabf6d98fe2e96cf2fbd886693ac990df0db75f9d827194374b',
  'public/models/city/nature/tree_detailed.glb':
    'c041daf2f0fb1d49e4325227cbcd58667adbe51e9b55e8c1f0a94b74cc521b3b',
  'public/models/city/nature/tree_oak.glb':
    'd7fd8773674928c50c11b66d12c636d49bdcc15a8b1c7fbb98e6f63a3439a3f3',
  'public/models/city/nature/tree_thin.glb':
    'f0f1f6861fe0446963d3be216cc628324f538bb0841bc9a8e14140313f64e2f3',
  'public/models/city/vehicles/race-future.glb':
    '869e2a58d2c12de474e824aff137334491b8f234b97127cf23f1ea04e42deec6',
  'public/models/city/vehicles/sedan.glb':
    'b532ea7d2c59f7f6b22b138cf1955218a2c1898f1cea932af4d3fd563c3959b7',
  'public/models/city/vehicles/taxi.glb':
    '3803539718ffd3b84b515dbce8ed6b489f1ff5be58edb1903d2c5db5c584bdc7',
  'public/models/city/vehicles/van.glb':
    'ed4ed56e8e5ed98db050af09ed2062b3b6bb7b93eab1e563cb6774b387b233a1',
}
const dependencies = {
  'public/models/city/buildings/Textures/colormap.png':
    '191bec3889aaaca5018380038fecc129ebb5c2182879a099b7b538b3fa050b5d',
  'public/models/city/vehicles/Textures/colormap.png':
    'f3622a03a20c6696065cae9cbe391351be873508af190c2ebd1d420c055787a5',
}

const findings = []
let totalBytes = 0

for (const [relativePath, expectedHash] of Object.entries(assets)) {
  const file = readFileSync(join(root, relativePath))
  totalBytes += file.length
  const hash = createHash('sha256').update(file).digest('hex')
  if (hash !== expectedHash) findings.push(`${relativePath}: SHA-256 changed`)
  if (file.toString('ascii', 0, 4) !== 'glTF') findings.push(`${relativePath}: invalid GLB magic`)
  if (file.readUInt32LE(4) !== 2) findings.push(`${relativePath}: GLB version must be 2`)
  if (file.readUInt32LE(8) !== file.length) findings.push(`${relativePath}: invalid GLB length`)

  let offset = 12
  let json
  while (offset < file.length) {
    const length = file.readUInt32LE(offset)
    const type = file.readUInt32LE(offset + 4)
    const chunk = file.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').replace(/\0+$/, ''))
    offset += 8 + length
  }

  if (!json) {
    findings.push(`${relativePath}: missing JSON chunk`)
    continue
  }
  for (const image of json.images ?? []) {
    if (
      image.uri &&
      !image.uri.startsWith('data:') &&
      image.uri !== 'Textures/colormap.png'
    ) {
      findings.push(`${relativePath}: external image URI ${image.uri}`)
    }
  }
  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? [])
  if (primitives.length === 0) findings.push(`${relativePath}: no mesh primitives`)
  if (primitives.some((primitive) => primitive.extensions?.KHR_draco_mesh_compression)) {
    findings.push(`${relativePath}: remote Draco decoder required`)
  }
}

for (const [relativePath, expectedHash] of Object.entries(dependencies)) {
  const file = readFileSync(join(root, relativePath))
  totalBytes += file.length
  const hash = createHash('sha256').update(file).digest('hex')
  if (hash !== expectedHash) findings.push(`${relativePath}: SHA-256 changed`)
}

if (totalBytes > 2.5 * 1024 * 1024) {
  findings.push(`curated city asset set is ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`City asset violation: ${finding}`)
  process.exit(1)
}

console.log(
  `City asset set verified: ${Object.keys(assets).length} pinned GLBs, ` +
    `${(totalBytes / 1024 / 1024).toFixed(2)} MB, pinned local dependencies only.`,
)
