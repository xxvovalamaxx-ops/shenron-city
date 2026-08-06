// png.cjs — minimal PNG decode + image integrity metrics (zero dependencies).
//
// Chrome's Page.captureScreenshot produces 8-bit RGB/RGBA non-interlaced
// PNGs. We decode enough of the format to compute the Phase 2O-A integrity
// checks on real evidence instead of on a description of it:
//   - sha256 hashes (prove the camera did not move between passes)
//   - per-band luminance (detect empty sky / black frames)
//   - frame difference between passes (pixel-level camera identity check)

const zlib = require('node:zlib')
const crypto = require('node:crypto')

const CT_GRAY = 0
const CT_RGB = 2
const CT_PALETTE = 3
const CT_GRAY_ALPHA = 4
const CT_RGBA = 6

const CHANNELS = { [CT_GRAY]: 1, [CT_RGB]: 3, [CT_PALETTE]: 1, [CT_GRAY_ALPHA]: 2, [CT_RGBA]: 4 }

function decodePng(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) throw new Error('not a PNG')
  }
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  let palette = null
  for (;;) {
    if (off + 8 > buf.length) throw new Error('truncated PNG')
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    off += 12 + len
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data))
    } else if (type === 'PLTE') {
      palette = data
    } else if (type === 'IEND') {
      break
    }
  }
  if (interlace !== 0) throw new Error('interlaced PNG unsupported')
  if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} unsupported`)
  const channels = CHANNELS[colorType]
  if (!channels) throw new Error(`color type ${colorType} unsupported`)

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(width * height * 4)
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)

  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    if (pa <= pb && pa <= pc) return a
    if (pb <= pc) return b
    return c
  }

  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0
      const b = prev[x]
      const c = x >= channels ? prev[x - channels] : 0
      let v = cur[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) v += paeth(a, b, c)
      cur[x] = v & 0xff
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels
      let r, g, b, alpha
      if (colorType === CT_RGBA) {
        r = cur[s]; g = cur[s + 1]; b = cur[s + 2]; alpha = cur[s + 3]
      } else if (colorType === CT_RGB) {
        r = cur[s]; g = cur[s + 1]; b = cur[s + 2]; alpha = 255
      } else if (colorType === CT_GRAY) {
        r = g = b = cur[s]; alpha = 255
      } else if (colorType === CT_GRAY_ALPHA) {
        r = g = b = cur[s]; alpha = cur[s + 1]
      } else { // palette
        const i = cur[s] * 3
        r = palette[i]; g = palette[i + 1]; b = palette[i + 2]; alpha = 255
      }
      const d = (y * width + x) * 4
      out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = alpha
    }
    prev.set(cur)
  }
  return { width, height, data: out }
}

/** Mean luminance per band. Returns bands x bands grid of 0-255 values. */
function luminanceBands({ width, height, data }, bands = 4) {
  const out = Array.from({ length: bands }, () => Array(bands).fill(0))
  const counts = Array.from({ length: bands }, () => Array(bands).fill(0))
  const bw = width / bands
  const bh = height / bands
  for (let y = 0; y < height; y++) {
    const by = Math.min(bands - 1, Math.floor(y / bh))
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4
      const lum = 0.2126 * data[d] + 0.7152 * data[d + 1] + 0.0722 * data[d + 2]
      const bx = Math.min(bands - 1, Math.floor(x / bw))
      out[by][bx] += lum
      counts[by][bx]++
    }
  }
  return out.map((row, i) => row.map((v, j) => Math.round(v / counts[i][j])))
}

/**
 * Frame difference between two decoded frames of the same size.
 * Returns mean absolute channel diff, % of pixels whose luminance changed by
 * more than `threshold`, and per-band luminance drift (max band delta).
 */
function frameDiff(a, b, threshold = 12) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error('frame size mismatch')
  }
  const n = a.width * a.height
  let sum = 0
  let changed = 0
  const bands = 4
  const drift = Array.from({ length: bands }, () => Array(bands).fill(0))
  const bw = a.width / bands
  const bh = a.height / bands
  for (let y = 0; y < a.height; y++) {
    const by = Math.min(bands - 1, Math.floor(y / bh))
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4
      const la = 0.2126 * a.data[i] + 0.7152 * a.data[i + 1] + 0.0722 * a.data[i + 2]
      const lb = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2]
      const dl = Math.abs(la - lb)
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
      sum += d
      if (dl > threshold) changed++
      const bx = Math.min(bands - 1, Math.floor(x / bw))
      drift[by][bx] = Math.max(drift[by][bx], dl)
    }
  }
  return {
    meanAbsDiff: +(sum / (3 * n)).toFixed(3),
    pctPixelsChanged: +(100 * changed / n).toFixed(2),
    maxBandLuminanceDrift: Math.max(...drift.flat()),
  }
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

module.exports = { decodePng, luminanceBands, frameDiff, sha256 }
