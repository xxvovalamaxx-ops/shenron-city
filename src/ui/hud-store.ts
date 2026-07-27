/**
 * The simulation → React bridge.
 *
 * Written at ~10 Hz from the game loop. Anything the UI needs to *display*
 * lives here; anything the simulation needs to *run* stays in runtime.ts. The
 * split exists so React never re-renders at frame rate.
 */
import { create } from 'zustand'
import type { InteractKind } from '../gameplay/interact'
import type { CharacterId } from '../agents/dialogue'
import {
  advanceCityTour,
  INITIAL_CITY_TOUR,
  type CityTourEvent,
  type CityTourState,
} from '../gameplay/city-tour'

export type Screen = 'loading' | 'title' | 'playing' | 'paused' | 'dialogue' | 'office'

export interface HudState {
  screen: Screen
  /** Prompt text for the thing currently in front of the player. */
  promptLabel: string | null
  promptKind: InteractKind | null
  promptPayload: string | null
  floorLabel: string
  elevatorPhase: string
  fps: number
  frameMs: number
  showPerf: boolean
  /** Which agent's office panel is open. */
  openAgentId: string | null
  /** Which local scripted character owns the dialogue panel. */
  openCharacterId: CharacterId
  /** Session-only progress through the first complete playable route. */
  cityTour: CityTourState

  set<K extends keyof HudState>(key: K, value: HudState[K]): void
  setScreen(s: Screen): void
  togglePerf(): void
  advanceCityTour(event: CityTourEvent): void
}

export const useHud = create<HudState>((set) => ({
  screen: 'loading',
  promptLabel: null,
  promptKind: null,
  promptPayload: null,
  floorLabel: 'L',
  elevatorPhase: 'open',
  fps: 0,
  frameMs: 0,
  showPerf: false,
  openAgentId: null,
  openCharacterId: 'iris',
  cityTour: INITIAL_CITY_TOUR,

  set: (key, value) => set({ [key]: value } as Pick<HudState, typeof key>),
  setScreen: (screen) => set({ screen }),
  togglePerf: () => set((s) => ({ showPerf: !s.showPerf })),
  advanceCityTour: (event) =>
    set((state) => {
      const next = advanceCityTour(state.cityTour, event)
      return next === state.cityTour ? state : { cityTour: next }
    }),
}))

/** Screens during which the world must not accept movement input. */
export function inputLocked(screen: Screen): boolean {
  return screen !== 'playing'
}
