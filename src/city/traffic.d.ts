import type { Camera, Object3D } from 'three'

export declare class Traffic {
  constructor(scene: Object3D, city: unknown, demand?: unknown)
  scene: Object3D
  city: unknown
  demand: unknown
  groundY: number
  roadY: number
  fleet: unknown
  lanes: Array<Record<string, unknown>>
  vehicles: Array<Record<string, unknown>>
  enabled: boolean
  maxVehicles: number
  stats: { lanes: number; vehicles: number; simLanes: number }
  load(graphUrl?: string): Promise<Traffic>
  update(dt: number, camera: Camera): void
}
