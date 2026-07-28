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
import { initialElevator, type ElevatorState } from './elevator'
import { initialDoor, type DoorState } from './doors'
import { createTraffic, type Vehicle } from './traffic'
import type { Interactable } from './interact'
import type { Vec3 } from './collision'
import { SPAWN } from '../world/layout'
import { MARKET_KEEPER } from '../world/city-data'

function initialPlayerPosition(): Vec3 {
  const defaultSpawn = { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z }
  if (!import.meta.env.DEV || typeof location === 'undefined') return defaultSpawn

  // A bounded developer shortcut for browser verification. This is compiled
  // out of production and accepts named in-world anchors, never coordinates.
  const debugSpawn = new URLSearchParams(location.search).get('spawn')
  if (debugSpawn === 'market') {
    return { x: MARKET_KEEPER.x, y: SPAWN.y, z: MARKET_KEEPER.z + 2.7 }
  }
  return defaultSpawn
}

export interface Runtime {
  elevator: ElevatorState
  entranceDoor: DoorState
  player: {
    pos: Vec3
    velocityY: number
    grounded: boolean
    /** Camera forward, horizontal plane, normalised. */
    forward: { x: number; z: number }
  }
  /** What the player is currently looking at within range, if anything. */
  target: Interactable | null
  /** Interactables registered by the world this frame. */
  interactables: Interactable[]
  /** True while a modal (dialogue, menu) owns input. */
  paused: boolean
  /** Boulevard traffic. Length is set from the quality preset. */
  vehicles: Vehicle[]
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
    trafficBody: InstancedMesh | null
    trafficCabin: InstancedMesh | null
    trafficLamps: InstancedMesh | null
    trafficSpill: InstancedMesh | null
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
    frameMs: number
    calls: number
    triangles: number
    geometries: number
    programs: number
  }
}

export const rt: Runtime = {
  elevator: initialElevator('lobby'),
  entranceDoor: initialDoor(),
  player: {
    pos: initialPlayerPosition(),
    velocityY: 0,
    grounded: false,
    forward: { x: 0, z: -1 },
  },
  target: null,
  interactables: [],
  paused: false,
  vehicles: [],
  refs: {
    car: null,
    carDoorLeft: null,
    carDoorRight: null,
    entranceLeft: null,
    entranceRight: null,
    trafficBody: null,
    trafficCabin: null,
    trafficLamps: null,
    trafficSpill: null,
  },
  perf: {
    frames: 0,
    accum: 0,
    fps: 0,
    frameMs: 0,
    calls: 0,
    triangles: 0,
    geometries: 0,
    programs: 0,
  },
}

export function resetPlayer(): void {
  rt.player.pos = initialPlayerPosition()
  rt.player.velocityY = 0
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
