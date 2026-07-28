import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const runtimePath = 'public/models/characters/quaternius-hero/quaternius-hero.glb'
const expectedHash = '90d5de9a91bbad659fa5a771baa505a82702e39f5db536a60496216bf49562ae'
const expectedClips = [
  'Chest_Open',
  'Consume',
  'Dance_Loop',
  'Driving_Loop',
  'Farm_Harvest',
  'Farm_PlantSeed',
  'Farm_Watering',
  'Fixing_Kneeling',
  'Idle_FoldArms_Loop',
  'Idle_Loop',
  'Idle_TalkingPhone_Loop',
  'Idle_Talking_Loop',
  'Interact',
  'Jog_Fwd_Loop',
  'Jump_Land',
  'Jump_Loop',
  'Jump_Start',
  'OverhandThrow',
  'PickUp_Table',
  'Sitting_Enter',
  'Sitting_Exit',
  'Sitting_Idle_Loop',
  'Sitting_Talking_Loop',
  'Sprint_Loop',
  'TreeChopping_Loop',
  'Walk_Carry_Loop',
  'Walk_Formal_Loop',
  'Walk_Loop',
  'Yes',
]
const requiredRecords = [
  'SourceAssets/Models/Characters/QuaterniusUniversal/LICENSE.txt',
  'SourceAssets/Models/Characters/QuaterniusUniversal/README.md',
  'SourceAssets/Animations/Reviewed/QuaterniusUniversal/LICENSE.txt',
  'SourceAssets/Animations/Reviewed/QuaterniusUniversal/README.md',
  'SourceAssets/Catalogs/QUATERNIUS_ANIMATION_CATALOG.csv',
  'scripts/convert-quaternius-hero.py',
]
const findings = []
const componentTypes = {
  5120: { bytes: 1, read: 'getInt8' },
  5121: { bytes: 1, read: 'getUint8' },
  5122: { bytes: 2, read: 'getInt16' },
  5123: { bytes: 2, read: 'getUint16' },
  5125: { bytes: 4, read: 'getUint32' },
  5126: { bytes: 4, read: 'getFloat32' },
}
const componentCounts = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

for (const relativePath of requiredRecords) {
  if (!existsSync(join(root, relativePath))) findings.push(`missing source record: ${relativePath}`)
}

const file = readFileSync(join(root, runtimePath))
const actualHash = createHash('sha256').update(file).digest('hex')
if (actualHash !== expectedHash) findings.push(`SHA-256 changed: ${actualHash}`)
if (file.length > 4.5 * 1024 * 1024) {
  findings.push(`runtime GLB is ${(file.length / 1024 / 1024).toFixed(2)} MB`)
}
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

function accessorHasMotion(accessorIndex) {
  const accessor = json.accessors?.[accessorIndex]
  const view = json.bufferViews?.[accessor?.bufferView]
  const component = componentTypes[accessor?.componentType]
  const componentCount = componentCounts[accessor?.type]
  if (!accessor || !view || !component || !componentCount || !binary || accessor.sparse) return false
  if (accessor.count < 2 || view.buffer !== 0) return false

  const stride = view.byteStride ?? component.bytes * componentCount
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  const first = Array.from({ length: componentCount }, (_, index) =>
    data[component.read](base + index * component.bytes, true),
  )

  for (let sample = 1; sample < accessor.count; sample += 1) {
    for (let index = 0; index < componentCount; index += 1) {
      const value = data[component.read](
        base + sample * stride + index * component.bytes,
        true,
      )
      if (Math.abs(value - first[index]) > 1e-5) return true
    }
  }
  return false
}

if (!json || !binary) {
  findings.push('GLB must contain JSON and binary chunks')
} else {
  const clips = (json.animations ?? []).map((animation) => animation.name).sort()
  if (JSON.stringify(clips) !== JSON.stringify(expectedClips)) {
    findings.push(`animation contract mismatch: ${JSON.stringify(clips)}`)
  }
  for (const animation of json.animations ?? []) {
    if ((animation.channels?.length ?? 0) < 60 || (animation.samplers?.length ?? 0) < 60) {
      findings.push(`${animation.name ?? 'unnamed clip'} has no usable skeletal motion`)
    }
    const movingChannels = (animation.channels ?? []).filter((channel) => {
      const output = animation.samplers?.[channel.sampler]?.output
      return output !== undefined && accessorHasMotion(output)
    }).length
    if (movingChannels < 10) {
      findings.push(
        `${animation.name ?? 'unnamed clip'} has only ${movingChannels} changing transform channels`,
      )
    }
  }
  if ((json.skins ?? []).length !== 1) findings.push('expected exactly one skin')
  if ((json.skins?.[0]?.joints?.length ?? 0) !== 65) {
    findings.push(`expected 65 skin joints, found ${json.skins?.[0]?.joints?.length ?? 0}`)
  }

  const primitives = (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? [])
  if ((json.meshes ?? []).length !== 9) {
    findings.push(`expected nine runtime meshes, found ${json.meshes?.length ?? 0}`)
  }
  if (primitives.length !== 10) findings.push(`expected ten runtime primitives, found ${primitives.length}`)
  for (const primitive of primitives) {
    if (primitive.attributes?.JOINTS_0 === undefined || primitive.attributes?.WEIGHTS_0 === undefined) {
      findings.push('runtime primitive is not skinned')
    }
    if (primitive.extensions?.KHR_draco_mesh_compression) {
      findings.push('runtime primitive must not require a remote Draco decoder')
    }
  }
  for (const image of json.images ?? []) {
    if (image.uri && !image.uri.startsWith('data:')) findings.push(`external image URI: ${image.uri}`)
    if (image.mimeType !== 'image/jpeg') findings.push(`unexpected embedded image type: ${image.mimeType}`)
  }
  for (const buffer of json.buffers ?? []) {
    if (buffer.uri && !buffer.uri.startsWith('data:')) findings.push(`external buffer URI: ${buffer.uri}`)
  }
}

const manifest = readFileSync(join(root, 'docs', 'Assets', 'ASSET_MANIFEST.csv'), 'utf8')
if (!manifest.includes('Quaternius Universal Hero')) {
  findings.push('asset manifest is missing the Quaternius Universal Hero record')
}

if (findings.length > 0) {
  for (const finding of findings) console.error(`Quaternius hero violation: ${finding}`)
  process.exit(1)
}

console.log(
  `Quaternius hero verified: ${(file.length / 1024 / 1024).toFixed(2)} MB, ` +
    `${json.animations.length} moving clips, 65 bones, ten skinned primitives, CC0 records present.`,
)
