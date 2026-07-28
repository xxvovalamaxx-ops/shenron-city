import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const assetPath = join(
  root,
  'public',
  'models',
  'characters',
  'service-android',
  'service-android.glb',
)
const file = readFileSync(assetPath)
const findings = []
const expectedHash = '047f5e5fb3bb6d378bd1df16ca6137f2a596c99b3a1b5690b4020c05aaf6f319'
const actualHash = createHash('sha256').update(file).digest('hex')

if (actualHash !== expectedHash) findings.push(`SHA-256 changed: ${actualHash}`)
if (file.length > 1024 * 1024) findings.push(`runtime GLB is ${(file.length / 1024 / 1024).toFixed(2)} MB`)
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
  const expectedClips = [
    'Dance',
    'Death',
    'Idle',
    'Jump',
    'No',
    'Punch',
    'Running',
    'Sitting',
    'Standing',
    'ThumbsUp',
    'WalkJump',
    'Walking',
    'Wave',
    'Yes',
  ]
  const clips = (json.animations ?? []).map((animation) => animation.name).sort()
  if (JSON.stringify(clips) !== JSON.stringify(expectedClips)) {
    findings.push(`animation contract mismatch: ${JSON.stringify(clips)}`)
  }

  const skins = json.skins ?? []
  if (skins.length !== 2) findings.push(`expected two skins, found ${skins.length}`)
  if (skins.some((skin) => (skin.joints?.length ?? 0) < 20)) {
    findings.push('every service-android skin must have at least 20 joints')
  }

  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? [])
  const skinned = primitives.filter(
    (primitive) =>
      primitive.attributes?.JOINTS_0 !== undefined &&
      primitive.attributes?.WEIGHTS_0 !== undefined,
  )
  if (skinned.length < 2) findings.push(`expected skinned body primitives, found ${skinned.length}`)
  if (primitives.some((primitive) => primitive.extensions?.KHR_draco_mesh_compression)) {
    findings.push('runtime primitive must not require a remote Draco decoder')
  }

  const morphNames = new Set(
    (json.meshes ?? []).flatMap((mesh) => Object.keys(mesh.extras?.targetNames ?? {})),
  )
  const declaredMorphs = new Set(
    (json.meshes ?? []).flatMap((mesh) => mesh.extras?.targetNames ?? []),
  )
  for (const name of ['Angry', 'Surprised', 'Sad']) {
    if (!declaredMorphs.has(name) && !morphNames.has(name)) {
      findings.push(`missing facial morph target: ${name}`)
    }
  }

  for (const image of json.images ?? []) {
    if (image.uri && /^(?:https?:)?\/\//i.test(image.uri)) {
      findings.push(`external image URI: ${image.uri}`)
    }
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Service android asset violation: ${finding}`)
  process.exit(1)
}

console.log(
  `Service android GLB verified: ${(file.length / 1024).toFixed(1)} KB, ` +
    `${json.animations.length} clips, ${json.skins.length} skins, pinned SHA-256.`,
)
