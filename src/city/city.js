// city.js — loads the runtime payload written by 45_build_runtime_data.py and
// exposes it as typed views. One fetch each, no per-record parsing.

const REC = 20 // bytes per building, must match the python writer

export class City {
  constructor(meta, coreBuffer, text) {
    this.meta = meta
    this.text = text
    this.count = meta.buildings
    this.view = new DataView(coreBuffer)

    if (coreBuffer.byteLength !== this.count * REC) {
      throw new Error(
        `core.bin is ${coreBuffer.byteLength} bytes, expected ` +
        `${this.count * REC} for ${this.count} buildings`,
      )
    }
  }

  static async load(onProgress = () => {}) {
    onProgress('city.json', 0.05)
    const meta = await fetch('/models/manhattan/data/city.json').then((r) => {
      if (!r.ok) throw new Error(`city.json: HTTP ${r.status}`)
      return r.json()
    })

    onProgress('core.bin', 0.2)
    const core = await fetch('/models/manhattan/data/core.bin').then((r) => {
      if (!r.ok) throw new Error(`core.bin: HTTP ${r.status}`)
      return r.arrayBuffer()
    })

    onProgress('text.json', 0.45)
    const text = await fetch('/models/manhattan/data/text.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))

    return new City(meta, core, text)
  }

  // ---- per-building accessors --------------------------------------------
  x(i) { return this.view.getFloat32(i * REC, true) }
  y(i) { return this.view.getFloat32(i * REC + 4, true) }
  height(i) { return this.view.getFloat32(i * REC + 8, true) }
  archetypeIx(i) { return this.view.getUint8(i * REC + 12) }
  districtIx(i) { return this.view.getUint8(i * REC + 13) }
  tierIx(i) { return this.view.getUint8(i * REC + 14) }
  flags(i) { return this.view.getUint8(i * REC + 15) }
  year(i) { return this.view.getUint16(i * REC + 16, true) }
  floors(i) { const f = this.view.getUint8(i * REC + 18); return f === 255 ? 0 : f }
  confidenceIx(i) { return this.view.getUint8(i * REC + 19) }

  isPinned(i) { return (this.flags(i) & 1) !== 0 }
  isContext(i) { return (this.flags(i) & 2) !== 0 }

  archetype(i) { return this.meta.archetypes[this.archetypeIx(i)] || '' }
  district(i) { return this.meta.districts[this.districtIx(i)] || '' }
  confidence(i) { return this.meta.confidence[this.confidenceIx(i)] || 'none' }

  name(i) { const t = this.text[i]; return t ? t[0] : '' }
  address(i) { const t = this.text[i]; return t ? t[1] : '' }

  get(i) {
    if (!(i >= 0 && i < this.count)) return null
    return {
      id: i,
      x: this.x(i),
      y: this.y(i),
      height: this.height(i),
      archetype: this.archetype(i),
      district: this.district(i),
      confidence: this.confidence(i),
      year: this.year(i),
      floors: this.floors(i),
      name: this.name(i),
      address: this.address(i),
      pinned: this.isPinned(i),
      context: this.isContext(i),
    }
  }

  // Nearest building to a world position, used to name where the camera is.
  // Linear over 56k records is ~0.3 ms, which is cheap enough to run a few
  // times a second and avoids shipping a spatial index for one HUD line.
  nearest(wx, wz, maxDist = 400) {
    const px = wx
    const py = -wz // world z is -y_m, see the projection note in city.json
    let best = -1
    let bestD = maxDist * maxDist
    for (let i = 0; i < this.count; i++) {
      const dx = this.x(i) - px
      const dy = this.y(i) - py
      const d = dx * dx + dy * dy
      if (d < bestD) { bestD = d; best = i }
    }
    return best
  }
}

// Blender is Z-up, glTF is Y-up, so the exporter maps
//   (x, y, z)_blender -> (x, z, -y)_gltf
// Everything in the browser therefore uses world x = x_m, world z = -y_m.
export function toWorld(xM, yM, h = 0) {
  return [xM, h, -yM]
}

export function fromWorld(wx, wz) {
  return [wx, -wz]
}
