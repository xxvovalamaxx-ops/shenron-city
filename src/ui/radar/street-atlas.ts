/**
 * Pre-rendered map tiles: the street network and the island, rasterised once
 * into small canvases and reused every frame.
 *
 * Drawing seventeen thousand polylines every frame would cost milliseconds of
 * main thread; drawing a handful of cached images, rotated, costs next to
 * nothing. Tiles come in three levels of detail (a mip pyramid), rendered on
 * demand under a per-frame time budget and kept in an LRU:
 *
 *   level 0   256 m per tile  1.5 px/m   the radar on foot and in town
 *   level 1   1 km per tile   0.375 px/m the radar at speed, the map zoomed in
 *   level 2   4 km per tile   0.094 px/m the map zoomed out
 *
 * Until a tile is ready the coarser level's tile stands in, so the map never
 * shows holes while it fills in.
 */
import type { StreetData, RoadClass } from './street-data'
import { INDEX_CELL, cellKey } from './street-data'
import { landTriangles, type LandLayer, type LandTriangles } from './land-data'

export const TILE_PX = 384
export const LEVEL_TILE_M = [INDEX_CELL, INDEX_CELL * 4, INDEX_CELL * 16] as const
const MAX_TILES = 72

export const MAP_COLORS = {
  water: '#2c4459',
  land: '#3d4349',
  pier: '#4a5057',
  park: '#3b5a3a',
  lake: '#2f5876',
  path: '#586b58',
  minor: '#666d74',
  street: '#8a929a',
  avenue: '#a8b0b8',
  highway: '#c2b58f',
  bridge: '#9aa2aa',
  tunnel: 'rgba(150, 158, 166, 0.35)',
} as const

const LAND_FILL: Record<LandLayer, string> = {
  land: MAP_COLORS.land,
  pier: MAP_COLORS.pier,
  park: MAP_COLORS.park,
  water: MAP_COLORS.lake,
}

/** Road classes in paint order, with the minimum on-screen width per level. */
const ROAD_ORDER: ReadonlyArray<{ cls: RoadClass; minPx: [number, number, number]; widthScale: number }> = [
  { cls: 'tunnel', minPx: [1, 0, 0], widthScale: 0.5 },
  { cls: 'path', minPx: [1, 0.6, 0], widthScale: 0.6 },
  { cls: 'minor', minPx: [1.2, 0.8, 0], widthScale: 1 },
  { cls: 'street', minPx: [1.6, 1, 0.5], widthScale: 1 },
  { cls: 'avenue', minPx: [2.2, 1.5, 0.9], widthScale: 1 },
  { cls: 'bridge', minPx: [2.2, 1.5, 1], widthScale: 1 },
  { cls: 'highway', minPx: [2.6, 1.8, 1.2], widthScale: 1 },
]

interface TileEntry {
  canvas: HTMLCanvasElement
  used: number
  withLand: boolean
}

export interface MapView {
  /** World point at the view's pivot. */
  cx: number
  cz: number
  /** World metres per CSS pixel. */
  metresPerPx: number
  /** Canvas rotation, radians (the map turns by this about the pivot). */
  rotation: number
  /** Canvas CSS size and pivot position. */
  width: number
  height: number
  pivotX: number
  pivotY: number
  /** Device pixels per CSS pixel. */
  dpr: number
}

export class StreetAtlas {
  private tiles = new Map<string, TileEntry>()
  private queue: Array<{ level: number; tx: number; tz: number; key: string }> = []
  private queued = new Set<string>()
  private stamp = 0
  private land: LandTriangles[] | null = null
  private readonly data: StreetData

  constructor(data: StreetData) {
    this.data = data
  }

  /**
   * Pick the level whose resolution suits `devicePxPerMetre`: the coarsest
   * level still at least ~half the screen's resolution. Generous on purpose —
   * the radar on foot must never flip level (and wait on fresh tiles) just
   * because the player broke into a sprint.
   */
  levelFor(devicePxPerMetre: number): number {
    for (let level = LEVEL_TILE_M.length - 1; level >= 0; level--) {
      const tilePxPerM = TILE_PX / LEVEL_TILE_M[level]
      if (tilePxPerM >= devicePxPerMetre * 0.6) return level
    }
    return 0
  }

