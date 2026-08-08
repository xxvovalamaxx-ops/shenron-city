/**
 * Remove animation channels that target the armature *holder* node.
 *
 * glTF skeletons exported from Blender carry a scene node — Sketchfab's
 * exporter names it `_rootJoint` — that holds the skeleton but is not a bone.
 * When `bpy.ops.export_scene.gltf(export_yup=True)` converts Blender's Z-up
 * world to glTF's Y-up, it can express that conversion as a -90 degree X
 * rotation *animated on the holder* rather than baked into the rest pose.
 *
 * That is harmless if you play the clip on the skeleton it shipped with. It is
 * not harmless when the clip is borrowed. The player mesh (`player.glb`, from
 * Sketchfab) has `_rootJoint` at identity in its rest pose; the retargeted
 * clips (`player-clips.glb`, from scripts/retarget/bake-retarget.py) animate
 * the same node to -90 degrees about X. Playing one on the other rotates the
 * whole skeleton face-down — which is exactly how the player ended up lying on
 * the road instead of standing on it.
 *
 * Measured before stripping: `_rootJoint` carried three channels per clip, 21
 * across the seven. Translation was (0,0,0) at every key and scale (1,1,1) at
 * every key — pure bookkeeping. Only the rotation did anything, and what it
 * did was the bug.
 *
 * The channels are removed from the `animations` array; their accessors are
 * left in place. Unreferenced accessors are legal glTF, and rewriting the
 * binary chunk to reclaim a few hundred bytes would risk far more than it
 * saves.
 *
 * Usage:
 *   node scripts/retarget/strip-root-holder-channels.mjs <glb> [--node _rootJoint] [--out <glb>]
 *   node scripts/retarget/strip-root-holder-channels.mjs --check <glb>...
 */
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

/** Nodes whose animation is exporter bookkeeping rather than motion. */
export const DEFAULT_HOLDER_NAMES = ['_rootJoint', 'Armature', 'Sketchfab_model']

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

export function writeGlb(json, bin) {
  const jsonText = Buffer.from(JSON.stringify(json), 'utf8')
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

/** Channels in `json` that target one of `holders`, by clip. */
export function findHolderChannels(json, holders = DEFAULT_HOLDER_NAMES) {
  const names = (json.nodes ?? []).map((n) => n.name ?? '')
  const found = []
  for (const [index, animation] of (json.animations ?? []).entries()) {
    for (const channel of animation.channels ?? []) {
      const name = names[channel.target?.node] ?? ''
      if (holders.includes(name)) {
        found.push({
          clip: animation.name ?? `#${index}`,
          node: name,
          path: channel.target.path,
        })
      }
    }
  }
  return found
}

export function stripHolderChannels(json, holders = DEFAULT_HOLDER_NAMES) {
  const names = (json.nodes ?? []).map((n) => n.name ?? '')
  let removed = 0
  for (const animation of json.animations ?? []) {
    const before = animation.channels.length
    animation.channels = animation.channels.filter((channel) => {
      const name = names[channel.target?.node] ?? ''
      return !holders.includes(name)
    })
    removed += before - animation.channels.length
  }
  return removed
}

function main(argv) {
  if (argv[0] === '--check') {
    let bad = 0
    for (const file of argv.slice(1)) {
      const { json } = parseGlb(readFileSync(file))
      const found = findHolderChannels(json)
      if (found.length) {
        bad++
        console.error(`FAIL ${file}: ${found.length} holder channel(s)`)
        for (const f of found.slice(0, 6)) {
          console.error(`       ${f.clip} -> ${f.node}.${f.path}`)
        }
      } else {
        console.log(`ok   ${file}`)
      }
    }
    process.exit(bad ? 1 : 0)
  }

  const file = argv[0]
  if (!file) {
    console.error('usage: strip-root-holder-channels.mjs <glb> [--node NAME] [--out GLB]')
    console.error('       strip-root-holder-channels.mjs --check <glb>...')
    process.exit(2)
  }
  const ni = argv.indexOf('--node')
  const oi = argv.indexOf('--out')
  const holders = ni >= 0 ? [argv[ni + 1]] : DEFAULT_HOLDER_NAMES
  const out = oi >= 0 ? argv[oi + 1] : file

  const { json, bin } = parseGlb(readFileSync(file))
  const before = findHolderChannels(json, holders)
  if (!before.length) {
    console.log(`skip ${file}: no holder channels`)
    return
  }
  const removed = stripHolderChannels(json, holders)
  writeFileSync(out, writeGlb(json, bin))
  const clips = new Set(before.map((f) => f.clip))
  console.log(
    `ok   ${out}: removed ${removed} channel(s) targeting ` +
      `${[...new Set(before.map((f) => f.node))].join(', ')} ` +
      `across ${clips.size} clip(s)`,
  )
}

const entry = process.argv[1]
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2))
}
