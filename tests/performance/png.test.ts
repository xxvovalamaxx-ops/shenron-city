// png.test.ts — integrity-check math: PNG decode, luminance bands, frame
// diff, hashing. These underpin the Phase 2O-A "camera did not move" claims.

import { describe, expect, it } from 'vitest'
import zlib from 'node:zlib'
import { decodePng, luminanceBands, frameDiff, sha256 } from '../../scripts/benchmarks/lib/png.cjs'

/** Minimal PNG encoder for 8-bit RGBA non-interlaced test images. */
function encodePng(width, height, rgba) {
  const crcTable = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

describe('png decode', () => {
  it('round-trips a 2x2 RGBA image', () => {
    const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    const img = decodePng(encodePng(2, 2, rgba))
    expect(img.width).toBe(2)
    expect(img.height).toBe(2)
    expect([...img.data]).toEqual([...rgba])
  })

  it('decodes an 8-bit RGB PNG (color type 2)', () => {
    // RGB layout: 3 channels, stride = width*3
    const rgb = Buffer.from([10, 20, 30, 40, 50, 60])
    const crcTable = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
    const crc32 = (buf) => {
      let c = 0xffffffff
      for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
      return (c ^ 0xffffffff) >>> 0
    }
    const chunk = (type, data) => {
      const len = Buffer.alloc(4)
      len.writeUInt32BE(data.length)
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(body))
      return Buffer.concat([len, body, crc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(2, 0)
    ihdr.writeUInt32BE(1, 4)
    ihdr[8] = 8
    ihdr[9] = 2 // RGB
    const raw = Buffer.concat([Buffer.from([0]), rgb])
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
    const img = decodePng(png)
    expect([...img.data]).toEqual([10, 20, 30, 255, 40, 50, 60, 255])
  })
})

describe('luminance bands', () => {
  it('computes mean luminance per band on a black/white split', () => {
    // 4x4 image: left half black, right half white
    const rgba = Buffer.alloc(4 * 4 * 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = x < 2 ? 0 : 255
        const i = (y * 4 + x) * 4
        rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255
      }
    }
    const bands = luminanceBands({ width: 4, height: 4, data: rgba }, 2)
    expect(bands[0][0]).toBe(0) // top-left black
    expect(bands[0][1]).toBe(255) // top-right white
    expect(bands[1][0]).toBe(0)
    expect(bands[1][1]).toBe(255)
  })
})

describe('frame diff', () => {
  it('detects identical frames', () => {
    const rgba = Buffer.alloc(4 * 4 * 4, 128)
    const a = { width: 4, height: 4, data: rgba }
    const b = { width: 4, height: 4, data: Buffer.from(rgba) }
    const d = frameDiff(a, b)
    expect(d.meanAbsDiff).toBe(0)
    expect(d.pctPixelsChanged).toBe(0)
    expect(d.maxBandLuminanceDrift).toBe(0)
  })

  it('detects a moving patch', () => {
    const w = 8, h = 8
    const a = Buffer.alloc(w * h * 4, 0)
    const b = Buffer.alloc(w * h * 4, 0)
    const paint = (buf, x, y) => {
      const i = (y * w + x) * 4
      buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = 255
    }
    paint(a, 1, 1)
    paint(b, 6, 6) // moved white pixel
    const d = frameDiff({ width: w, height: h, data: a }, { width: w, height: h, data: b })
    expect(d.meanAbsDiff).toBeGreaterThan(0)
    expect(d.pctPixelsChanged).toBeGreaterThan(0)
    expect(d.pctPixelsChanged).toBeLessThan(10)
  })
})

describe('sha256', () => {
  it('hashes a buffer deterministically', () => {
    const h1 = sha256(Buffer.from('phase2o-a evidence'))
    const h2 = sha256(Buffer.from('phase2o-a evidence'))
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    expect(h1).not.toBe(sha256(Buffer.from('phase2o-a evidence!')))
  })
})
