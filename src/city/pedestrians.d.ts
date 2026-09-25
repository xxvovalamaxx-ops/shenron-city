import type { Camera, Object3D } from 'three'
import type { CrowdRenderer } from '../world/life/crowd-renderer'

export declare class Crowd {
  constructor(scene: Object3D, city: unknown, demand?: unknown)
  scene: Object3D
  demand: unknown
  walkY: number
  renderer: CrowdRenderer
  lanes: Array<Record<string, unknown>>
  people: Array<Record<string, unknown>>
  enabled: boolean
  ready: boolean
  clock: number
  stats: {
    lanes: number
    people: number
    simLanes: number
    standing: number
    fleeing: number
    demand?: number
  }
  load(graphUrl?: string): Promise<Crowd>
  update(dt: number, camera: Camera): void
  /** World-space (x, z) pairs of every simulated pedestrian; valid until the next update. */
  positions(): { count: number; xz: Float32Array }
  dispose(): void
}
