import type { Camera, Object3D } from 'three'

export declare class Subway {
  constructor(scene: Object3D, city: unknown)
  scene: Object3D
  groundY: number
  entrances: Array<Record<string, unknown>>
  meshes: Map<string, unknown>
  stats: { total: number; drawn: number; stations: number }
  enabled: boolean
  footfall: Record<string, unknown> | null
  load(dataUrl?: string, footUrl?: string, glbUrl?: string): Promise<Subway>
  footfallAt(xM: number, yM: number): number
  update(camera: Camera): { total: number; drawn: number; stations: number }
}
