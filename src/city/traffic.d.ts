import type { Camera, Object3D } from 'three'
import type { NavLane } from './street-nav'
import type { IntersectionRecord } from './intersections'

export declare class Traffic {
  constructor(scene: Object3D, city: unknown, demand?: unknown)
  scene: Object3D
  city: unknown
  demand: unknown
  groundY: number
  roadY: number
  fleet: unknown
  lanes: NavLane[]
  nodeLanes: Map<number, number[]>
  grid: Map<string, number[]>
  nodes: Array<[number, number]>
  ixByNode: Map<number, IntersectionRecord>
  vehicles: Array<Record<string, unknown>>
  ghosts: Array<{ lane: number; s: number; v: number; length: number; ghost: boolean }>
  enabled: boolean
  maxVehicles: number
  stats: { lanes: number; vehicles: number; simLanes: number }
  load(graphUrl?: string): Promise<Traffic>
  setGhosts(list: Array<{ lane: number; s: number; v: number; length: number; ghost: boolean }>): void
  update(dt: number, camera: Camera): void
}
