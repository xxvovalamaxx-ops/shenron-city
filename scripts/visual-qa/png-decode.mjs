/**
 * Minimal dependency-free PNG decoder (8-bit RGB/RGBA).
 *
 * Puppeteer screenshots are PNG buffers; frame-analysis.mjs needs raw RGBA.
 * Node's zlib does the heavy lifting; the rest is chunk walking and scanline
 * unfiltering. Pure module so it can run under vitest and the runner alike.
 */
import { inflateSync } from 'node:zlib'

export function decodePngToRgba(buffer) {
  const png = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < 8; i++) {
    if (png[i] !== signature[i]) throw new Error('Not a PNG buffer')
  }
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []
  while (offset < png.length) {
    const length = png[offset] * 0x1000000 + png[offset + 1] * 0x10000 + png[offset + 2] * 0x100 + png[offset + 3]
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7])
    const start = offset + 8
    if (type === 'IHDR') {
      width = readUint32(png, start)
      height = readUint32(png, start + 4)
      bitDepth = png[start + 8]
      colorType = png[start + 9]
    } else if (type === 'IDAT') {
      idat.push(png.subarray(start, start + length))
    } else if (type === 'IEND') {
      break
    }
    offset = start + length + 4
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format: bit depth ${bitDepth}, colour type ${colorType}`)
  }
  const channels = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b))))
  const stride = width * channels
  const out = new Uint8ClampedArray(width * height * 4)
  let prev = new Uint8ClampedArray(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = new Uint8ClampedArray(stride)
    for (let px = 0; px < width; px++) {
      for (let c = 0; c < channels; c++) {
        const i = px * channels + c
        const outIndex = y * width * 4 + px * 4 + c
        const a = px > 0 ? cur[i - channels] : 0
        const b = y > 0 ? prev[i] : 0
        const c2 = px > 0 && y > 0 ? prev[i - channels] : 0
        let value = line[i]
        if (filter === 1) value += a
        else if (filter === 2) value += b
        else if (filter === 3) value += (a + b) >> 1
        else if (filter === 4) value += paeth(a, b, c2)
        const clamped = value & 0xff
        out[outIndex] = clamped
        cur[i] = clamped
      }
    }
    prev = cur
    if (channels === 3) {
      for (let px = 0; px < width; px++) out[y * width * 4 + px * 4 + 3] = 255
    }
  }
  return { data: out, width, height }
}

function readUint32(bytes, offset) {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
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
