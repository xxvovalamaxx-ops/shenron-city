import { describe, expect, it } from 'vitest'

import {
  PLAYER_PROVENANCE,
  restorePlayerProvenance,
} from './restore-player-provenance.mjs'

const JSON_CHUNK = 0x4e4f534a
const BINARY_CHUNK = 0x004e4942

function chunk(type, data, paddingByte) {
  const padding = (4 - (data.length % 4)) % 4
  const body = padding === 0 ? data : Buffer.concat([data, Buffer.alloc(padding, paddingByte)])
  const header = Buffer.alloc(8)
  header.writeUInt32LE(body.length, 0)
  header.writeUInt32LE(type, 4)
  return Buffer.concat([header, body])
}

function glb(document, binary = Buffer.from([1, 2, 3, 4])) {
  const json = chunk(JSON_CHUNK, Buffer.from(JSON.stringify(document), 'utf8'), 0x20)
  const bin = chunk(BINARY_CHUNK, binary, 0)
  const body = Buffer.concat([json, bin])
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(header.length + body.length, 8)
  return Buffer.concat([header, body])
}

function chunks(file) {
  const result = []
  let offset = 12
  while (offset < file.length) {
    const length = file.readUInt32LE(offset)
    const type = file.readUInt32LE(offset + 4)
    result.push({ type, data: file.subarray(offset + 8, offset + 8 + length) })
    offset += 8 + length
  }
  return result
}

describe('player provenance restoration', () => {
  it('pins provenance while preserving unrelated metadata and binary bytes', () => {
    const binary = Buffer.from([9, 8, 7, 6, 5])
    const restored = restorePlayerProvenance(glb({
      asset: { version: '2.0', generator: 'Fixture', extras: { retained: true, author: 'wrong' } },
      buffers: [{ byteLength: binary.length }],
    }, binary))
    const restoredChunks = chunks(restored)
    const document = JSON.parse(restoredChunks[0].data.toString('utf8').trimEnd())

    expect(document.asset.extras).toEqual({ retained: true, ...PLAYER_PROVENANCE })
    expect(document.asset.generator).toBe('Fixture')
    expect(restoredChunks[1].type).toBe(BINARY_CHUNK)
    expect(restoredChunks[1].data.subarray(0, binary.length)).toEqual(binary)
  })

  it('is byte-identical after the first restoration', () => {
    const once = restorePlayerProvenance(glb({ asset: { version: '2.0' } }))
    expect(restorePlayerProvenance(once)).toEqual(once)
  })

  it('fails closed for malformed GLB input', () => {
    expect(() => restorePlayerProvenance(Buffer.from('not a glb'))).toThrow('invalid GLB 2.0 file')
    expect(() => restorePlayerProvenance(glb({ asset: { version: '1.0' } }))).toThrow(
      'GLB JSON has no glTF 2.0 asset declaration',
    )
  })
})
