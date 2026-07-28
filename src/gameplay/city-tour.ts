/**
 * The first complete Shenzhen City gameplay loop.
 *
 * This is a pure ordered reducer. It does not know about React, Three.js,
 * storage or a host service, so route progression is deterministic and cheap
 * to test. Events from later objectives are ignored until their turn.
 */

export type CityTourEvent =
  | 'VISIT_MARKET'
  | 'TALK_MIRA'
  | 'ENTER_HEADQUARTERS'
  | 'TALK_IRIS'
  | 'REACH_FLOOR_45'
  | 'INSPECT_OFFICE'

export interface CityTourStep {
  id: string
  event: CityTourEvent
  title: string
  hint: string
}

export const CITY_TOUR_STEPS: readonly CityTourStep[] = [
  {
    id: 'visit-market',
    event: 'VISIT_MARKET',
    title: 'Visit the night market',
    hint: 'Follow Dragon Boulevard to the lit stalls on the right.',
  },
  {
    id: 'talk-mira',
    event: 'TALK_MIRA',
    title: 'Talk to Mira',
    hint: 'Find the market keeper, look toward her, and press E.',
  },
  {
    id: 'enter-headquarters',
    event: 'ENTER_HEADQUARTERS',
    title: 'Enter headquarters',
    hint: 'Continue toward the teal tower and cross the plaza.',
  },
  {
    id: 'talk-iris',
    event: 'TALK_IRIS',
    title: 'Check in with Iris',
    hint: 'Reception is on the left side of the lobby.',
  },
  {
    id: 'reach-floor-45',
    event: 'REACH_FLOOR_45',
    title: 'Reach floor 45',
    hint: 'Use the elevator panel at the back of the lobby.',
  },
  {
    id: 'inspect-office',
    event: 'INSPECT_OFFICE',
    title: 'Meet a headquarters resident',
    hint: 'Enter any office, look at its resident, and press E.',
  },
] as const

export interface CityTourState {
  /** Number of steps completed in the ordered route. */
  completed: number
}

export const INITIAL_CITY_TOUR: CityTourState = { completed: 0 }

export function currentCityTourStep(state: CityTourState): CityTourStep | null {
  return CITY_TOUR_STEPS[state.completed] ?? null
}

export function advanceCityTour(
  state: CityTourState,
  event: CityTourEvent,
): CityTourState {
  const current = currentCityTourStep(state)
  if (!current || current.event !== event) return state
  return { completed: state.completed + 1 }
}

export function cityTourProgress(state: CityTourState): number {
  return Math.min(1, state.completed / CITY_TOUR_STEPS.length)
}

export interface TourPosition {
  x: number
  y: number
  z: number
}

/**
 * Convert world position into route events. Repeating these every frame is
 * safe because the reducer is idempotent once the matching step advances.
 */
export function cityTourLocationEvents(position: TourPosition): CityTourEvent[] {
  const events: CityTourEvent[] = []

  const inMarket =
    position.x >= 9 &&
    position.x <= 20 &&
    position.z >= 71 &&
    position.z <= 107 &&
    position.y < 4
  if (inMarket) events.push('VISIT_MARKET')

  const inLobby =
    Math.abs(position.x) < 20.5 &&
    position.z < -0.5 &&
    position.z > -29.5 &&
    position.y < 8
  if (inLobby) events.push('ENTER_HEADQUARTERS')

  const onFloor45 =
    Math.abs(position.x) < 15.8 &&
    position.z < 3.8 &&
    position.z > -29.8 &&
    position.y >= 179.5
  if (onFloor45) events.push('REACH_FLOOR_45')

  return events
}
