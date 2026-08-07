/**
 * Embed a GLB's external texture files into the GLB itself.
 *
 * Kenney's kits ship models that reference their palette atlas by relative
 * path — `"uri": "Textures/colormap.png"` — which resolves against wherever
 * the GLB is served from. Copying the model into `public/` without the sibling
 * `Textures/` directory therefore 404s at runtime, and the QA walkthrough
 * caught exactly that: five `THREE.GLTFLoader: Couldn't load texture
 * Textures/colormap.png` errors, one per dev-spawn model.
 *
 * Shipping the texture alongside would work for one kit and quietly break the
 * other: the car kit and the mini-characters kit use *different* colormaps
 * under the *same* relative name, so a single file in a shared directory gives
 * one of them the wrong palette — a defect that renders rather than errors,
 * which is worse. Embedding sidesteps the whole question. Each GLB carries its
 * own atlas, the runtime URL is unchanged, and the asset stops depending on
 * where it happens to sit on disk.
 *
 * Usage:
 *   node scripts/assets/embed-glb-textures.mjs <glb> --textures <dir> [--out <glb>]
 *   node scripts/assets/embed-glb-textures.mjs --check <glb>...
 *
 * `--check` reports unresolved external URIs and exits 1 if any remain, so the
 * asset audit can gate on it.
 */
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** Split a GLB into its JSON and BIN chunks. */
export function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== MAGIC) throw new Error('not a GLB (bad magic)')
  const total = buffer.readUInt32LE(8)
  let offset = 12
  let json = null
  let bin = Buffer.alloc(0)
  while (offset < total) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === CHUNK_JSON) json = JSON.parse(data.toString('utf8'))
    else if (type === CHUNK_BIN) bin = Buffer.from(data)
    offset += 8 + length
  }
  if (!json) throw new Error('GLB has no JSON chunk')
  return { json, bin }
}

/** Re-assemble a GLB from a JSON document and a BIN buffer. */
export function writeGlb(json, bin) {
  const jsonText = Buffer.from(JSON.stringify(json), 'utf8')
  // Chunks are 4-byte aligned; JSON pads with spaces, BIN with zeroes, so a
  // reader that ignores the declared length still sees valid content.
  const jsonPad = (4 - (jsonText.length % 4)) % 4
  const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(jsonPad, 0x20)])
  const binPad = (4 - (bin.length % 4)) % 4
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)])

  const length = 12 + 8 + jsonChunk.length + (binChunk.length ? 8 + binChunk.length : 0)
  const out = Buffer.alloc(length)
  out.writeUInt32LE(MAGIC, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(length, 8)
  let o = 12
  out.writeUInt32LE(jsonChunk.length, o)
  out.writeUInt32LE(CHUNK_JSON, o + 4)
  jsonChunk.copy(out, o + 8)
  o += 8 + jsonChunk.length
  if (binChunk.length) {
    out.writeUInt32LE(binChunk.length, o)
    out.writeUInt32LE(CHUNK_BIN, o + 4)
    binChunk.copy(out, o + 8)
  }
  return out
}

/** External (non-data:) image URIs a GLB still depends on. */
export function externalImageUris(json) {
  return (json.images ?? [])
    .map((img, index) => ({ index, uri: img.uri }))
    .filter((i) => i.uri && !i.uri.startsWith('data:'))
}

/**
 * Move every external image into the BIN chunk.
 *
 * Returns the rewritten GLB plus what it did, or null when there was nothing
 * external to embed — callers should not rewrite a file they did not change.
 */
export function embedTextures(buffer, textureDir) {
  const { json, bin } = parseGlb(buffer)
  const external = externalImageUris(json)
  if (external.length === 0) return null

  json.bufferViews ??= []
  json.buffers ??= [{ byteLength: 0 }]
  let out = bin
  const embedded = []

  for (const { index, uri } of external) {
    const file = resolve(textureDir, decodeURIComponent(uri))
    if (!existsSync(file)) {
      throw new Error(`image ${index} references ${uri}, not found at ${file}`)
    }
    const bytes = readFileSync(file)
    // Align the start of every view: some loaders assume it.
    const pad = (4 - (out.length % 4)) % 4
    if (pad) out = Buffer.concat([out, Buffer.alloc(pad, 0)])
    const byteOffset = out.length
    out = Buffer.concat([out, bytes])

    const view = json.bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: bytes.length,
    }) - 1
    const ext = uri.slice(uri.lastIndexOf('.')).toLowerCase()
    json.images[index] = { bufferView: view, mimeType: MIME[ext] ?? 'image/png' }
    embedded.push({ uri, bytes: bytes.length })
  }

  json.buffers[0] = { ...json.buffers[0], byteLength: out.length }
  delete json.buffers[0].uri
  return { glb: writeGlb(json, out), embedded }
}

// ---------------------------------------------------------------------------

function main(argv) {
  if (argv[0] === '--check') {
    let bad = 0
    for (const file of argv.slice(1)) {
      const { json } = parseGlb(readFileSync(file))
      const external = externalImageUris(json)
      if (external.length) {
        bad++
        console.error(`FAIL ${file}: ${external.length} external texture(s): ` +
          external.map((e) => e.uri).join(', '))
      } else {
        console.log(`ok   ${file}`)
      }
    }
    process.exit(bad ? 1 : 0)
  }

  const glb = argv[0]
  if (!glb) {
    console.error('usage: embed-glb-textures.mjs <glb> --textures <dir> [--out <glb>]')
    console.error('       embed-glb-textures.mjs --check <glb>...')
    process.exit(2)
  }
  const ti = argv.indexOf('--textures')
  const oi = argv.indexOf('--out')
  const textureDir = ti >= 0 ? argv[ti + 1] : dirname(glb)
  const out = oi >= 0 ? argv[oi + 1] : glb

  const result = embedTextures(readFileSync(glb), textureDir)
  if (!result) {
    console.log(`skip ${glb}: no external textures`)
    return
  }
  writeFileSync(out, result.glb)
  const total = result.embedded.reduce((a, e) => a + e.bytes, 0)
  console.log(`ok   ${out}: embedded ${result.embedded.length} texture(s), ` +
    `${(total / 1024).toFixed(1)} KB — ${result.embedded.map((e) => e.uri).join(', ')}`)
}

/**
 * Run main only when invoked directly.
 *
 * Via pathToFileURL rather than string surgery on argv[1]: on Windows the path
 * is `E:\...` with backslashes and spaces, and `process.argv[1]` is undefined
 * entirely when this module is imported from `node -e`. The hand-rolled
 * comparison this replaces threw a TypeError in that case, which is how a
 * verifier that imports it found out.
 */
const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2))
}
