import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimePath = 'public/models/animals/capybara/capybara.glb'
const expectedFiles = {
  [runtimePath]: '67d2e94e82ac53ef4f6f07abcd6f059c955618234693553da40f2fb34277a693',
  'public/models/animals/capybara/textures/capybara_game_albedo.jpg':
    '66e0eb068cc1d240f5f9bb3f3a42ad9b64cbdbc739e8786aab56237ef6b3ed7e',
  'public/models/animals/capybara/textures/capybara_game_normal.png':
    '4b7429e833bd1d34377b2f36d49623bcaebaa33186a13f22ad0a7682797305e8',
  'public/models/animals/capybara/textures/capybara_game_roughness.png':
    '8bcfe4f07f15d204cfe11b8857fe485c6c40deba0051cf29e9d99d192e3b287e',
}
const assetPath = join(root, runtimePath)
const file = readFileSync(assetPath)
const findings = []

if (!existsSync(join(root, 'scripts/externalize-glb-images.mjs'))) {
  findings.push('missing browser-safe GLB packaging script')
}

for (const [relativePath, expectedHash] of Object.entries(expectedFiles)) {
  const absolutePath = join(root, relativePath)
  if (!existsSync(absolutePath)) {
    findings.push(`missing pinned runtime file: ${relativePath}`)
    continue
  }
  const actualHash = createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
  if (actualHash !== expectedHash) findings.push(`${relativePath}: SHA-256 changed to ${actualHash}`)
}

if (file.length > 8 * 1024 * 1024) findings.push(`runtime GLB is ${(file.length / 1024 / 1024).toFixed(2)} MB`)
if (file.toString('ascii', 0, 4) !== 'glTF') findings.push('invalid GLB magic')
if (file.readUInt32LE(4) !== 2) findings.push('GLB version must be 2')
if (file.readUInt32LE(8) !== file.length) findings.push('GLB header length does not match file size')

let offset = 12
let json
let binary
while (offset < file.length) {
  const length = file.readUInt32LE(offset)
  const type = file.readUInt32LE(offset + 4)
  const chunk = file.subarray(offset + 8, offset + 8 + length)
  if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').replace(/\0+$/, ''))
  if (type === 0x004e4942) binary = chunk
  offset += 8 + length
}

if (!json || !binary) {
  findings.push('GLB must contain JSON and binary chunks')
} else {
  const expectedClips = [
    'capybara_alert_startle',
    'capybara_drink',
    'capybara_ear_flick_l',
    'capybara_ear_flick_r',
    'capybara_graze',
    'capybara_idle_breathe',
    'capybara_idle_shift',
    'capybara_lie_down',
    'capybara_run',
    'capybara_sit_down',
    'capybara_sit_idle',
    'capybara_sleep',
    'capybara_sniff',
    'capybara_stand_up',
    'capybara_swim',
    'capybara_trot',
    'capybara_turn_l_90',
    'capybara_turn_r_90',
    'capybara_vocalize',
    'capybara_wake_up',
    'capybara_walk',
  ]
  const clips = (json.animations ?? []).map((animation) => animation.name).sort()
  if (JSON.stringify(clips) !== JSON.stringify(expectedClips)) {
    findings.push(`animation contract mismatch: ${JSON.stringify(clips)}`)
  }

  if ((json.skins ?? []).length !== 1) findings.push('expected exactly one skin')
  if ((json.skins?.[0]?.joints?.length ?? 0) !== 43) {
    findings.push(`expected 43 skin joints, found ${json.skins?.[0]?.joints?.length ?? 0}`)
  }

  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? [])
  if (primitives.length !== 1) findings.push(`expected one runtime primitive, found ${primitives.length}`)
  for (const primitive of primitives) {
    if (primitive.attributes?.JOINTS_0 === undefined || primitive.attributes?.WEIGHTS_0 === undefined) {
      findings.push('runtime primitive is not skinned')
    }
    if (primitive.attributes?.JOINTS_1 !== undefined || primitive.attributes?.WEIGHTS_1 !== undefined) {
      findings.push('runtime primitive exceeds the four-influence contract')
    }
    if (primitive.extensions?.KHR_draco_mesh_compression) {
      findings.push('runtime primitive must not require a remote Draco decoder')
    }
  }

  const extensions = new Set([...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])])
  if (extensions.has('KHR_draco_mesh_compression')) findings.push('GLB declares Draco compression')

  const expectedImageUris = new Set(
    Object.keys(expectedFiles)
      .filter((relativePath) => /\.(?:jpe?g|png)$/i.test(relativePath))
      .map((relativePath) => relativePath.split('capybara/')[1]),
  )
  for (const image of json.images ?? []) {
    if (!expectedImageUris.delete(image.uri)) {
      findings.push(`unexpected image URI: ${image.uri ?? 'embedded image'}`)
      continue
    }
    if (image.bufferView !== undefined || image.mimeType !== undefined) {
      findings.push(`${image.name ?? 'image'} must use a direct same-origin texture`)
      continue
    }
    const texturePath = join(dirname(assetPath), image.uri)
    const bytes = readFileSync(texturePath)
    const mimeType = image.uri.endsWith('.png') ? 'image/png' : 'image/jpeg'
    const dimensions = imageDimensions(bytes, mimeType)
    if (!dimensions) {
      findings.push(`could not inspect ${image.uri}`)
      continue
    }
    if (Math.max(dimensions.width, dimensions.height) > 2048) {
      findings.push(`${image.uri} exceeds 2K: ${dimensions.width}x${dimensions.height}`)
    }
  }
  if (expectedImageUris.size > 0) {
    findings.push(`GLB is missing texture URIs: ${[...expectedImageUris].join(', ')}`)
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Capybara asset violation: ${finding}`)
  process.exit(1)
}

console.log(
  `Capybara GLB verified: ${(file.length / 1024 / 1024).toFixed(2)} MB, ` +
    `${json.animations.length} clips, ${json.skins[0].joints.length} bones, three pinned textures, no Draco.`,
)

function imageDimensions(bytes, mimeType) {
  if (mimeType === 'image/png' && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (mimeType !== 'image/jpeg') return null

  let cursor = 2
  while (cursor + 8 < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      cursor++
      continue
    }
    const marker = bytes[cursor + 1]
    cursor += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    const length = bytes.readUInt16BE(cursor)
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(cursor + 3), width: bytes.readUInt16BE(cursor + 5) }
    }
    cursor += length
  }
  return null
}
