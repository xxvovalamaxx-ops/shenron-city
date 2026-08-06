import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { decodePngToRgba } from './png-decode.mjs'

/** Build a minimal PNG with the given 8-bit RGB rows and filter type. */
function makePng(width, height, rows, filter) {
  const stride = width * 3
  const raw = Buffer.alloc(height * (stride + 1))
  const prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter
    for (let x = 0; x < stride; x++) {
      const value = rows[y * stride + x]
      const a = x >= 3 ? rows[y * stride + x - 3] : 0
      const b = y > 0 ? prev[x] : 0
      const c = x >= 3 && y > 0 ? prev[x - 3] : 0
      let filtered = value
      if (filter === 1) filtered = value - a
      else if (filter === 2) filtered = value - b
      else if (filter === 3) filtered = value - ((a + b) >> 1)
      else if (filter === 4) filtered = value - paeth(a, b, c)
      raw[y * (stride + 1) + 1 + x] = filtered & 0xff
    }
    for (let x = 0; x < stride; x++) prev[x] = rows[y * stride + x]
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type RGB
  const idat = deflateSync(raw)
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([head, typeBuf, data, crcBuf])
}

function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

const pattern = (width, height) => {
  const rows = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      rows[i] = (x * 3) % 256
      rows[i + 1] = (y * 5) % 256
      rows[i + 2] = (x + y) % 256
    }
  }
  return rows
}

const verifyRoundtrip = (filter) => {
  const width = 8
  const height = 6
  const rows = pattern(width, height)
  const png = makePng(width, height, rows, filter)
  const { data, width: w, height: h } = decodePngToRgba(png)
  expect(w).toBe(width)
  expect(h).toBe(height)
  expect(data).toHaveLength(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    expect(data[i * 4]).toBe(rows[i * 3])
    expect(data[i * 4 + 1]).toBe(rows[i * 3 + 1])
    expect(data[i * 4 + 2]).toBe(rows[i * 3 + 2])
    expect(data[i * 4 + 3]).toBe(255)
  }
}

describe('decodePngToRgba', () => {
  it('round-trips an unfiltered PNG', () => verifyRoundtrip(0))
  it('round-trips a Sub-filtered PNG', () => verifyRoundtrip(1))
  it('round-trips an Up-filtered PNG', () => verifyRoundtrip(2))
  it('round-trips an Average-filtered PNG', () => verifyRoundtrip(3))
  it('round-trips a Paeth-filtered PNG', () => verifyRoundtrip(4))

  it('rejects a non-PNG buffer', () => {
    expect(() => decodePngToRgba(Buffer.from('hello world'))).toThrow('Not a PNG buffer')
  })
})
