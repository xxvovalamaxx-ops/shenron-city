/**
 * The coarse gameplay/streaming zone shared by simulation, rendering and UI.
 *
 * Audio keeps a feathered mix for click-free crossfades, but gameplay needs a
 * single deterministic answer so exterior actors and interior HUD cannot
 * disagree about where the player is.
 */
import type { Vec3 } from './collision'
import { HQ, LOBBY, SHAFT } from '../world/layout'

export type GameplayZone = 'exterior' | 'lobby' | 'elevator' | 'floor45'
export type SimulationScope = 'global' | 'outdoor' | 'lobby' | 'floor45'

const EDGE = 0.35
const FLOOR_TOLERANCE = 0.65

function between(value: number, min: number, max: number): boolean {
  return value >= min && value <= max
}

/** Resolve the player's authoritative coarse zone from physical bounds. */
export function gameplayZoneAt(position: Vec3, elevatorCarY: number): GameplayZone {
  const insideCar =
    Math.abs(position.x) <= SHAFT.halfWidth + EDGE &&
    between(position.z, SHAFT.backZ - EDGE, SHAFT.doorZ + EDGE) &&
    between(
      position.y,
      elevatorCarY - FLOOR_TOLERANCE,
      elevatorCarY + SHAFT.carHeight + EDGE,
    )
  if (insideCar) return 'elevator'

  const onFloor45 =
    Math.abs(position.x) <= HQ.halfWidth + EDGE &&
    between(position.z, HQ.backZ - EDGE, HQ.frontZ + EDGE) &&
    between(position.y, HQ.y - FLOOR_TOLERANCE, HQ.y + HQ.ceiling + EDGE)
  if (onFloor45) return 'floor45'

  const inLobby =
    Math.abs(position.x) <= LOBBY.halfWidth + EDGE &&
    between(position.z, LOBBY.backZ - EDGE, LOBBY.frontZ - EDGE) &&
    between(position.y, -FLOOR_TOLERANCE, LOBBY.ceiling + EDGE)
  if (inLobby) return 'lobby'

  return 'exterior'
}

/** Exterior actors remain active in the lobby so the glass entrance has life. */
export function outdoorSimulationActive(zone: GameplayZone): boolean {
  return zone === 'exterior' || zone === 'lobby'
}

/** Decide whether a scoped animated actor can affect the current frame. */
export function simulationScopeActive(
  scope: SimulationScope,
  zone: GameplayZone,
): boolean {
  switch (scope) {
    case 'outdoor':
      return outdoorSimulationActive(zone)
    case 'lobby':
      return zone === 'exterior' || zone === 'lobby' || zone === 'elevator'
    case 'floor45':
      return zone === 'elevator' || zone === 'floor45'
    default:
      return true
  }
}

/** Contextual HUD surfaces; prompts and the tour remain global. */
export function hudVisibilityForZone(zone: GameplayZone): {
  minimap: boolean
  elevator: boolean
} {
  return {
    minimap: zone === 'exterior',
    elevator: zone === 'elevator',
  }
}

/** Portal-aware render groups: adjacent rooms overlap so transitions stay seamless. */
export function sceneVisibilityForZone(zone: GameplayZone): {
  exterior: boolean
  lobby: boolean
  floor45: boolean
} {
  return {
    exterior: zone === 'exterior' || zone === 'lobby',
    lobby: zone !== 'floor45',
    floor45: zone === 'elevator' || zone === 'floor45',
  }
}
