import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  W47_HERO_CLUSTER,
  W47_HQ_BUILDING_ID,
  installPersistentHeroCells,
} from './hero-cell-manifest'
import { HeroCellRegistry, tileIndexFor, type BuildingLookup } from './hero-cells'

const RECORD_BYTES = 20
const core = readFileSync(
  fileURLToPath(new URL('../../public/models/manhattan/data/core.bin', import.meta.url)),
)
const view = new DataView(core.buffer, core.byteOffset, core.byteLength)
const city: BuildingLookup = {
  count: core.byteLength / RECORD_BYTES,
  x: (id) => view.getFloat32(id * RECORD_BYTES, true),
  y: (id) => view.getFloat32(id * RECORD_BYTES + 4, true),
  height: (id) => view.getFloat32(id * RECORD_BYTES + 8, true),
}

describe('persistent W47 hero-cell manifest', () => {
  it('ships six unique real building ids around, but not on top of, the authored HQ', () => {
    const ids = W47_HERO_CLUSTER.map((entry) => entry.spec.buildingId)
    expect(ids).toEqual([20093, 20653, 21717, 21729, 34687, 34859])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(W47_HQ_BUILDING_ID)
    for (const entry of W47_HERO_CLUSTER) {
      expect(entry.spec.buildingId).toBeGreaterThanOrEqual(0)
      expect(entry.spec.buildingId).toBeLessThan(city.count)
      expect(tileIndexFor(city.x(entry.spec.buildingId), city.y(entry.spec.buildingId)))
        .toEqual({ tx: -2, ty: -2 })
    }
  })

  it('is pinned to the coordinates and heights actually shipped in core.bin', () => {
    for (const entry of W47_HERO_CLUSTER) {
      const id = entry.spec.buildingId
      expect(city.x(id), `${id} x`).toBeCloseTo(entry.source.x, 1)
      expect(city.y(id), `${id} y`).toBeCloseTo(entry.source.y, 1)
      expect(city.height(id), `${id} height`).toBeCloseTo(entry.source.height, 1)
      expect(entry.spec.yOffset).toBe(12)
      expect(entry.spec.lod1FromMetres).toBe(300)
    }
  })

  it('installs valid specs idempotently without clearing a loaded cell', () => {
    const registry = new HeroCellRegistry()
    installPersistentHeroCells(registry)
    expect(registry.validate(city)).toEqual([])
    expect(registry.size).toBe(W47_HERO_CLUSTER.length)
    const id = W47_HERO_CLUSTER[0].spec.buildingId
    registry.markReady(id)
    installPersistentHeroCells(registry)
    expect(registry.size).toBe(W47_HERO_CLUSTER.length)
    expect(registry.isReady(id)).toBe(true)
  })

  it('keeps source-footprint diagnostics as envelopes, not a substitute for polygon containment', () => {
    for (const entry of W47_HERO_CLUSTER) {
      const envelope = entry.sourceFootprintEnvelope
      expect(envelope.minX, `${entry.spec.buildingId} min x`).toBeLessThan(envelope.maxX)
      expect(envelope.minZ, `${entry.spec.buildingId} min z`).toBeLessThan(envelope.maxZ)
    }
  })
})
