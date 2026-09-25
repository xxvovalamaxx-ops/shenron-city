import type { DataTexture, Material } from 'three'

export declare const FACADE_FRAG_HEAD: string
export declare const FACADE_FRAG_BODY: string

export declare class FacadeMaterial {
  /** `city` is the runtime payload (City), or null for id-hashed families. */
  constructor(city: unknown)
  city: unknown
  buildings: DataTexture
  geometry: DataTexture
  palette: DataTexture
  uniforms: Record<string, { value: unknown }>
  material: Material
  shader: Record<string, unknown> | null
  setNight(v: number): void
  setDetail(v: number): void
  suppress(bids: Array<number>): number
  isSuppressed(bid: number): boolean
  hitSuppressed(hit: unknown): boolean
  unsuppress(): number
  dispose(): void
}
