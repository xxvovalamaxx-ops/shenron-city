/**
 * Mutable per-frame game state.
 *
 * Deliberately NOT React state. This changes 60 times a second; putting it in
 * useState would re-render the tree every frame and destroy frame pacing. React
 * owns the UI; this object owns the simulation. The bridge between them is
 * `useHud`, which is written at ~10 Hz.
 *
 * A single module-level instance is correct here — there is one game.
 */
import type { InstancedMesh, Object3D } from 'three'
import { carHeight, initialElevator, type ElevatorState } from './elevator'
import { initialDoor, type DoorState } from './doors'
import { createTraffic, type Vehicle } from './traffic'
import type { Weather } from '../world/daycycle'
import type { Interactable } from './interact'
import type { Vec3 } from './collision'
import { HQ, SPAWN } from '../world/layout'
import { CAPYBARA_INITIAL_POSE, type CapybaraPose } from '../animals/capybara'
import { debugSpawnPosition } from './dev-view'
import { gameplayZoneAt, type GameplayZone } from './zone'

function initialPlayerPosition(): Vec3 {
  const defaultSpawn = { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z }
  if (!import.meta.env.DEV || typeof location === 'undefined') return defaultSpawn

  return debugSpawnPosition(location.search, import.meta.env.DEV) ?? defaultSpawn
}

const INITIAL_PLAYER_POSITION = initialPlayerPosition()
const INITIAL_ELEVATOR = initialElevator(
  INITIAL_PLAYER_POSITION.y >= HQ.y - 0.65 ? 'hq' : 'lobby',
)

export interface Runtime {
  elevator: ElevatorState
  entranceDoor: DoorState
  player: {
    pos: Vec3
    velocityY: number
    grounded: boolean
    /** Camera forward, horizontal plane, normalised. */
    forward: { x: number; z: number }
    /** Laser weapon state. */
    heat: number
    firing: boolean
    overheated: boolean
    aimPoint: Vec3 | null
  }
  /** What the player is currently looking at within range, if anything. */
  target: Interactable | null
  /** Interactables registered by the world this frame. */
  interactables: Interactable[]
  /** True while a modal (dialogue, menu) owns input. */
  paused: boolean
  /** Coarse physical zone shared by simulation, rendering and HUD. */
  zone: GameplayZone
  /** Increments on every transition into pause so held actions cannot resume. */
  pauseEpoch: number
  /** Camera mode. Toggled with V; first person is the default. */
  thirdPerson: boolean
  /** Keyboard state, populated by useKeys. */
  keys: {
    forward: boolean
    back: boolean
    left: boolean
    right: boolean
    sprint: boolean
    jump: boolean
  }
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
  /** Boulevard traffic. Length is set from the quality preset. */
  vehicles: Vehicle[]
  /** Shared hero-animal pose consumed by its mesh and moving collider. */
  capybara: CapybaraPose
  /** Destroyed breakable object IDs. */
  destroyed: Set<string>
  /** Objects the simulation moves directly, to keep visuals frame-exact. */
  refs: {
    car: Object3D | null
    carDoorLeft: Object3D | null
    carDoorRight: Object3D | null
    entranceLeft: Object3D | null
    entranceRight: Object3D | null
    /**
     * Traffic instance buffers. Written from the simulation loop rather than
     * from the component's own useFrame — with both at R3F's default
     * priority, ordering would otherwise fall out of React's mount order, and
     * the colliders would trail the visible cars by a frame.
     */
    trafficModels: Array<Object3D | null>
    trafficLamps: InstancedMesh | null
    trafficSpill: InstancedMesh | null
    capybara: Object3D | null
  }
  /**
   * Rolling perf samples.
   *
   * Draw calls and triangles are read from the renderer inside the frame loop,
   * not from a window handle: under StrictMode the global can end up pointing
   * at a disposed renderer that reports zero for everything, which makes the
   * overlay confidently lie about a scene that is plainly drawing.
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
  elevator: INITIAL_ELEVATOR,
  entranceDoor: initialDoor(),
  player: {
    pos: { ...INITIAL_PLAYER_POSITION },
    velocityY: 0,
    grounded: false,
    forward: { x: 0, z: -1 },
    heat: 0,
    firing: false,
    overheated: false,
    aimPoint: null,
  },
  target: null,
  interactables: [],
  // The HUD begins on the loading screen, so the world must not start moving
  // before App synchronises the first screen state.
  paused: true,
  zone: gameplayZoneAt(INITIAL_PLAYER_POSITION, carHeight(INITIAL_ELEVATOR)),
  pauseEpoch: 0,
  thirdPerson: false,
  keys: { forward: false, back: false, left: false, right: false, sprint: false, jump: false },
  clock: { elapsed: 0, hour: 0, weather: { rain: 0, wetness: 0 }, rainTarget: 0 },
  vehicles: [],
  capybara: { ...CAPYBARA_INITIAL_POSE },
  destroyed: new Set<string>(),
  refs: {
    car: null,
    carDoorLeft: null,
    carDoorRight: null,
    entranceLeft: null,
    entranceRight: null,
    trafficModels: [],
    trafficLamps: null,
    trafficSpill: null,
    capybara: null,
  },
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
 * Pausing clears every latched action immediately. Heat and cooldown are
 * intentionally preserved: they resume from the exact paused state instead
 * of silently cooling behind the menu.
 */
export function setRuntimePaused(paused: boolean): void {
  if (paused && !rt.paused) rt.pauseEpoch += 1
  rt.paused = paused
  if (!paused) return

  for (const key of Object.keys(rt.keys) as (keyof Runtime['keys'])[]) {
    rt.keys[key] = false
  }
  rt.player.firing = false
  rt.player.aimPoint = null
  rt.target = null
}

/** Advance and return the pause-aware simulation clock. */
export function advanceRuntimeTime(dt: number): number {
  if (rt.paused || !Number.isFinite(dt) || dt <= 0) return rt.clock.elapsed
  rt.clock.elapsed += dt
  return rt.clock.elapsed
}

/**
 * Resize the fleet when the quality preset changes.
 *
 * Rebuilt rather than trimmed so spacing stays even — a trimmed fleet leaves
 * a conspicuous empty stretch of road where the removed cars used to be.
 */
export function setTrafficCount(count: number): void {
  if (rt.vehicles.length === count) return
  rt.vehicles = createTraffic(count)
}

// Dev-only handle so the world can be driven and inspected from the console
// without pointer lock — which browsers refuse to grant to synthetic clicks,
// making automated verification of the route impossible otherwise. Stripped
// from production builds by the DEV guard.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __rt: Runtime }).__rt = rt
}
