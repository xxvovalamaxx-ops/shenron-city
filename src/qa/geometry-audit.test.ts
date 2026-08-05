import { describe, expect, it } from 'vitest'
import { auditCityGeometry, type NamedBox } from './geometry-audit'

function box(overrides: Partial<NamedBox>): NamedBox {
  return { id: 'fixture', x: 0, y: 0, z: 50, width: 2, depth: 2, height: 2, ...overrides }
}

describe('authored city geometry audit', () => {
  it('passes with zero findings on the current data', () => {
    const result = auditCityGeometry()
    expect(result.findings).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('produces machine-readable counts', () => {
    const result = auditCityGeometry()
    expect(typeof result.counts).toBe('object')
    for (const key of Object.keys(result.counts)) {
      expect(result.counts[key]).toBeGreaterThan(0)
    }
  })

  it('flags non-finite coordinates', () => {
    const result = auditCityGeometry([
      box({ id: 'nan-x', x: Number.NaN }),
      box({ id: 'inf-z', z: Number.POSITIVE_INFINITY }),
      box({ id: 'ok' }),
    ])
    const ids = result.findings.filter((f) => f.check === 'non_finite').map((f) => f.id).sort()
    expect(ids).toEqual(['inf-z', 'nan-x'])
    expect(result.counts['non_finite']).toBe(2)
  })

  it('flags inverted (negative or zero) extents', () => {
    const result = auditCityGeometry([
      box({ id: 'neg-w', width: -1 }),
      box({ id: 'zero-h', height: 0 }),
    ])
    expect(result.findings.map((f) => f.id).sort()).toEqual(['neg-w', 'zero-h'])
    expect(result.counts['inverted_scale']).toBe(2)
  })

  it('flags floating and buried props', () => {
    const result = auditCityGeometry([
      box({ id: 'floating', y: 1.5 }),
      box({ id: 'buried', y: -2, height: 1 }),
    ])
    expect(result.findings.map((f) => f.check)).toContain('floating')
    expect(result.findings.map((f) => f.check)).toContain('buried')
  })

  it('flags boxes that span past the ground footprint', () => {
    const result = auditCityGeometry([
      box({ id: 'past-west', x: -140, width: 40 }),
      box({ id: 'past-north', z: 220, depth: 40 }),
    ])
    expect(result.findings.map((f) => f.id).sort()).toEqual(['past-north', 'past-west'])
    expect(result.counts['span_outside_ground']).toBe(2)
  })
  it('flags duplicate ids', () => {
    const result = auditCityGeometry([box({ id: 'dup' }), box({ id: 'dup' })])
    expect(result.findings.map((f) => f.check)).toContain('duplicate_id')
    expect(result.counts['duplicate_id']).toBe(1)
  })

  it('is deterministic across identical inputs', () => {
    const boxes = [
      box({ id: 'a' }),
      box({ id: 'b', x: Number.NaN }),
      box({ id: 'c', width: -2 }),
      box({ id: 'd', y: 5 }),
    ]
    expect(auditCityGeometry(boxes)).toEqual(auditCityGeometry(boxes))
  })
})
