import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [, , inputArgument] = process.argv
if (!inputArgument) {
  throw new Error('Usage: node scripts/externalize-glb-images.mjs <runtime.glb>')
}

const inputPath = path.resolve(inputArgument)
const file = await readFile(inputPath)
if (file.toString('ascii', 0, 4) !== 'glTF' || file.readUInt32LE(4) !== 2) {
  throw new Error(`${inputPath} is not a glTF 2.0 binary`)
}

let offset = 12
let document
let binary
while (offset < file.length) {
  const length = file.readUInt32LE(offset)
  const type = file.readUInt32LE(offset + 4)
  const chunk = file.subarray(offset + 8, offset + 8 + length)
  if (type === 0x4e4f534a) {
    document = JSON.parse(chunk.toString('utf8').replace(/\0+$/, '').trimEnd())
  } else if (type === 0x004e4942) {
    binary = chunk
  }
  offset += 8 + length
}

if (!document || !binary) throw new Error('GLB must contain JSON and BIN chunks')
if ((document.buffers ?? []).length !== 1) {
  throw new Error('Only single-buffer runtime GLBs are supported')
}

const views = document.bufferViews ?? []
const embeddedImages = (document.images ?? [])
  .map((image, index) => ({ image, index }))
  .filter(({ image }) => image.bufferView !== undefined)
if (embeddedImages.length === 0) {
  console.log(`No embedded images found in ${path.relative(process.cwd(), inputPath)}.`)
  process.exit(0)
}

const textureDirectory = path.join(path.dirname(inputPath), 'textures')
await mkdir(textureDirectory, { recursive: true })
const removedViews = new Set()

for (const { image, index } of embeddedImages) {
  const view = views[image.bufferView]
  if (!view || view.buffer !== 0) {
    throw new Error(`Image ${index} references an unsupported bufferView`)
  }
  const extension =
    image.mimeType === 'image/png'
      ? '.png'
      : image.mimeType === 'image/jpeg'
        ? '.jpg'
        : null
  if (!extension) throw new Error(`Image ${index} has unsupported MIME type ${image.mimeType}`)

  const stem = String(image.name || `image-${index}`)
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  const filename = `${stem || `image-${index}`}${extension}`
  const start = view.byteOffset ?? 0
  const bytes = binary.subarray(start, start + view.byteLength)
  await writeFile(path.join(textureDirectory, filename), bytes)

  removedViews.add(image.bufferView)
  document.images[index] = {
    ...(image.name ? { name: image.name } : {}),
    uri: `textures/${filename}`,
  }
}

const remap = new Map()
const rebuiltViews = []
const rebuiltChunks = []
let rebuiltLength = 0
for (let oldIndex = 0; oldIndex < views.length; oldIndex += 1) {
  if (removedViews.has(oldIndex)) continue
  const view = views[oldIndex]
  if (view.buffer !== 0) throw new Error(`bufferView ${oldIndex} uses an unsupported buffer`)

  const padding = (4 - (rebuiltLength % 4)) % 4
  if (padding > 0) {
    rebuiltChunks.push(Buffer.alloc(padding))
    rebuiltLength += padding
  }

  const start = view.byteOffset ?? 0
  const bytes = binary.subarray(start, start + view.byteLength)
  remap.set(oldIndex, rebuiltViews.length)
  rebuiltViews.push({
    ...view,
    byteOffset: rebuiltLength,
  })
  rebuiltChunks.push(bytes)
  rebuiltLength += bytes.length
}

function mapView(index, label) {
  const mapped = remap.get(index)
  if (mapped === undefined) throw new Error(`${label} references removed bufferView ${index}`)
  return mapped
}

for (const [index, accessor] of (document.accessors ?? []).entries()) {
  if (accessor.bufferView !== undefined) {
    accessor.bufferView = mapView(accessor.bufferView, `accessor ${index}`)
  }
  if (accessor.sparse?.indices?.bufferView !== undefined) {
    accessor.sparse.indices.bufferView = mapView(
      accessor.sparse.indices.bufferView,
      `accessor ${index} sparse indices`,
    )
  }
  if (accessor.sparse?.values?.bufferView !== undefined) {
    accessor.sparse.values.bufferView = mapView(
      accessor.sparse.values.bufferView,
      `accessor ${index} sparse values`,
    )
  }
}

for (const mesh of document.meshes ?? []) {
  for (const primitive of mesh.primitives ?? []) {
    const draco = primitive.extensions?.KHR_draco_mesh_compression
    if (draco?.bufferView !== undefined) {
      draco.bufferView = mapView(draco.bufferView, 'Draco primitive')
    }
  }
}

document.bufferViews = rebuiltViews
const rebuiltBinary = Buffer.concat(rebuiltChunks)
document.buffers[0].byteLength = rebuiltBinary.length

const jsonSource = Buffer.from(JSON.stringify(document))
const jsonPadding = (4 - (jsonSource.length % 4)) % 4
const jsonChunk = Buffer.concat([jsonSource, Buffer.alloc(jsonPadding, 0x20)])
const binaryPadding = (4 - (rebuiltBinary.length % 4)) % 4
const binaryChunk = Buffer.concat([rebuiltBinary, Buffer.alloc(binaryPadding)])
const outputLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length

const output = Buffer.allocUnsafe(outputLength)
output.write('glTF', 0, 'ascii')
output.writeUInt32LE(2, 4)
output.writeUInt32LE(outputLength, 8)
output.writeUInt32LE(jsonChunk.length, 12)
output.writeUInt32LE(0x4e4f534a, 16)
jsonChunk.copy(output, 20)
const binaryHeader = 20 + jsonChunk.length
output.writeUInt32LE(binaryChunk.length, binaryHeader)
output.writeUInt32LE(0x004e4942, binaryHeader + 4)
binaryChunk.copy(output, binaryHeader + 8)

const temporaryPath = `${inputPath}.externalize.tmp`
await writeFile(temporaryPath, output)
await rename(temporaryPath, inputPath)

console.log(
  `Externalized ${embeddedImages.length} images from ${path.relative(process.cwd(), inputPath)}; ` +
    `runtime GLB is ${(output.length / 1024 / 1024).toFixed(2)} MiB.`,
)
