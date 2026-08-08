export declare const STOP_LINE: number
export declare const SIGNAL_CYCLE: number
export declare const SIGNAL_GREEN: number
export declare const SIGNAL_AMBER: number

export interface NavLaneLike {
  id: number
  to: number
  heading: number
  signalled: boolean
  axis: number
}

export interface IntersectionRecord {
  node: number
  x: number
  y: number
  approaches: number[]
  stopLine: number
  boxRadius: number
  conflicts: Array<[number, number]>
  program: { cycle: number; green: number; amber: number; offset: number }
}

export declare function buildIntersections(
  nodes: Array<[number, number]> | null,
  lanes: NavLaneLike[],
  nodeLanes: Map<number, number[]> | null,
): { list: IntersectionRecord[]; byNode: Map<number, IntersectionRecord> }

export declare function signalColorAt(
  ix: IntersectionRecord | null,
  axis: number,
  clock: number,
): 'green' | 'amber' | 'red'

export declare function classifyTurn(
  inHeading: number,
  outHeading: number,
): 'straight' | 'left' | 'right' | 'uturn'
