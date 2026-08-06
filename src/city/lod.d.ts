import type { Camera, Object3D } from 'three'

export declare const FULL_R: number
export declare const L2_R: number
export declare const L3_R: number

export declare class LodLayer {
  constructor(scene: Object3D)
  scene: Object3D
  manifest: Record<string, unknown> | null
  tiles: Map<string, Record<string, unknown>>
  inflight: number
  enabled: boolean
  ready: boolean
  stats: Record<string, number>
  load(url?: string): Promise<LodLayer>
  update(camera: Camera, streamer?: unknown): Record<string, number>
  setDisabled(off: boolean): void
}
