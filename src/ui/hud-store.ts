/**
 * The simulation → React bridge.
 *
 * Written at ~10 Hz from the game loop. Anything the UI needs to *display*
 * lives here; anything the simulation needs to *run* stays in runtime.ts. The
 * split exists so React never re-renders at frame rate.
 */
import { create } from 'zustand'

export type Screen = 'loading' | 'title' | 'playing' | 'paused'

export interface HudState {
  screen: Screen
  /** Transient prompt text (fly-mode hints, future interactions). */
  promptLabel: string | null
  fps: number
  frameMs: number
  mapPlayerX: number
  mapPlayerZ: number
  mapHeading: number
  showPerf: boolean
  /** Camera mode. Lives here, not on rt, so components re-render on toggle. */
  thirdPerson: boolean
  /** Dev tools overlay. */
  devToolsOpen: boolean

  set<K extends keyof HudState>(key: K, value: HudState[K]): void
  setScreen(s: Screen): void
  togglePerf(): void
  toggleThirdPerson(): void
  toggleDevTools(): void
}

export const useHud = create<HudState>((set) => ({
  screen: 'loading',
  promptLabel: null,
  fps: 0,
  frameMs: 0,
  mapPlayerX: 0,
  mapPlayerZ: 0,
  mapHeading: 0,
  showPerf: false,
  thirdPerson: true,
  devToolsOpen: false,

  set: (key, value) => set({ [key]: value } as Pick<HudState, typeof key>),
  setScreen: (screen) => set({ screen }),
  togglePerf: () => set((s) => ({ showPerf: !s.showPerf })),
  toggleThirdPerson: () => set((s) => ({ thirdPerson: !s.thirdPerson })),
  toggleDevTools: () => set((s) => ({ devToolsOpen: !s.devToolsOpen })),
}))

/** Screens during which the world must not accept movement input. */
export function inputLocked(screen: Screen): boolean {
  return screen !== 'playing'
}
