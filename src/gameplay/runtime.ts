/**
 * Mutable per-frame game state — Manhattan edition.
 *
 * Deliberately NOT React state. This changes 60 times a second; putting it in
 * useState would re-render the tree every frame and destroy frame pacing. React
 * owns the UI; this object owns the simulation. The bridge between them is
 * `useHud`, which is written at ~10 Hz.
 *
 * A single module-level instance is correct here — there is one game.
 */
import type { Vec3 } from './collision'
import type { Weather } from '../world/daycycle'
import { debugSpawnPosition } from './dev-view'
import { MANHATTAN_SPAWN_CANDIDATES } from '../world/manhattan-collision'

function initialPlayerPosition(): Vec3 {
  const defaultSpawn = {
    x: MANHATTAN_SPAWN_CANDIDATES[0][0],
    y: 12.4,
    z: MANHATTAN_SPAWN_CANDIDATES[0][1],
  }
  if (!import.meta.env.DEV || typeof location === 'undefined') return defaultSpawn

  return debugSpawnPosition(location.search, import.meta.env.DEV) ?? defaultSpawn
}

const INITIAL_PLAYER_POSITION = initialPlayerPosition()

export interface SpawnedEntity {
  id: number
  kind: string
  url: string
  pos: Vec3
  yaw: number
}

export interface Runtime {
  player: {
    pos: Vec3
    velocityY: number
    grounded: boolean
    flying: boolean
    /** Camera forward, horizontal plane, normalised. */
    forward: { x: number; z: number }
  }
  /** True while a modal (menu, pause) owns input. */
  paused: boolean
  /** Increments on every transition into pause so held actions cannot resume. */
  pauseEpoch: number
  /** Camera mode. Toggled with V; third person is the default. */
  thirdPerson: boolean
  /** Keyboard state, populated by useKeys. */
  keys: {
    forward: boolean
    back: boolean
    left: boolean
    right: boolean
    sprint: boolean
    jump: boolean
    crouch: boolean
  }
  /**
   * Cinematic intro: while `introSeconds` is below the intro duration the
   * camera is owned by the intro flight and the game loop defers input.
   */
  introSeconds: number
  /** Debug-multiplied movement speed for the dev tools (1 = normal). */
  devSpeed: number
  /** Objects spawned through the dev menu. */
  spawns: SpawnedEntity[]
  /**
   * Clock and weather. On rt rather than React state because it changes every
   * frame; the sky, the road material and the audio all read it.
   */
  clock: {
    /** Simulation seconds. Unlike R3F's clock, this does not advance while paused. */
    elapsed: number
    /** Hours, 0..24. */
    hour: number
    weather: Weather
    /** Where the weather is heading, 0 dry to 1 downpour. */
    rainTarget: number
  }
  /**
   * Rolling perf samples.
   */
  perf: {
    frames: number
    accum: number
    fps: number
    low1Fps: number
    frameMs: number
    calls: number
    triangles: number
    geometries: number
    programs: number
    textures: number
    frameTimes: number[]
  }
}

export const rt: Runtime = {
  player: {
    pos: { ...INITIAL_PLAYER_POSITION },
    velocityY: 0,
    grounded: false,
    flying: false,
    forward: { x: 0, z: -1 },
  },
  // The HUD begins on the loading screen, so the world must not start moving
  // before App synchronises the first screen state.
  paused: true,
  pauseEpoch: 0,
  thirdPerson: true,
  keys: { forward: false, back: false, left: false, right: false, sprint: false, jump: false, crouch: false },
  introSeconds: Number.POSITIVE_INFINITY,
  devSpeed: 1,
  spawns: [],
  clock: { elapsed: 0, hour: 21, weather: { rain: 0, wetness: 0 }, rainTarget: 0 },
  perf: {
    frames: 0,
    accum: 0,
    fps: 0,
    low1Fps: 0,
    frameMs: 0,
    calls: 0,
    triangles: 0,
    geometries: 0,
    programs: 0,
    textures: 0,
    frameTimes: [],
  },
}

export function resetPlayer(): void {
  rt.player.pos = initialPlayerPosition()
  rt.player.velocityY = 0
}

/**
 * Apply the authoritative simulation pause transition.
 *
 * Pausing clears every latched action immediately.
 */
export function setRuntimePaused(paused: boolean): void {
  if (paused && !rt.paused) rt.pauseEpoch += 1
  rt.paused = paused
  if (!paused) return

  for (const key of Object.keys(rt.keys) as (keyof Runtime['keys'])[]) {
    rt.keys[key] = false
  }
}

/** Advance and return the pause-aware simulation clock. */
export function advanceRuntimeTime(dt: number): number {
  if (rt.paused || !Number.isFinite(dt) || dt <= 0) return rt.clock.elapsed
  rt.clock.elapsed += dt
  return rt.clock.elapsed
}

// Dev-only handle so the world can be driven and inspected from the console
// without pointer lock — which browsers refuse to grant to synthetic clicks,
// making automated verification of the route impossible otherwise. Stripped
// from production builds by the DEV guard.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __rt: Runtime }).__rt = rt
}
