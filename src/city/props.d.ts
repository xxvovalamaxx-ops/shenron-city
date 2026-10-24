import type { Camera, Object3D } from 'three'
import type { TreeField } from '../world/life/tree-field'

export declare class StaticProps {
  constructor(scene: Object3D, city: unknown)
  scene: Object3D
  groundY: number
  meshes: Map<string, unknown>
  records: DataView | null
  count: number
  enabled: boolean
  /** Street trees and the park forest (world/life/tree-field.ts). */
  trees: TreeField
  stats: { total: number; drawn: number; types: number; trees: number }
  load(metaUrl?: string, binUrl?: string, glbUrl?: string): Promise<StaticProps>
  update(camera: Camera, force?: boolean): { total: number; drawn: number; types: number; trees: number }
  pickables(): Array<unknown>
  dispose(): void
  readonly saturation: Record<string, string>
}
