import type { Material, Texture } from 'three'

export declare class FacadeMaterial {
  constructor(city: unknown)
  city: unknown
  buildings: Texture
  palette: Texture
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
