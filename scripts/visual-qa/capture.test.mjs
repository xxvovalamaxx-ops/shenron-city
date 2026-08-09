import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { captureExitCode, summarizeCaptureChecks } from './capture.mjs'

describe('visual capture verdicts', () => {
  it('makes a failed frame-diff fail the scene and the CI exit gate', () => {
    const verdict = summarizeCaptureChecks({
      'frame-not-black': { pass: true, severity: 'P0' },
      'frame-diff': { pass: false, severity: 'P0' },
    })

    expect(verdict).toEqual({
      ok: false,
      failed: ['frame-diff(P0)'],
      p0Failed: true,
    })
    expect(captureExitCode([{ scene_id: 'w47', ...verdict }])).toBe(1)
  })

  it('does not fail a deterministic frame-diff accepted by its scene override', () => {
    const verdict = summarizeCaptureChecks({
      'frame-not-black': { pass: true, severity: 'P0' },
      'frame-diff': { pass: true, severity: 'P0' },
    })

    expect(verdict).toEqual({ ok: true, failed: [], p0Failed: false })
    expect(captureExitCode([{ scene_id: 'w47', ...verdict }])).toBe(0)
  })

  it('scopes the zero-diff minimum to the deterministic W47 reference scenes', () => {
    const manifest = JSON.parse(readFileSync(new URL('./scene-manifest.json', import.meta.url), 'utf8'))
    const scenes = ['reference-rooftop-canyon', 'reference-driving-canyon'].map((sceneId) =>
      manifest.scenes.find((scene) => scene.scene_id === sceneId),
    )

    for (const scene of scenes) {
      expect(scene).toBeTruthy()
      expect(scene.thresholdOverrides?.['frame-diff']).toEqual({ min: 0 })
      expect(scene.note).toMatch(/global maximum still catches camera drift/)
    }
  })
})
