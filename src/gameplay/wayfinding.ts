/**
 * Renderer-free City Tour wayfinding.
 *
 * The HUD needs only a relative bearing and walking distance. Keeping the math
 * here makes its direction convention testable without a camera, DOM, or GPU.
 */
import { MARKET_KEEPER } from '../world/city-data'
import { ENTRANCE, OFFICE_SLOTS, SECRETARY, SHAFT } from '../world/layout'
import { currentCityTourStep, type CityTourState } from './city-tour'

export interface WayfindingPoint {
  x: number
  z: number
}

export interface TourWayfinding {
  /** Clockwise degrees from the player's forward direction. */
  bearing: number
  /** Horizontal metres to the active objective. */
  distance: number
}

function nearestPoint(
  from: WayfindingPoint,
  candidates: readonly WayfindingPoint[],
): WayfindingPoint | null {
  let nearest: WayfindingPoint | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - from.x, candidate.z - from.z)
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearest
}

/** Active objective anchor. Named residents and world geometry stay canonical. */
export function cityTourTarget(
  state: CityTourState,
  player: WayfindingPoint,
): WayfindingPoint | null {
  switch (currentCityTourStep(state)?.id) {
    case 'visit-market':
    case 'talk-mira':
      return MARKET_KEEPER
    case 'enter-headquarters':
      return { x: 0, z: ENTRANCE.z - 2 }
    case 'talk-iris':
      return SECRETARY
    case 'reach-floor-45':
      return { x: 0, z: SHAFT.doorZ + 1.5 }
    case 'inspect-office':
      return nearestPoint(player, OFFICE_SLOTS)
    default:
      return null
  }
}

export function relativeWayfinding(
  player: WayfindingPoint,
  forward: WayfindingPoint,
  target: WayfindingPoint,
): TourWayfinding {
  const dx = target.x - player.x
  const dz = target.z - player.z
  const distance = Math.hypot(dx, dz)
  if (distance < 1e-6) return { bearing: 0, distance: 0 }

  const forwardLength = Math.hypot(forward.x, forward.z)
  const fx = forwardLength > 1e-6 ? forward.x / forwardLength : 0
  const fz = forwardLength > 1e-6 ? forward.z / forwardLength : -1
  const tx = dx / distance
  const tz = dz / distance

  const dot = fx * tx + fz * tz
  const clockwiseCross = fx * tz - fz * tx
  return {
    bearing: Math.atan2(clockwiseCross, dot) * (180 / Math.PI),
    distance,
  }
}

/**
 * Quantized for the 10 Hz React mirror: accurate enough to guide the player
 * without causing a HUD render for sub-degree camera jitter.
 */
export function cityTourWayfinding(
  state: CityTourState,
  player: WayfindingPoint,
  forward: WayfindingPoint,
): TourWayfinding | null {
  const target = cityTourTarget(state, player)
  if (!target) return null
  const guidance = relativeWayfinding(player, forward, target)
  return {
    bearing: Math.round(guidance.bearing / 5) * 5,
    distance: Math.round(guidance.distance),
  }
}
