import type { Material, Matrix4 } from 'three'

export declare const FLEET: ReadonlyArray<{
  key: string
  weight: number
  speedScale: number
}>

export declare const LOD0_DISTANCE: number
export declare const LOD1_DISTANCE: number

export declare function paintMaterial(): Material

export declare class VehicleFleet {
  constructor(scene: unknown)
  scene: unknown
  material: Material | null
  types: Array<Record<string, unknown>>
  ready: boolean
  quality: string
  load(capacity?: number): Promise<VehicleFleet>
  paintFor(type: Record<string, unknown>, seed: number): number
  pick(rand: number, taxiBias?: number): Record<string, unknown> | undefined
  reset(): void
  put(type: Record<string, unknown>, lod: number, matrix: Matrix4, paintHex: number, brake: number, heads: number, strobe: number, sign: number): number
  putWheel(type: Record<string, unknown>, matrix: Matrix4): void
  flush(): void
  readonly stats: { drawn: number; types: number }
}
