import { describe, expect, it } from 'vitest'
import {
  DOOR_TIME,
  TRAVEL_TIME,
  carHeight,
  currentFloor,
  doorOpenness,
  FLOORS,
  initialElevator,
  step,
  type ElevatorEvent,
  type ElevatorState,
} from './elevator'

const tick = (dt: number): ElevatorEvent => ({ type: 'TICK', dt })

function run(s: ElevatorState, events: ElevatorEvent[]): ElevatorState {
  return events.reduce(step, s)
}

/** Advance simulated time in small steps, asserting an invariant every frame. */
function simulate(
  s: ElevatorState,
  seconds: number,
  invariant?: (s: ElevatorState) => void,
): ElevatorState {
  const dt = 1 / 60
  let cur = s
  for (let t = 0; t < seconds; t += dt) {
    cur = step(cur, tick(dt))
    invariant?.(cur)
  }
  return cur
}

describe('elevator invariants', () => {
  it('never travels with the doors even slightly open', () => {
    let s = initialElevator('lobby')
    s = step(s, { type: 'CALL', floor: 'hq' })
    simulate(s, TRAVEL_TIME + DOOR_TIME * 3, (cur) => {
      if (cur.phase === 'travelling') {
        expect(doorOpenness(cur)).toBe(0)
      }
    })
  })

  it('door openness stays within [0,1] across a full cycle', () => {
    let s = initialElevator('lobby')
    s = step(s, { type: 'CALL', floor: 'hq' })
    simulate(s, TRAVEL_TIME + DOOR_TIME * 4, (cur) => {
      const o = doorOpenness(cur)
      expect(o).toBeGreaterThanOrEqual(0)
      expect(o).toBeLessThanOrEqual(1)
    })
  })

  it('arrives at the floor that was requested, and opens there', () => {
    let s = initialElevator('lobby')
    s = step(s, { type: 'CALL', floor: 'hq' })
    s = simulate(s, DOOR_TIME + TRAVEL_TIME + DOOR_TIME + 1)
    expect(currentFloor(s)).toBe('hq')
    expect(doorOpenness(s)).toBe(1)
  })

  it('car height is monotonic during a ride and lands exactly on the floor', () => {
    let s = initialElevator('lobby')
    s = step(s, { type: 'CALL', floor: 'hq' })
    let last = -Infinity
    s = simulate(s, DOOR_TIME + TRAVEL_TIME + 0.5, (cur) => {
      const h = carHeight(cur)
      expect(h).toBeGreaterThanOrEqual(last - 1e-6)
      last = h
    })
    expect(carHeight(s)).toBeCloseTo(FLOORS.hq.y, 5)
  })
})

describe('door safety', () => {
  it('reopens when obstructed while closing', () => {
    let s = initialElevator('lobby')
    s = step(s, { type: 'CALL', floor: 'hq' })
    s = step(s, tick(DOOR_TIME * 0.5)) // half shut
    expect(s.phase).toBe('closing')

    s = step(s, { type: 'OBSTRUCT' })
    expect(s.phase).toBe('opening')

    // And it actually finishes opening rather than sticking.
    s = simulate(s, DOOR_TIME + 0.2)
    expect(doorOpenness(s)).toBe(1)
  })

  it('an obstruction at the last instant still cancels the trip', () => {
    let s = initialElevator('lobby')
    s = step(s, { type: 'CALL', floor: 'hq' })
    s = step(s, tick(DOOR_TIME * 0.98))
    s = step(s, { type: 'OBSTRUCT' })
    s = simulate(s, DOOR_TIME + 1)
    expect(currentFloor(s)).toBe('lobby')
  })
})

describe('total transition function', () => {
  it('returns a valid state for every event in every phase', () => {
    const phases: ElevatorState[] = [
      { phase: 'idle', floor: 'lobby' },
      { phase: 'opening', floor: 'lobby', t: 0.4 },
      { phase: 'open', floor: 'lobby', hold: 2 },
      { phase: 'closing', floor: 'lobby', target: 'hq', t: 0.4 },
      { phase: 'travelling', from: 'lobby', target: 'hq', t: 0.4 },
    ]
    const events: ElevatorEvent[] = [
      { type: 'CALL', floor: 'hq' },
      { type: 'CALL', floor: 'lobby' },
      { type: 'OPEN' },
      { type: 'OBSTRUCT' },
      tick(0.016),
    ]

    for (const p of phases) {
      for (const e of events) {
        const next = step(p, e)
        expect(next).toBeDefined()
        expect(['idle', 'opening', 'open', 'closing', 'travelling']).toContain(next.phase)
        // The impossible state, asserted directly.
        if (next.phase === 'travelling') expect(doorOpenness(next)).toBe(0)
      }
    }
  })

  it('ignores calls while in the shaft so the car cannot reverse mid-flight', () => {
    const mid: ElevatorState = { phase: 'travelling', from: 'lobby', target: 'hq', t: 0.5 }
    const after = run(mid, [{ type: 'CALL', floor: 'lobby' }, { type: 'OPEN' }])
    expect(after).toEqual(mid)
  })

  it('calling the floor it is already on opens rather than travels', () => {
    const s = step({ phase: 'idle', floor: 'hq' }, { type: 'CALL', floor: 'hq' })
    expect(s.phase).toBe('opening')
    expect(currentFloor(s)).toBe('hq')
  })
})
