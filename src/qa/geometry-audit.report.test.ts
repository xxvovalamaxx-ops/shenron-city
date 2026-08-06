/**
 * The committed machine-readable geometry-audit artifact must match the live
 * audit.
 *
 * The audit is deterministic, so the committed report is the ground truth
 * until the authored city data changes. A stale artifact (regenerated JSON
 * that no longer matches, or findings the committed file does not record)
 * fails here — the same evidence-on-disk posture the rest of the project
 * uses for its reports.
 */
import { describe, expect, it } from 'vitest'
import committed from '../../docs/qa/geometry-audit.json'
import { auditCityGeometry } from './geometry-audit'

describe('geometry audit artifact', () => {
  it('matches the committed machine-readable report', () => {
    const live = auditCityGeometry()

    expect(committed.pass).toBe(true)
    expect(live.pass).toBe(true)
    expect(live.findings).toEqual(committed.findings)
    expect(live.counts).toEqual(committed.counts)
  })
})
