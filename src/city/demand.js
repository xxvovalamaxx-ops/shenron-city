// demand.js — how busy a place is, from what is actually built there.
//
// Before this existed, crowd density scaled with how much pavement was in
// view and traffic with how many lanes were in scope. Both are measures of
// street layout, not of activity, and they gave exactly the wrong answer:
// Times Square came back quieter than a SoHo side street, because SoHo has
// more small streets per hectare.
//
//   pedestrians  a 200 m field built from PLUTO retail, office and
//                residential floor space (49_build_demand.py), with separate
//                daytime and evening weightings
//   vehicles     per-edge mean hourly volume from the NYC DOT counts where
//                the city measured one, and a fitted estimate elsewhere

const CELL = 200

export class Demand {
  constructor() {
    this.day = null
    this.eve = null
    this.cell = CELL
    this.vol = null
    this.maxVph = 1
    this.evening = false
    this.ready = false
  }

  async load(pedUrl = '/models/manhattan/data/demand.json',
             vehUrl = '/models/manhattan/streets/street_demand.json') {
    const [p, v] = await Promise.all([
      fetch(pedUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(vehUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    if (p) {
      this.day = p.day
      this.eve = p.eve
      this.cell = p.cell_m || CELL
    }
    if (v) {
      this.vol = v.volumes
      this.maxVph = v.max_vph || 1
      this.refVph = v.ref_vph || v.max_vph || 1
    }
    this.ready = !!(this.day || this.vol)
    if (!this.ready) console.warn('[demand] no demand data; density is flat')
    return this
  }

  // 0..1 footfall weight at a point in local metres.
  ped(xM, yM) {
    const f = this.evening ? this.eve : this.day
    if (!f) return 0.5
    const k = `${Math.floor(xM / this.cell)},${Math.floor(yM / this.cell)}`
    const v = f[k]
    return v === undefined ? 0 : v
  }

  // Bilinear over the cell grid, so a walker crossing a cell boundary does
  // not step through a density discontinuity.
  pedSmooth(xM, yM) {
    const f = this.evening ? this.eve : this.day
    if (!f) return 0.5
    const gx = xM / this.cell - 0.5
    const gy = yM / this.cell - 0.5
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const tx = gx - x0
    const ty = gy - y0
    const at = (a, b) => f[`${a},${b}`] || 0
    const base = (at(x0, y0) * (1 - tx) * (1 - ty) +
            at(x0 + 1, y0) * tx * (1 - ty) +
            at(x0, y0 + 1) * (1 - tx) * ty +
            at(x0 + 1, y0 + 1) * tx * ty)
    return Math.min(1, base + this._station(xM, yM))
  }

  // Station footfall, added on top of the floor-area model.
  //
  // The two are genuinely different things and adding rather than blending is
  // the point: floor area says how many people have business on a block,
  // station entrances say how many arrive on it. A block can be busy for
  // either reason, and the corner with four stair kiosks on it is busy for
  // both. Saturating at a quarter keeps a station from flattening the rest of
  // the model -- 228 of the island's cells have an entrance in them, and if
  // every one of those pinned to 1.0 the field would stop distinguishing
  // Times Square from Chambers Street.
  _station(xM, yM) {
    if (!this.subway) return 0
    const n = this.subway.footfallAt(xM, yM)
    return n <= 0 ? 0 : Math.min(0.25, 0.085 * Math.sqrt(n))
  }

  setSubway(subway) { this.subway = subway }

  // Mean hourly vehicles on a LION edge, and the same normalised to 0..1.
  vph(edgeId) {
    if (!this.vol) return 0
    const e = this.vol[edgeId]
    return e ? e[0] : 0
  }

  measured(edgeId) {
    if (!this.vol) return false
    const e = this.vol[edgeId]
    return !!(e && e[1])
  }

  // sqrt because volume spans two orders of magnitude and a linear weight
  // would empty every side street in the borough. Normalised against the 90th
  // percentile rather than the maximum: the busiest segment of the FDR carries
  // 2,700 vehicles an hour against a borough median of 57, and dividing by
  // that squeezed every ordinary street into a 0.23-0.38 band.
  vehNorm(edgeId) {
    const v = this.vph(edgeId)
    if (!v) return 0.2
    return Math.max(0.06, Math.min(1, Math.sqrt(v / (this.refVph || 1))))
  }
}
