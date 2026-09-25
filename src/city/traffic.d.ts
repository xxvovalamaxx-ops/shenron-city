import type { Camera, Object3D } from 'three'
import type { TrafficCarView } from '../gameplay/vehicles/vehicle-world-link'
import type { TrafficObstacle } from '../gameplay/vehicles/traffic-bridge'

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
  stats: { lanes: number; vehicles: number; simLanes: number; knocked: number }
  load(graphUrl?: string): Promise<Traffic>
  update(dt: number, camera: Camera): void
  /** Bodies traffic must not drive through (world coordinates), replaced every frame. */
  setObstacles(list: ReadonlyArray<TrafficObstacle>): void
  /** Cars within `radius` of a world point, as session views. */
  queryNear(x: number, z: number, radius: number, out?: TrafficCarView[]): TrafficCarView[]
  /** Remove a car for a carjack. */
  claim(id: number): { kind: string; paint: number } | null
  /** Free a car from its lane after a collision. */
  knock(id: number, view: Pick<TrafficCarView, 'x' | 'z' | 'heading' | 'vx' | 'vz' | 'yawRate'>): void
  /** A kerb-side parking spot near a world point (the starter car). */
  parkingSpotNear(x: number, z: number, radius?: number): { x: number; z: number; heading: number } | null
}
