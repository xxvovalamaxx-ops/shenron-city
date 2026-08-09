/**
 * Restore the CC-BY metadata Blender drops when re-exporting the player GLB.
 *
 * The exact values come from `asset.extras` in the checked-in Sketchfab source
 * GLB. This post-process only rewrites the JSON chunk; mesh/image binary bytes
 * remain untouched. Running it twice is byte-identical.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const JSON_CHUNK = 0x4e4f534a

export const PLAYER_PROVENANCE = Object.freeze({
  author: 'Renderpeople (https://sketchfab.com/renderpeople)',
  license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
  source:
    'https://sketchfab.com/3d-models/eric-rigged-001-rigged-3d-business-man-a46bc9f67aaa415bb4f3241eef900e7f',
  title: 'Eric Rigged 001 - Rigged 3D Business Man',
  modifications:
    'Blender re-export, metre normalization, locomotion retargeting, and upper-arm rest-pose correction by the Shenzhen City project.',
})

function parseChunks(file) {
  if (
    file.length < 20 ||
    file.toString('ascii', 0, 4) !== 'glTF' ||
    file.readUInt32LE(4) !== 2 ||
    file.readUInt32LE(8) !== file.length
  ) {
    throw new Error('invalid GLB 2.0 file')
  }
  const chunks = []
  let offset = 12
  while (offset < file.length) {
    if (offset + 8 > file.length) throw new Error('truncated GLB chunk header')
    const length = file.readUInt32LE(offset)
    const type = file.readUInt32LE(offset + 4)
    const end = offset + 8 + length
    if (end > file.length) throw new Error('truncated GLB chunk')
    chunks.push({ type, data: file.subarray(offset + 8, end) })
    offset = end
  }
  return chunks
}

function encodedChunk(type, data) {
  const header = Buffer.alloc(8)
  header.writeUInt32LE(data.length, 0)
  header.writeUInt32LE(type, 4)
  return Buffer.concat([header, data])
}

export function restorePlayerProvenance(file) {
  let jsonFound = false
  const chunks = parseChunks(file).map(({ type, data }) => {
    if (type !== JSON_CHUNK) return encodedChunk(type, data)
    if (jsonFound) throw new Error('GLB contains more than one JSON chunk')
    jsonFound = true
    const document = JSON.parse(data.toString('utf8').trimEnd())
    if (!document.asset || document.asset.version !== '2.0') {
      throw new Error('GLB JSON has no glTF 2.0 asset declaration')
    }
    document.asset.extras = {
      ...(document.asset.extras ?? {}),
      ...PLAYER_PROVENANCE,
    }
    const json = Buffer.from(JSON.stringify(document), 'utf8')
    const padding = (4 - (json.length % 4)) % 4
    return encodedChunk(
      type,
      padding === 0 ? json : Buffer.concat([json, Buffer.alloc(padding, 0x20)]),
    )
  })
  if (!jsonFound) throw new Error('GLB contains no JSON chunk')
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(header.length + body.length, 8)
  return Buffer.concat([header, body])
}

const scriptPath = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath)) {
  const root = resolve(fileURLToPath(new URL('../../', import.meta.url)))
  const target = resolve(root, 'public/models/characters/player/player.glb')
  const current = readFileSync(target)
  const restored = restorePlayerProvenance(current)
  if (process.argv.includes('--check')) {
    if (!current.equals(restored)) {
      throw new Error(`${target} is missing the pinned embedded player provenance`)
    }
    console.log('Player GLB embedded provenance verified.')
  } else {
    writeFileSync(target, restored)
    console.log(`Restored pinned player provenance: ${target}`)
  }
}
