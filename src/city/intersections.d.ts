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
  headings: number[]
  stopLine: number
  boxRadius: number
  conflicts: Array<[number, number]>
  program: { cycle: number; green: number; amber: number; offset: number }
}

/** A bare signal program, as baked onto a Phase 3A lane. */
export interface SignalProgram {
  cycle: number
  green: number
  amber: number
  offset: number
}

/** Anything the phase functions can read a program from. */
export type SignalSource = IntersectionRecord | { program: SignalProgram }

export declare function buildIntersections(
  nodes: Array<[number, number]> | null,
  lanes: NavLaneLike[],
  nodeLanes: Map<number, number[]> | null,
): { list: IntersectionRecord[]; byNode: Map<number, IntersectionRecord> }

export declare function signalColorAt(
  ix: SignalSource | null,
  axis: number,
  clock: number,
): 'green' | 'amber' | 'red'

export declare function signalPhase(
  ix: SignalSource | null,
  axis: number,
  clock: number,
): 'green' | 'amber' | 'red'

export declare function stopLineTarget(
  speed: number,
  toStop: number,
  brakeDecel: number,
  gap?: number,
): number | null

export declare function amberMayContinue(
  toStop: number,
  speed: number,
  brakeDecel: number,
): boolean

export declare function conflictsFor(
  ix: IntersectionRecord,
  approachIndex: number,
  willTurnLeft: boolean,
): number[]

export declare function classifyTurn(
  inHeading: number,
  outHeading: number,
): 'straight' | 'left' | 'right' | 'uturn'
