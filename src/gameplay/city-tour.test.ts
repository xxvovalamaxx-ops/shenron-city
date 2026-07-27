import { describe, expect, it } from 'vitest'
import {
  advanceCityTour,
  CITY_TOUR_STEPS,
  cityTourLocationEvents,
  cityTourProgress,
  currentCityTourStep,
  INITIAL_CITY_TOUR,
  type CityTourEvent,
} from './city-tour'

describe('city tour progression', () => {
  it('starts at the market and advances through the complete route', () => {
    const route: CityTourEvent[] = [
      'VISIT_MARKET',
      'TALK_MIRA',
      'ENTER_HEADQUARTERS',
      'TALK_IRIS',
      'REACH_FLOOR_45',
      'INSPECT_OFFICE',
    ]
    let state = INITIAL_CITY_TOUR

    for (const event of route) state = advanceCityTour(state, event)

    expect(state.completed).toBe(CITY_TOUR_STEPS.length)
    expect(currentCityTourStep(state)).toBeNull()
    expect(cityTourProgress(state)).toBe(1)
  })

  it('ignores skipped, repeated and post-completion events', () => {
    const skipped = advanceCityTour(INITIAL_CITY_TOUR, 'TALK_MIRA')
    expect(skipped).toBe(INITIAL_CITY_TOUR)

    const visited = advanceCityTour(skipped, 'VISIT_MARKET')
    expect(advanceCityTour(visited, 'VISIT_MARKET')).toBe(visited)

    let complete = visited
    for (const event of [
      'TALK_MIRA',
      'ENTER_HEADQUARTERS',
      'TALK_IRIS',
      'REACH_FLOOR_45',
      'INSPECT_OFFICE',
    ] as const) {
      complete = advanceCityTour(complete, event)
    }
    expect(advanceCityTour(complete, 'INSPECT_OFFICE')).toBe(complete)
  })

  it('reports market, lobby and floor 45 location events only in their zones', () => {
    expect(cityTourLocationEvents({ x: 12, y: 0, z: 86 })).toContain('VISIT_MARKET')
    expect(cityTourLocationEvents({ x: 0, y: 0, z: -12 })).toContain(
      'ENTER_HEADQUARTERS',
    )
    expect(cityTourLocationEvents({ x: 0, y: 180, z: -12 })).toContain(
      'REACH_FLOOR_45',
    )
    expect(cityTourLocationEvents({ x: -10.7, y: 0, z: 145 })).toEqual([])
  })
})
