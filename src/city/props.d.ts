import type { Camera, Object3D } from 'three'

export declare class StaticProps {
  constructor(scene: Object3D, city: unknown)
  scene: Object3D
  groundY: number
  meshes: Map<string, unknown>
  records: DataView | null
  count: number
  enabled: boolean
  stats: { total: number; drawn: number; types: number }
  load(metaUrl?: string, binUrl?: string, glbUrl?: string): Promise<StaticProps>
  update(camera: Camera, force?: boolean): { total: number; drawn: number; types: number }
  pickables(): Array<unknown>
  readonly saturation: Record<string, string>
}
