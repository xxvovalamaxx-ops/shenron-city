import type { Camera, Object3D } from 'three'
import type { Material } from 'three'

export declare class TileStreamer {
  constructor(scene: Object3D, meta: Record<string, unknown>, material?: Material | null, layer?: 'world' | 'streets')
  scene: Object3D
  meta: Record<string, unknown>
  layer: 'world' | 'streets'
  injected: Material | null
  cfg: { list?: Array<Record<string, unknown>>; size_m?: number; far_m?: number }
  tileSize: number
  far: number
  unload: number
  tiles: Map<string, {
    file: string
    state: 'idle' | 'loading' | 'ready' | 'error'
    group: import('three').Group | null
    bytes: number
    always: boolean
    v: number
    cx: number
    cz: number
    buildingsVisible: boolean
    tris?: number
  }>
  byKey: Map<string, { file: string }>
  inflight: number
  loadedBytes: number
  stats: { resident: number; loading: number; queued: number; tris: number; bytes: number }
  loader: unknown
  plainMaterial: Material
  fallbackMaterial: Material
  readonly tileCount: number
  totalBytes(): number
  setBuildingsVisible(key: string, on: boolean): void
  update(camera: Camera): { resident: number; loading: number; queued: number; tris: number; bytes: number }
  preload(camera: Camera, onProgress?: (frac: number, file: string) => void): Promise<void>
  pickables(): Array<unknown>
}
