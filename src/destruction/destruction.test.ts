import { describe, expect, it } from 'vitest'
import { BREAKABLES } from './BreakableRegistry'
import {
  createDestructionState,
  removeFragment,
  resetDestructionHealths,
  stepDestruction,
} from './destruction'

/** Aims at the centre of a breakable so the AABB pre-check passes. */
function aimAt(def: (typeof BREAKABLES)[number]) {
  return { x: def.pos.x, y: def.pos.y, z: def.pos.z }
}

describe('destruction simulation determinism', () => {
  it('destroys a prop in the same wall-clock time at 30, 60 and 120 fps', () => {
    const target = BREAKABLES[1] // plaza-supply-west, health 55
    const aim = aimAt(target)

    // 55 hp at 60 dps => ~0.9167 s. Simulate fixed-rate frames: the number
    // of frames differs, but the total simulated time to destroy must not.
    const times: number[] = []
    for (const fps of [30, 60, 120]) {
      const state = createDestructionState()
      const destroyed = new Set<string>()
      const dt = 1 / fps
      let elapsed = 0
      for (let frame = 0; frame < 10000 && !destroyed.has(target.id); frame++) {
        stepDestruction(state, { aim, dt, destroyed })
        elapsed += dt
      }
      times.push(elapsed)
    }

    // All three frame rates destroy the same prop at the same simulated
    // time, up to the unavoidable quantization of one frame: damage lands
    // in discrete dt slices, so the kill frame can differ by at most a
    // single frame at the lowest rate (0.0333 s at 30 fps).
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(1 / 30 + 1e-9)
    expect(times[0]).toBeGreaterThan(0.9)
    expect(times[0]).toBeLessThan(0.95)
  })

  it('produces identical state after irregular frame times across runs', () => {
    // Irregular but *fixed* frame sequence: two runs of the same sequence
    // must produce byte-identical outcomes (no RNG in the sim).
    const irregular = [0.033, 0.007, 0.05, 0.02, 0.001, 0.04, 0.012, 0.028, 0.066, 0.005]
    const run = () => {
      const state = createDestructionState()
      const destroyed = new Set<string>()
      for (const dt of irregular) {
        stepDestruction(state, { aim: aimAt(BREAKABLES[1]), dt, destroyed })
      }
      return {
        health: state.healths.get(BREAKABLES[1].id)!.current,
        destroyed: [...destroyed],
        fragments: state.fragments.length,
        scorches: state.scorches.length,
        revision: state.revision,
      }
    }

    expect(run()).toEqual(run())
  })

  it('does not damage anything when not firing (no aim point)', () => {
    const state = createDestructionState()
    const destroyed = new Set<string>()
    stepDestruction(state, { aim: null, dt: 1 / 60, destroyed })
    stepDestruction(state, { aim: null, dt: 60, destroyed })

    expect(destroyed.size).toBe(0)
    expect(state.revision).toBe(0)
    expect([...state.healths.values()].every((h) => h.current === h.max)).toBe(true)
  })

  it('ignores non-finite and non-positive dt', () => {
    const state = createDestructionState()
    const destroyed = new Set<string>()
    const aim = aimAt(BREAKABLES[0])
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      stepDestruction(state, { aim, dt: bad, destroyed })
    }
    expect([...state.healths.values()].every((h) => h.current === h.max)).toBe(true)
  })

  it('does not double-count when StrictMode re-invokes the step', () => {
    // The old component applied damage from a React state updater, which
    // StrictMode double-invokes in dev. The sim is a plain function; even a
    // simulated double call must apply the damage exactly once per call —
    // and this asserts the *behaviour* the component can no longer corrupt:
    // two steps with the same dt damage twice, and the health map is the
    // only authority.
    const state = createDestructionState()
    const destroyed = new Set<string>()
    const target = BREAKABLES[0] // lobby-security-desk, health 100
    const aim = aimAt(target)

    stepDestruction(state, { aim, dt: 1 / 60, destroyed })
    const afterOnce = state.healths.get(target.id)!.current
    stepDestruction(state, { aim, dt: 1 / 60, destroyed })
    const afterTwice = state.healths.get(target.id)!.current

    // 100 - 60*(1/60) = 99 after one step; 98 after two. Exact, no drift.
    expect(afterOnce).toBeCloseTo(99, 10)
    expect(afterTwice).toBeCloseTo(98, 10)
    expect(destroyed.size).toBe(0)
  })

  it('spawns exactly one fragment set and one scorch per destruction', () => {
    const state = createDestructionState()
    const destroyed = new Set<string>()
    const target = BREAKABLES[1]
    const aim = aimAt(target)
    const fragsPerTarget = target.fragments ?? 5

    // 55 hp / 60 dps = 0.9167 s => 55 steps at 60 fps, then it breaks.
    for (let i = 0; i < 60; i++) {
      stepDestruction(state, { aim, dt: 1 / 60, destroyed })
    }

    expect(destroyed.has(target.id)).toBe(true)
    expect(state.fragments).toHaveLength(fragsPerTarget)
    expect(state.scorches).toHaveLength(1)
    // Ids are unique across both pools.
    const ids = [...state.fragments, ...state.scorches].map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('caps the scorch pool at the max and keeps fragment expiry idempotent', () => {
    const state = createDestructionState()
    const destroyed = new Set<string>()

    // Destroy every breakable in sequence.
    for (const def of BREAKABLES) {
      for (let i = 0; i < 200; i++) {
        stepDestruction(state, { aim: aimAt(def), dt: 1 / 60, destroyed })
      }
    }

    expect(destroyed.size).toBe(BREAKABLES.length)
    expect(state.scorches.length).toBeLessThanOrEqual(20)
    expect(state.fragments.length).toBe(
      BREAKABLES.reduce((n, d) => n + (d.fragments ?? 5), 0),
    )

    // Removing an already-removed fragment is a no-op that does not bump
    // the revision (the presentation layer may double-call on unmount).
    const before = state.revision
    removeFragment(state, 'frag-does-not-exist')
    expect(state.revision).toBe(before)

    const live = state.fragments[0].id
    removeFragment(state, live)
    expect(state.fragments.some((f) => f.id === live)).toBe(false)
    expect(state.revision).toBe(before + 1)
  })

  it('resetDestructionHealths rebuilds from a persisted destroyed set', () => {
    const state = createDestructionState()
    const destroyed = new Set([BREAKABLES[2].id, BREAKABLES[4].id])
    resetDestructionHealths(state, destroyed)

    for (const def of BREAKABLES) {
      const h = state.healths.get(def.id)!
      expect(h.current).toBe(destroyed.has(def.id) ? 0 : h.max)
    }
    // Resetting twice is idempotent w.r.t. the same destroyed set.
    resetDestructionHealths(state, destroyed)
    expect(state.healths.get(BREAKABLES[2].id)!.current).toBe(0)
  })

  it('reload persistence: sim, snapshot, reload produces the same world', () => {
    const state = createDestructionState()
    const destroyed = new Set<string>()
    const target = BREAKABLES[3] // market-supply-tea, health 55
    // 60 frames at 60 dps = exactly 55 hp => destroyed on frame 55.
    for (let i = 0; i < 60; i++) {
      stepDestruction(state, { aim: aimAt(target), dt: 1 / 60, destroyed })
    }
    expect(destroyed.has(target.id)).toBe(true)

    // Snapshot exactly what the save file would carry.
    const persisted = [...destroyed]

    // Reload: fresh state, destroyed set restored from the save.
    const reloadedState = createDestructionState()
    const reloadedDestroyed = new Set(persisted)
    resetDestructionHealths(reloadedState, reloadedDestroyed)

    expect(reloadedDestroyed.has(target.id)).toBe(true)
    expect(reloadedState.healths.get(target.id)!.current).toBe(0)
    expect([...reloadedState.healths.values()].every((h) => h.current === h.max || h.current === 0)).toBe(true)

    // The surviving prop is still damageable after reload.
    const survivor = BREAKABLES[0]
    const aim = aimAt(survivor)
    stepDestruction(reloadedState, { aim, dt: 1 / 60, destroyed: reloadedDestroyed })
    expect(reloadedState.healths.get(survivor.id)!.current).toBeCloseTo(99, 10)
  })
})
