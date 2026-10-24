/**
 * The simulation → React bridge.
 *
 * Written at ~10 Hz from the game loop. Anything the UI needs to *display*
 * lives here; anything the simulation needs to *run* stays in runtime.ts. The
 * split exists so React never re-renders at frame rate.
 *
 * GTA HUD state (health, armor, money, wanted level, the mission banner and
 * the map waypoint) lives here too, with setters a gameplay phase can drive:
 *
 *   useHud.getState().addMoney(250)
 *   useHud.getState().setWanted(2)            // 0–5 stars
 *   useHud.getState().setWanted(2, true)      // flashing: cops lost sight
 *   useHud.getState().setHealth(60)
 *   useHud.getState().showBanner('MISSION PASSED', 'Respect +')
 */
import { create } from 'zustand'
import { clampStat, clampWanted } from './radar/radar-math'

export type Screen = 'loading' | 'title' | 'playing' | 'paused'

export type BannerKind = 'passed' | 'failed' | 'info'

export interface HudBanner {
  /** Increments per banner, so the same text shown twice still re-animates. */
  id: number
  title: string
  subtitle: string | null
  kind: BannerKind
  /** performance.now() after which the banner is gone. */
  until: number
}

export interface Waypoint {
  x: number
  z: number
}

export interface HudState {
  screen: Screen
  /** Transient prompt text (interaction prompts, mode hints). */
  promptLabel: string | null
  fps: number
  frameMs: number
  mapPlayerX: number
  mapPlayerZ: number
  mapHeading: number
  /** Ground speed while driving, km/h. Zero on foot. */
  vehicleSpeedKmh: number
  /** Display name of the vehicle being driven (fictional make), if any. */
  vehicleName: string | null
  showPerf: boolean
  /** Camera mode. Lives here, not on rt, so components re-render on toggle. */
  thirdPerson: boolean
  /** Dev tools overlay. */
  devToolsOpen: boolean

  /** 0..100. */
  health: number
  /** 0..100. */
  armor: number
  /** Dollars. */
  money: number
  /** 0..5 stars. */
  wanted: number
  /** Stars flash while the police search for a player they lost sight of. */
  wantedFlashing: boolean
  /** Big centred mission text, or null. */
  banner: HudBanner | null
  /** Map waypoint set from the pause map; the radar routes to it. */
  waypoint: Waypoint | null

  set<K extends keyof HudState>(key: K, value: HudState[K]): void
  setScreen(s: Screen): void
  togglePerf(): void
  toggleThirdPerson(): void
  toggleDevTools(): void

  setHealth(value: number): void
  setArmor(value: number): void
  setMoney(value: number): void
  addMoney(delta: number): void
  setWanted(level: number, flashing?: boolean): void
  showBanner(title: string, subtitle?: string | null, options?: { kind?: BannerKind; durationMs?: number }): void
  clearBanner(): void
  setWaypoint(waypoint: Waypoint | null): void
}

let bannerSerial = 0

export const useHud = create<HudState>((set) => ({
  screen: 'loading',
  promptLabel: null,
  fps: 0,
  frameMs: 0,
  mapPlayerX: 0,
  mapPlayerZ: 0,
  mapHeading: 0,
  vehicleSpeedKmh: 0,
  vehicleName: null,
  showPerf: false,
  thirdPerson: true,
  devToolsOpen: false,

  health: 100,
  armor: 0,
  money: 0,
  wanted: 0,
  wantedFlashing: false,
  banner: null,
  waypoint: null,

  set: (key, value) => set({ [key]: value } as Pick<HudState, typeof key>),
  setScreen: (screen) => set({ screen }),
  togglePerf: () => set((s) => ({ showPerf: !s.showPerf })),
  toggleThirdPerson: () => set((s) => ({ thirdPerson: !s.thirdPerson })),
  toggleDevTools: () => set((s) => ({ devToolsOpen: !s.devToolsOpen })),

  setHealth: (value) => set({ health: clampStat(value) }),
  setArmor: (value) => set({ armor: clampStat(value) }),
  setMoney: (value) => set({ money: Number.isFinite(value) ? Math.round(value) : 0 }),
  addMoney: (delta) =>
    set((s) => ({ money: s.money + (Number.isFinite(delta) ? Math.round(delta) : 0) })),
  setWanted: (level, flashing = false) => {
    const wanted = clampWanted(level)
    set({ wanted, wantedFlashing: wanted > 0 && flashing })
  },
  showBanner: (title, subtitle = null, options = {}) => {
    const now = typeof performance === 'undefined' ? 0 : performance.now()
    set({
      banner: {
        id: ++bannerSerial,
        title,
        subtitle: subtitle ?? null,
        kind: options.kind ?? (/fail/i.test(title) ? 'failed' : /pass|complete/i.test(title) ? 'passed' : 'info'),
        until: now + (options.durationMs ?? 4500),
      },
    })
  },
  clearBanner: () => set({ banner: null }),
  setWaypoint: (waypoint) =>
    set({
      waypoint:
        waypoint && Number.isFinite(waypoint.x) && Number.isFinite(waypoint.z)
          ? { x: waypoint.x, z: waypoint.z }
          : null,
    }),
}))

/** Screens during which the world must not accept movement input. */
export function inputLocked(screen: Screen): boolean {
  return screen !== 'playing'
}

// Dev-only handle, like `__rt`: drive the HUD from the console or a capture.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __hud: typeof useHud }).__hud = useHud
}
