import type { Camera, Object3D } from 'three'

export declare class Crowd {
  constructor(scene: Object3D, city: unknown, demand?: unknown)
  scene: Object3D
  demand: unknown
  walkY: number
  types: Array<Record<string, unknown>>
  lanes: Array<Record<string, unknown>>
  people: Array<Record<string, unknown>>
  enabled: boolean
  ready: boolean
  clock: number
  stats: { lanes: number; people: number; simLanes: number; demand?: number }
  load(graphUrl?: string, glbUrl?: string): Promise<Crowd>
  update(dt: number, camera: Camera): void
}
