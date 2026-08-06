import type { Material } from 'three'

export declare const FLEET: ReadonlyArray<{
  name: string
  key: string
  weight: number
  speedScale: number
  color?: number
  fixedColor?: boolean
}>

export declare function paintMaterial(): Material

export declare class VehicleFleet {
  constructor(scene: unknown)
  scene: unknown
  material: Material
  types: Array<Record<string, unknown>>
  ready: boolean
  load(url?: string, capacity?: number): Promise<VehicleFleet>
  colorFor(type: Record<string, unknown>, seed: number): unknown
  pick(rand: number): Record<string, unknown> | undefined
  reset(): void
  flush(): void
  readonly stats: { drawn: number; types: number }
}
