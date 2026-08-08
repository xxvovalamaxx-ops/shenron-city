export const LANE_W: number
export const MPH: number

export interface NavLane {
  id: number
  from: number
  to: number
  pts: Array<[number, number]>
  cum: number[]
  len: number
  speed: number
  kind: string
  name: string
  heading: number
  eid: number
  weight: number
  signalled: boolean
  axis: number
  laneW: number
  park: number | null
  queue: unknown[]
  next: number[]
}

export interface LaneGraph {
  lanes: NavLane[]
  nodeLanes: Map<number, number[]>
  grid: Map<string, number[]>
  nodes: Array<[number, number]>
}

export function hash1(n: number): number
export function buildLaneGraph(graph: Record<string, unknown>, demand?: unknown): LaneGraph
export function lanesNear(grid: Map<string, number[]>, xM: number, yM: number, radius: number): Set<number>
export function pointAt(lane: NavLane, s: number): [number, number, number]
export function projectLane(lane: NavLane, xM: number, yM: number): { s: number; dist: number; lateral: number }
export function nearestLane(
  grid: Map<string, number[]>,
  lanes: NavLane[],
  xM: number,
  yM: number,
  radius: number,
  parkable?: boolean,
): { laneId: number; s: number; dist: number } | null
export function routeNextLaneWith(lanes: NavLane[], lane: NavLane, seed: number): number
