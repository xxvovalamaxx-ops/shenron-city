import type { Group, Object3D } from 'three'
import type { Interiors, Room } from './interiors.js'
import type { FacadeMaterial } from './facade.js'

export declare class HQ {
  constructor(scene: Object3D, city: unknown, interiors: Interiors, facade: FacadeMaterial)
  scene: Object3D
  interiors: Interiors
  groundY: number
  /** The placed tower, or null when the GLB or the site record is missing. */
  tower: Group | null
  site: Record<string, unknown> | null
  /** The rooms it registers with interiors, by key (home_lobby, hq_lobby, …). */
  rooms: Record<string, Room>
  stats: { placed: boolean; suppressed: number; floor45_m: number; site: unknown }
  load(url?: string, siteUrl?: string, specUrl?: string): Promise<HQ>
}
