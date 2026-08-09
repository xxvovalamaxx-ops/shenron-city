import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { glbBounds, glbMetrics, readGlb } from './glb-utils.mjs'
import { authoredContainmentStats, deriveW47SourceFootprints } from './w47-footprint.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const cluster = JSON.parse(readFileSync(join(ROOT, 'src/world/w47-hero-cluster.json'), 'utf8'))
const report = JSON.parse(readFileSync(join(ROOT, 'public/models/manhattan/hero/w47/asset-report.json'), 'utf8'))
const sourceFootprintsPromise = deriveW47SourceFootprints(cluster, ROOT)

function asset(entry, lod) {
  const path = join(ROOT, 'public/models/manhattan/hero/w47', `building-${entry.buildingId}-${lod}.glb`)
  const parsed = readGlb(path)
  return { bytes: parsed.file.length, bounds: glbBounds(parsed.document), metrics: glbMetrics(parsed.document) }
}

describe('authored W47 hero assets', () => {
  it('cryptographically binds every checked-in source artifact used to derive the cluster', () => {
    expect(report.sourceArtifacts).toEqual(cluster.sourceArtifacts)
    for (const artifact of cluster.sourceArtifacts) {
      expect(artifact.path).not.toContain('..')
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
      const actual = createHash('sha256')
        .update(readFileSync(join(ROOT, ...artifact.path.split('/'))))
        .digest('hex')
      expect(actual, artifact.path).toBe(artifact.sha256)
    }
  })

  it('derives the real source polygons in the authored inverse-yaw local frame', async () => {
    const sourceFootprints = await sourceFootprintsPromise
    for (const entry of cluster.buildings) {
      const source = sourceFootprints.get(entry.buildingId)
      expect(source, `${entry.buildingId} source footprint`).toBeTruthy()
      expect(source.sourceTile, `${entry.buildingId} source tile`).toBe('manhattan_-02_-02.glb')
      expect(source.local.length, `${entry.buildingId} source vertices`).toBeGreaterThanOrEqual(3)
      expect(source.source.x, `${entry.buildingId} core x`).toBeCloseTo(entry.x, 1)
      expect(source.source.y, `${entry.buildingId} core y`).toBeCloseTo(entry.y, 1)
      expect(source.source.height, `${entry.buildingId} core height`).toBeCloseTo(entry.height, 1)
      for (const [key, value] of Object.entries(source.envelope)) {
        expect(entry.sourceFootprintEnvelope[key], `${entry.buildingId} ${key}`).toBeCloseTo(value, 3)
      }
    }
  })

  it('contains every authored horizontal vertex against its decoded source polygon', async () => {
    const sourceFootprints = await sourceFootprintsPromise
    const tolerance = cluster.footprintContainmentToleranceMetres
    expect(tolerance).toBeLessThanOrEqual(0.05)
    for (const entry of cluster.buildings) {
      const source = sourceFootprints.get(entry.buildingId)
      for (const lod of ['lod0', 'lod1']) {
        const path = join(ROOT, 'public/models/manhattan/hero/w47', `building-${entry.buildingId}-${lod}.glb`)
        const { bounds } = asset(entry, lod)
        expect(bounds, `${entry.buildingId} ${lod} bounds`).not.toBeNull()
        const containment = authoredContainmentStats(path, source.local, tolerance)
        expect(containment.vertices, `${entry.buildingId} ${lod} vertices`).toBeGreaterThan(0)
        expect(containment.beyondTolerance, `${entry.buildingId} ${lod} footprint breaches`).toBe(0)
        expect(bounds.min[1], `${entry.buildingId} ${lod} ground`).toBeGreaterThanOrEqual(0)
        expect(bounds.max[1], `${entry.buildingId} ${lod} roof`).toBeLessThanOrEqual(entry.budgets[lod].maxHeight)
      }
    }
  })

  it('enforces per-tier byte and triangle budgets, with a materially cheaper LOD1', () => {
    for (const entry of cluster.buildings) {
      const lod0 = asset(entry, 'lod0')
      const lod1 = asset(entry, 'lod1')
      for (const [name, current] of [['lod0', lod0], ['lod1', lod1]]) {
        const budget = entry.budgets[name]
        expect(current.bytes, `${entry.buildingId} ${name} bytes`).toBeLessThanOrEqual(budget.maxBytes)
        expect(current.metrics.triangles, `${entry.buildingId} ${name} tris`).toBeLessThanOrEqual(budget.maxTriangles)
        expect(current.metrics.missingMaterials, `${entry.buildingId} ${name} materials`).toBe(0)
        expect(current.metrics.images, `${entry.buildingId} ${name} images`).toBe(0)
        expect(current.metrics.textures, `${entry.buildingId} ${name} textures`).toBe(0)
      }
      expect(lod0.metrics.triangles, `${entry.buildingId} tier reduction`)
        .toBeGreaterThan(lod1.metrics.triangles * 3)
    }
  })

  it('matches the deterministic checked-in asset report and cluster aggregate budget', async () => {
    const sourceFootprints = await sourceFootprintsPromise
    let bytes = 0
    let triangles = 0
    for (const entry of cluster.buildings) {
      const recorded = report.entries.find((item) => item.buildingId === entry.buildingId)
      expect(recorded).toBeTruthy()
      const source = sourceFootprints.get(entry.buildingId)
      expect(recorded.sourceFootprint.localInverseYawPolygon).toEqual(
        source.local.map(([x, z]) => [+x.toFixed(6), +z.toFixed(6)]),
      )
      for (const lod of ['lod0', 'lod1']) {
        const current = asset(entry, lod)
        const path = join(ROOT, 'public/models/manhattan/hero/w47', `building-${entry.buildingId}-${lod}.glb`)
        const containment = authoredContainmentStats(path, source.local, cluster.footprintContainmentToleranceMetres)
        expect(recorded.files[lod].bytes).toBe(current.bytes)
        expect(recorded.files[lod].triangles).toBe(current.metrics.triangles)
        expect(recorded.files[lod].containment).toEqual(containment)
        bytes += current.bytes
        triangles += current.metrics.triangles
      }
    }
    expect(report.totals).toEqual({ bytes, triangles })
    expect(bytes).toBeLessThanOrEqual(600000)
    expect(triangles).toBeLessThanOrEqual(10000)
  })
})
