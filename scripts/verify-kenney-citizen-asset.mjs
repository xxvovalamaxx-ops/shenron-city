import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimePath = 'public/models/characters/kenney-citizen/kenney-citizen.glb'
const expectedFiles = {
  [runtimePath]: 'fd4140f779612aa48235dcafe07de320b22cf2decb6ffd43642142fc888dfe70',
  'public/models/characters/kenney-citizen/textures/skaterfemalea.png':
    'de575f5075a8991907a4807fea3ef291b8e57778c6c4f4ada990abe7582026df',
  'public/models/characters/kenney-citizen/skins/criminal-male.png':
    'e2f66e682c95253fbb45206ab44bdb4fe61b03af3481abbd0e4344a6958a0530',
  'public/models/characters/kenney-citizen/skins/cyborg-female.png':
    '321b7ba2d81b8b6380d0b0320ebf1117341bfd61ad73711dd8bf9094c26e14d6',
  'public/models/characters/kenney-citizen/skins/human-female.png':
    '8c8387dcc3daced4e0e90c5d22288830ae971fb9b46c32177cc825bfd7a7b2ba',
  'public/models/characters/kenney-citizen/skins/human-male.png':
    '1590e08cea37f5aecbacabb40a57c176e389e9a95d5b2a4de00086604ef23e1c',
  'public/models/characters/kenney-citizen/skins/skater-female.png':
    'de575f5075a8991907a4807fea3ef291b8e57778c6c4f4ada990abe7582026df',
  'public/models/characters/kenney-citizen/skins/skater-male.png':
    'cabeed9d1be58037cc1cf3e29fdb42a0cb6af15bebeed877c41a758a932d14f8',
}
const requiredRecords = [
  'SourceAssets/Models/Characters/KenneyAnimatedCharacters/LICENSE-retro.txt',
  'SourceAssets/Models/Characters/KenneyAnimatedCharacters/LICENSE-protagonists.txt',
  'SourceAssets/Models/Characters/KenneyAnimatedCharacters/README.md',
  'scripts/convert-kenney-character.py',
  'scripts/externalize-glb-images.mjs',
]
const findings = []

for (const relativePath of requiredRecords) {
  if (!existsSync(join(root, relativePath))) findings.push(`missing source record: ${relativePath}`)
}

for (const [relativePath, expectedHash] of Object.entries(expectedFiles)) {
  const absolutePath = join(root, relativePath)
  if (!existsSync(absolutePath)) {
    findings.push(`missing pinned runtime file: ${relativePath}`)
    continue
  }
  const hash = createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
  if (hash !== expectedHash) findings.push(`${relativePath}: SHA-256 changed to ${hash}`)
}

const manifest = readFileSync(join(root, 'docs', 'Assets', 'ASSET_MANIFEST.csv'), 'utf8')
if (!manifest.includes('Kenney Animated Characters')) {
  findings.push('asset manifest is missing the Kenney Animated Characters record')
}

const file = readFileSync(join(root, runtimePath))
if (file.length > 512 * 1024) findings.push(`runtime GLB is ${(file.length / 1024).toFixed(1)} KB`)
if (file.toString('ascii', 0, 4) !== 'glTF') findings.push('invalid GLB magic')
if (file.readUInt32LE(4) !== 2) findings.push('GLB version must be 2')
if (file.readUInt32LE(8) !== file.length) findings.push('GLB header length does not match file size')

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
  findings.push('GLB must contain a JSON chunk')
} else {
  const expectedClips = ['Idle', 'Jump', 'Run']
  const clips = (json.animations ?? []).map((animation) => animation.name).sort()
  if (JSON.stringify(clips) !== JSON.stringify(expectedClips)) {
    findings.push(`animation contract mismatch: ${JSON.stringify(clips)}`)
  }
  for (const animation of json.animations ?? []) {
    if ((animation.channels?.length ?? 0) < 40 || (animation.samplers?.length ?? 0) < 40) {
      findings.push(`${animation.name ?? 'unnamed clip'} has no usable skeletal motion`)
    }
  }

  const skins = json.skins ?? []
  if (skins.length !== 1) findings.push(`expected one skin, found ${skins.length}`)
  if ((skins[0]?.joints?.length ?? 0) !== 45) {
    findings.push(`expected 45 skin joints, found ${skins[0]?.joints?.length ?? 0}`)
  }

  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? [])
  if (primitives.length !== 1) findings.push(`expected one runtime primitive, found ${primitives.length}`)
  for (const primitive of primitives) {
    if (primitive.attributes?.JOINTS_0 === undefined || primitive.attributes?.WEIGHTS_0 === undefined) {
      findings.push('runtime primitive is not skinned')
    }
    if (primitive.extensions?.KHR_draco_mesh_compression) {
      findings.push('runtime primitive must not require a remote Draco decoder')
    }
  }

  const extensions = new Set([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])])
  if (extensions.has('KHR_draco_mesh_compression')) findings.push('GLB declares Draco compression')
  const imageUris = (json.images ?? []).map((image) => image.uri)
  if (JSON.stringify(imageUris) !== JSON.stringify(['textures/skaterfemalea.png'])) {
    findings.push(`unexpected image URIs: ${JSON.stringify(imageUris)}`)
  }
  for (const buffer of json.buffers ?? []) {
    if (buffer.uri && !buffer.uri.startsWith('data:')) findings.push(`external buffer URI: ${buffer.uri}`)
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Kenney citizen asset violation: ${finding}`)
  process.exit(1)
}

console.log(
  `Kenney citizen verified: ${(file.length / 1024).toFixed(1)} KB, ` +
    `${json.animations.length} moving clips, 45 bones, six pinned skins, CC0 records present.`,
)
