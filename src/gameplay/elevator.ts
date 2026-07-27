/**
 * Elevator lifecycle as a total state machine.
 *
 * `step` is pure and total: every (state, event) pair returns a state. Pairs
 * that make no physical sense return the state unchanged rather than falling
 * through to a default that could, say, start travelling with the doors open.
 * The invariants this guarantees are asserted in elevator.test.ts.
 *
 * Kept hand-rolled rather than pulling in a statechart library: one machine
 * does not pay for the dependency, and a 6-state reducer with exhaustive tests
 * is easier to audit than a config object. Revisit at three or more machines.
 */

export const FLOORS = {
  lobby: { id: 'lobby', label: 'L', number: 0, y: 0 },
  hq: { id: 'hq', label: '45', number: 45, y: 180 },
} as const

export type FloorId = keyof typeof FLOORS

/** Seconds. Tuned so the ride reads as real travel without being tedious. */
export const DOOR_TIME = 1.6
export const TRAVEL_TIME = 7.0

export type ElevatorState =
  /** Parked, doors shut. */
  | { phase: 'idle'; floor: FloorId }
  /** Doors moving apart. `t` runs 0 → 1. */
  | { phase: 'opening'; floor: FloorId; t: number }
  /** Doors fully apart; safe to walk through. `hold` counts down. */
  | { phase: 'open'; floor: FloorId; hold: number }
  /** Doors coming together, committed to `target` once shut. */
  | { phase: 'closing'; floor: FloorId; target: FloorId; t: number }
  /** In the shaft. `t` runs 0 → 1 between `from` and `target`. */
  | { phase: 'travelling'; from: FloorId; target: FloorId; t: number }

export type ElevatorEvent =
  /** Panel button, or an external call. */
  | { type: 'CALL'; floor: FloorId }
  /** Player pressed the open-doors control, or stepped into the car. */
  | { type: 'OPEN' }
  /** Something is in the doorway. Must always win over closing. */
  | { type: 'OBSTRUCT' }
  | { type: 'TICK'; dt: number }

export const initialElevator = (floor: FloorId = 'lobby'): ElevatorState => ({
  phase: 'open',
  floor,
  hold: Infinity,
})

/** The floor the car is physically at, or null while in the shaft. */
export function currentFloor(s: ElevatorState): FloorId | null {
  return s.phase === 'travelling' ? null : s.floor
}

/** 0 = shut, 1 = fully open. The only thing the door meshes should read. */
export function doorOpenness(s: ElevatorState): number {
  switch (s.phase) {
    case 'open':
      return 1
    case 'opening':
      return clamp01(s.t)
    case 'closing':
      return 1 - clamp01(s.t)
    case 'idle':
    case 'travelling':
      return 0
  }
}

/** Car height in world units, interpolated while travelling. */
export function carHeight(s: ElevatorState): number {
  if (s.phase !== 'travelling') return FLOORS[s.floor].y
  const from = FLOORS[s.from].y
  const to = FLOORS[s.target].y
  return from + (to - from) * ease(clamp01(s.t))
}

export function step(s: ElevatorState, e: ElevatorEvent): ElevatorState {
  switch (s.phase) {
    case 'idle':
      if (e.type === 'CALL') {
        // Already here: just open up rather than pretending to travel.
        if (e.floor === s.floor) return { phase: 'opening', floor: s.floor, t: 0 }
        return { phase: 'travelling', from: s.floor, target: e.floor, t: 0 }
      }
      if (e.type === 'OPEN') return { phase: 'opening', floor: s.floor, t: 0 }
      return s

    case 'opening':
      if (e.type === 'TICK') {
        const t = s.t + e.dt / DOOR_TIME
        return t >= 1 ? { phase: 'open', floor: s.floor, hold: 4 } : { ...s, t }
      }
      // A call mid-open is remembered only once the doors are actually open;
      // committing here would let the car leave with doors ajar.
      return s

    case 'open':
      if (e.type === 'CALL') {
        if (e.floor === s.floor) return { ...s, hold: 4 } // re-hold, don't move
        return { phase: 'closing', floor: s.floor, target: e.floor, t: 0 }
      }
      if (e.type === 'OBSTRUCT' || e.type === 'OPEN') return { ...s, hold: 4 }
      if (e.type === 'TICK') {
        const next = { ...s, hold: Math.max(0, s.hold - e.dt) }
        return next.hold <= 0
          ? { phase: 'closing', floor: s.floor, target: s.floor, t: 0 }
          : next
      }
      return s

    case 'closing':
      // Obstruction always wins. This is the safety-critical edge.
      if (e.type === 'OBSTRUCT' || e.type === 'OPEN') {
        return { phase: 'opening', floor: s.floor, t: 1 - clamp01(s.t) }
      }
      if (e.type === 'CALL') return { ...s, target: e.floor } // retarget, keep closing
      if (e.type === 'TICK') {
        const t = s.t + e.dt / DOOR_TIME
        if (t < 1) return { ...s, t }
        // Doors are shut — only now is travel legal.
        return s.target === s.floor
          ? { phase: 'idle', floor: s.floor }
          : { phase: 'travelling', from: s.floor, target: s.target, t: 0 }
      }
      return s

    case 'travelling':
      // No event may open the doors mid-shaft. CALL is ignored rather than
      // retargeting, so the car cannot reverse past a floor it announced.
      if (e.type === 'TICK') {
        const t = s.t + e.dt / TRAVEL_TIME
        return t >= 1 ? { phase: 'opening', floor: s.target, t: 0 } : { ...s, t }
      }
      return s
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Smoothstep — an elevator that starts and stops abruptly feels broken. */
function ease(t: number): number {
  return t * t * (3 - 2 * t)
}