  /** A cached tile, without queueing anything. */
  private peek(level: number, tx: number, tz: number): TileEntry | null {
    const tile = this.tiles.get(`${level}:${tx},${tz}`)
    if (tile) tile.used = ++this.stamp
    return tile ?? null
  }

  private request(level: number, tx: number, tz: number): TileEntry | null {
    const key = `${level}:${tx},${tz}`
    const tile = this.tiles.get(key)
    // A tile drawn before the island arrived is redrawn once it has.
    if (tile && (tile.withLand || !this.land)) {
      tile.used = ++this.stamp
      return tile
    }
    if (!this.queued.has(key)) {
      this.queued.add(key)
      this.queue.push({ level, tx, tz, key })
    }
    return tile ?? null
  }

  /** Render queued tiles until `budgetMs` is spent. */
  pump(budgetMs: number): void {
    if (!this.land) this.land = landTriangles()
    const start = performance.now()
    // Nearest-first would be nicer; newest-first is close enough, since a
    // view requests its tiles every frame and the backlog is the old view's.
    while (this.queue.length > 0 && performance.now() - start < budgetMs) {
      const job = this.queue.pop()!
      this.queued.delete(job.key)
      const canvas = this.tiles.get(job.key)?.canvas ?? document.createElement('canvas')
      this.render(canvas, job.level, job.tx, job.tz)
      this.tiles.set(job.key, { canvas, used: ++this.stamp, withLand: this.land !== null })
    }
    if (this.queue.length > 64) this.queue.splice(0, this.queue.length - 64)
    if (this.tiles.size > MAX_TILES) {
      const byAge = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used)
      for (const [key] of byAge.slice(0, this.tiles.size - MAX_TILES)) this.tiles.delete(key)
    }
  }

  private render(canvas: HTMLCanvasElement, level: number, tx: number, tz: number): void {
    const size = LEVEL_TILE_M[level]
    canvas.width = TILE_PX
    canvas.height = TILE_PX
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scale = TILE_PX / size
    const x0 = tx * size
    const z0 = tz * size
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = MAP_COLORS.water
    ctx.fillRect(0, 0, TILE_PX, TILE_PX)
    // World → tile pixels.
    ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -z0 * scale)

    const cellsPerTile = size / INDEX_CELL
    const c0x = Math.floor(x0 / INDEX_CELL)
    const c0z = Math.floor(z0 / INDEX_CELL)

    if (this.land) {
      for (const layer of this.land) {
        const seen = new Set<number>()
        const path = new Path2D()
        for (let cx = c0x; cx < c0x + cellsPerTile; cx++) {
          for (let cz = c0z; cz < c0z + cellsPerTile; cz++) {
            const list = layer.cells.get(cellKey(cx, cz))
            if (!list) continue
            for (const t of list) {
              if (seen.has(t)) continue
              seen.add(t)
              const o = t * 6
              const tris = layer.tris
              const ax = tris[o]
              const az = tris[o + 1]
              let bx = tris[o + 2]
              let bz = tris[o + 3]
              let qx = tris[o + 4]
              let qz = tris[o + 5]
              // One winding for every triangle, so overlapping faces of the
              // export never cancel each other out under the nonzero rule.
              if ((bx - ax) * (qz - az) - (bz - az) * (qx - ax) < 0) {
                ;[bx, qx] = [qx, bx]
                ;[bz, qz] = [qz, bz]
              }
              path.moveTo(ax, az)
              path.lineTo(bx, bz)
              path.lineTo(qx, qz)
              path.closePath()
            }
          }
        }
        ctx.fillStyle = LAND_FILL[layer.layer]
        ctx.fill(path)
        // Hairline stroke in the same colour closes the anti-aliasing seams
        // between neighbouring triangles.
        ctx.strokeStyle = LAND_FILL[layer.layer]
        ctx.lineWidth = 0.9 / scale
        ctx.stroke(path)
      }
    }

    // Roads, least important first so avenues paint over side streets.
    const edgeIndices = new Set<number>()
    for (let cx = c0x; cx < c0x + cellsPerTile; cx++) {
      for (let cz = c0z; cz < c0z + cellsPerTile; cz++) {
        const list = this.data.cells.get(cellKey(cx, cz))
        if (list) for (const index of list) edgeIndices.add(index)
      }
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const { cls, minPx, widthScale } of ROAD_ORDER) {
      const min = minPx[level]
      if (min <= 0) continue
      // Group by width so each stroke is one path.
      const byWidth = new Map<number, Path2D>()
      for (const index of edgeIndices) {
        const e = this.data.edges[index]
        if (e.cls !== cls) continue
        const px = Math.max(min, e.width * widthScale * scale)
        const w = Math.round(px * 2) / 2
        let path = byWidth.get(w)
        if (!path) {
          path = new Path2D()
          byWidth.set(w, path)
        }
        const pts = e.pts
        path.moveTo(pts[0], pts[1])
        for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1])
      }
      ctx.strokeStyle = MAP_COLORS[cls]
      for (const [w, path] of byWidth) {
        ctx.lineWidth = w / scale
        ctx.stroke(path)
      }
    }
  }

  /**
   * Draw the map into `ctx` for `view`. The context's transform is replaced.
   * Returns false while tiles are still missing (the caller may redraw soon).
   */
  draw(ctx: CanvasRenderingContext2D, view: MapView, level: number): boolean {
    const size = LEVEL_TILE_M[level]
    const { dpr } = view
    const k = 1 / view.metresPerPx
    // Pivot → rotate → world.
    const cos = Math.cos(view.rotation)
    const sin = Math.sin(view.rotation)
    const a = cos * k * dpr
    const b = sin * k * dpr
    const c = -sin * k * dpr
    const d = cos * k * dpr
    const e = view.pivotX * dpr - (a * view.cx + c * view.cz)
    const f = view.pivotY * dpr - (b * view.cx + d * view.cz)
    ctx.setTransform(a, b, c, d, e, f)

    // World-space bounds of the view: the farthest canvas corner from the
    // pivot bounds the rotated view.
    const reach =
      Math.max(
        Math.hypot(view.pivotX, view.pivotY),
        Math.hypot(view.width - view.pivotX, view.pivotY),
        Math.hypot(view.pivotX, view.height - view.pivotY),
        Math.hypot(view.width - view.pivotX, view.height - view.pivotY),
      ) * view.metresPerPx
    const tx0 = Math.floor((view.cx - reach) / size)
    const tx1 = Math.floor((view.cx + reach) / size)
    const tz0 = Math.floor((view.cz - reach) / size)
    const tz1 = Math.floor((view.cz + reach) / size)
    let complete = true
    ctx.imageSmoothingEnabled = true
    // Overlap each tile by a hair so the seams between them never show.
    const bleed = view.metresPerPx * 0.6
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let tz = tz0; tz <= tz1; tz++) {
        const tile = this.request(level, tx, tz)
        if (tile) {
          ctx.drawImage(tile.canvas, tx * size - bleed, tz * size - bleed, size + bleed * 2, size + bleed * 2)
          continue
        }
        complete = false
        // Stand-in, first choice: the finer tiles it covers, if all cached
        // (a zoom-out right after a zoom-in).
        if (level > 0) {
          const fine = LEVEL_TILE_M[level - 1]
          const n = size / fine
          const parts: Array<[TileEntry, number, number]> = []
          for (let i = 0; i < n && parts.length === i * n; i++) {
            for (let j = 0; j < n; j++) {
              const part = this.peek(level - 1, tx * n + i, tz * n + j)
              if (!part) break
              parts.push([part, tx * n + i, tz * n + j])
            }
          }
          if (parts.length === n * n) {
            for (const [part, fx, fz] of parts) ctx.drawImage(part.canvas, fx * fine - bleed, fz * fine - bleed, fine + bleed * 2, fine + bleed * 2)
            continue
          }
        }
        // Otherwise the enclosing coarser tile, cropped.
        for (let up = level + 1; up < LEVEL_TILE_M.length; up++) {
          const upSize = LEVEL_TILE_M[up]
          const ux = Math.floor((tx * size) / upSize)
          const uz = Math.floor((tz * size) / upSize)
          const key = `${up}:${ux},${uz}`
          const parent = this.tiles.get(key)
          if (!parent) {
            this.request(up, ux, uz)
            continue
          }
          const scale = TILE_PX / upSize
          const sx = (tx * size - ux * upSize) * scale
          const sz = (tz * size - uz * upSize) * scale
          ctx.drawImage(parent.canvas, sx, sz, size * scale, size * scale, tx * size, tz * size, size, size)
          break
        }
      }
    }
    return complete
  }
}
