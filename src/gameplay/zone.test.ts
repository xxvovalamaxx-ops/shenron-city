import { describe, expect, it } from 'vitest'
import { HQ, LOBBY, SHAFT } from '../world/layout'
import {
  gameplayZoneAt,
  hudVisibilityForZone,
  outdoorSimulationActive,
  sceneVisibilityForZone,
  simulationScopeActive,
} from './zone'

describe('authoritative gameplay zone', () => {
  it('classifies the exterior and both authored interior floors', () => {
    expect(gameplayZoneAt({ x: 0, y: 0, z: 20 }, 0)).toBe('exterior')
    expect(gameplayZoneAt({ x: 0, y: 0, z: -12 }, 0)).toBe('lobby')
    expect(gameplayZoneAt({ x: 0, y: HQ.y, z: -12 }, HQ.y)).toBe('floor45')
  })

  it('gives the moving elevator car priority over either landing', () => {
    for (const carY of [0, 75, HQ.y]) {
      expect(
        gameplayZoneAt(
          {
            x: 0,
            y: carY + 0.05,
            z: SHAFT.doorZ - SHAFT.carDepth / 2,
          },
          carY,
        ),
      ).toBe('elevator')
    }
  })

  it('does not classify adjacent rooms or the open shaft as the elevator', () => {
    expect(gameplayZoneAt({ x: 0, y: 0, z: LOBBY.backZ + 2 }, HQ.y)).toBe('lobby')
    expect(gameplayZoneAt({ x: 0, y: 75, z: SHAFT.doorZ - 1 }, 0)).toBe('exterior')
    expect(gameplayZoneAt({ x: HQ.halfWidth + 2, y: HQ.y, z: -12 }, HQ.y)).toBe(
      'exterior',
    )
  })

  it('keeps outdoor simulation alive only where it can be seen through the entrance', () => {
    expect(outdoorSimulationActive('exterior')).toBe(true)
    expect(outdoorSimulationActive('lobby')).toBe(true)
    expect(outdoorSimulationActive('elevator')).toBe(false)
    expect(outdoorSimulationActive('floor45')).toBe(false)
  })

  it('keeps scoped actors active only in visible portal-adjacent zones', () => {
    expect(simulationScopeActive('global', 'floor45')).toBe(true)
    expect(simulationScopeActive('outdoor', 'elevator')).toBe(false)
    expect(simulationScopeActive('lobby', 'exterior')).toBe(true)
    expect(simulationScopeActive('lobby', 'floor45')).toBe(false)
    expect(simulationScopeActive('floor45', 'elevator')).toBe(true)
    expect(simulationScopeActive('floor45', 'lobby')).toBe(false)
  })

  it('shows map and elevator telemetry only in their physical contexts', () => {
    expect(hudVisibilityForZone('exterior')).toEqual({ minimap: true, elevator: false })
    expect(hudVisibilityForZone('lobby')).toEqual({ minimap: false, elevator: false })
    expect(hudVisibilityForZone('elevator')).toEqual({ minimap: false, elevator: true })
    expect(hudVisibilityForZone('floor45')).toEqual({ minimap: false, elevator: false })
  })

  it('keeps adjacent portal zones visible without drawing every district', () => {
    expect(sceneVisibilityForZone('exterior')).toEqual({
      exterior: true,
      lobby: true,
      floor45: false,
    })
    expect(sceneVisibilityForZone('elevator')).toEqual({
      exterior: false,
      lobby: true,
      floor45: true,
    })
    expect(sceneVisibilityForZone('floor45')).toEqual({
      exterior: false,
      lobby: false,
      floor45: true,
    })
  })
})
