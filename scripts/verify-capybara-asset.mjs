import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const assetPath = join(root, 'public', 'models', 'animals', 'capybara', 'capybara.glb')
const file = readFileSync(assetPath)
const findings = []

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

  for (const image of json.images ?? []) {
    if (image.uri && /^(?:https?:)?\/\//i.test(image.uri)) findings.push(`external image URI: ${image.uri}`)
    if (image.bufferView === undefined) continue
    const view = json.bufferViews?.[image.bufferView]
    if (!view) {
      findings.push(`image references missing bufferView ${image.bufferView}`)
      continue
    }
    const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    const dimensions = imageDimensions(bytes, image.mimeType)
    if (!dimensions) {
      findings.push(`could not inspect ${image.mimeType ?? 'embedded image'}`)
      continue
    }
    if (Math.max(dimensions.width, dimensions.height) > 2048) {
      findings.push(`embedded texture exceeds 2K: ${dimensions.width}x${dimensions.height}`)
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Capybara asset violation: ${finding}`)
  process.exit(1)
}

console.log(
  `Capybara GLB verified: ${(file.length / 1024 / 1024).toFixed(2)} MB, ` +
    `${json.animations.length} clips, ${json.skins[0].joints.length} bones, no Draco.`,
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
