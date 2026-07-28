import { describe, expect, it } from 'vitest'
import {
  motionForAgentState,
  SERVICE_ANDROID_CLIPS,
  styleForAgentName,
} from './service-android'

describe('service android presentation contract', () => {
  it('maps every operational state to an authored animation', () => {
    for (const state of ['active', 'idle', 'blocked', 'failed', 'offline', 'unknown'] as const) {
      expect(SERVICE_ANDROID_CLIPS).toContain(motionForAgentState(state))
    }
  })

  it('keeps the three hero agents visually distinct', () => {
    const styles = ['Aegis', 'Echo', 'Sentry'].map(styleForAgentName)
    expect(new Set(styles).size).toBe(3)
  })
})
