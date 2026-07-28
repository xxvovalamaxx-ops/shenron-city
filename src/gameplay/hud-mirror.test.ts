import { describe, expect, it } from 'vitest'
import { hudMirrorChanged, type HudMirror } from './hud-mirror'

const BASE: HudMirror = {
  promptLabel: 'Talk to Iris',
  promptKind: 'secretary',
  promptPayload: null,
  floorLabel: 'L',
  elevatorPhase: 'open',
  fps: 60,
  frameMs: 16.7,
  tourBearing: 15,
  tourDistance: 42,
  mapPlayerX: -10.5,
  mapPlayerZ: 145,
  mapHeading: 0,
  mapTargetX: 13.85,
  mapTargetZ: 86,
}

describe('HUD mirror updates', () => {
  it('does not write when the mirrored state is unchanged', () => {
    expect(hudMirrorChanged({ ...BASE }, BASE)).toBe(false)
  })

  it.each<keyof HudMirror>([
    'promptLabel',
    'promptKind',
    'promptPayload',
    'floorLabel',
    'elevatorPhase',
    'fps',
    'frameMs',
    'tourBearing',
    'tourDistance',
    'mapPlayerX',
    'mapPlayerZ',
    'mapHeading',
    'mapTargetX',
    'mapTargetZ',
  ])('detects a change to %s', (key) => {
    const next: HudMirror = { ...BASE }
    const replacements: HudMirror = {
      promptLabel: 'Enter Nova office',
      promptKind: 'agent-office',
      promptPayload: 'nova',
      floorLabel: '45',
      elevatorPhase: 'travelling',
      fps: 59,
      frameMs: 17,
      tourBearing: 20,
      tourDistance: 41,
      mapPlayerX: -10.25,
      mapPlayerZ: 144.75,
      mapHeading: 5,
      mapTargetX: 0,
      mapTargetZ: -2,
    }
    Object.assign(next, { [key]: replacements[key] })

    expect(hudMirrorChanged(next, BASE)).toBe(true)
  })
})
