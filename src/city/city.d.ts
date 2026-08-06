export declare class City {
  constructor(meta: Record<string, unknown>, coreBuffer: ArrayBuffer, text: Record<string, [string, string]>)
  meta: Record<string, unknown>
  text: Record<string, [string, string]>
  count: number
  static load(onProgress?: (what: string, frac?: number) => void): Promise<City>
  x(i: number): number
  y(i: number): number
  height(i: number): number
  archetypeIx(i: number): number
  districtIx(i: number): number
  tierIx(i: number): number
  flags(i: number): number
  year(i: number): number
  floors(i: number): number
  confidenceIx(i: number): number
  isPinned(i: number): boolean
  isContext(i: number): boolean
  archetype(i: number): string
  district(i: number): string
  confidence(i: number): string
  name(i: number): string
  address(i: number): string
  get(i: number): Record<string, unknown> | null
  nearest(wx: number, wz: number, maxDist?: number): number
}
export declare function toWorld(xM: number, yM: number, h?: number): [number, number, number]
export declare function fromWorld(wx: number, wz: number): [number, number]
