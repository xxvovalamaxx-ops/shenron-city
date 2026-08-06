export declare class Demand {
  day: Record<string, number> | null
  eve: Record<string, number> | null
  cell: number
  vol: Record<string, [number, number]> | null
  maxVph: number
  refVph: number
  evening: boolean
  ready: boolean
  subway: unknown
  load(
    pedUrl?: string,
    vehUrl?: string,
  ): Promise<Demand>
  ped(xM: number, yM: number): number
  pedSmooth(xM: number, yM: number): number
  setSubway(subway: unknown): void
  vph(edgeId: string | number): number
  measured(edgeId: string | number): boolean
  vehNorm(edgeId: string | number): number
}
