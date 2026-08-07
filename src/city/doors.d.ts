import type { Camera, Mesh, Object3D } from 'three'
import type { Interiors, Room } from './interiors.js'
import type { HQ } from './hq.js'
import type { TileStreamer } from './streamer.js'

/** One configured doorway, from data/doors.json plus everything the cut measured. */
export interface Door {
  key: string
  /** Building id in the merged tile mesh's _BID attribute. */
  bid: number
  kind: 'wall' | 'recess' | 'entrance'
  room: Room
  /** True once a real opening exists in the tile geometry. */
  cut: boolean
  near: boolean
  state: 'closed' | 'opening' | 'open' | 'closing'
  mesh?: Mesh
  [extra: string]: unknown
}

export declare class Doors {
  constructor(
    scene: Object3D,
    city: unknown,
    interiors: Interiors,
    hq: HQ | null,
    corridor: unknown | null,
    streamer: TileStreamer,
  )
  doors: Door[]
  ready: boolean
  /** False while something else owns the camera. */
  active: boolean
  paused: boolean
  stats: { doors: number; cut: number; open: number; state: string }
  /**
   * Called with a mesh whose geometry was just replaced by a cut. Hosts that
   * keep their own spatial index (a BVH per building mesh) must rebuild it
   * here, or the opening renders without becoming walkable.
   */
  onGeometryChanged: ((mesh: Mesh) => void) | null
  setAudio(audio: unknown): void
  load(url?: string): Promise<Doors>
  bind(camera: Camera, controls: unknown): void
  update(dt: number, camera: Camera): void
  /** Door leaves and frames, for hosts that raycast the scene graph. */
  pickables(): Object3D[]
  /** 0..1 indoor mix for audio and post, from the camera's position. */
  indoorBlend(camera: Camera): number
  rideLift(link: unknown, camera: Camera, controls: unknown): boolean
  verify(): Promise<Record<string, unknown>>
}
