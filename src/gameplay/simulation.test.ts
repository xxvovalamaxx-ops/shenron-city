import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Simulation, SIM_STAGES, MAX_STEP_SECONDS, type SimStage } from './simulation'

/** Record the order systems ran in, across a whole frame. */
function tracer() {
  const calls: string[] = []
  const make = (id: string) => () => {
    calls.push(id)
  }
  return { calls, make }
}

describe('Simulation — ordering', () => {
  let sim: Simulation
  beforeEach(() => {
    sim = new Simulation()
  })

  it('runs stages in the declared order, whatever order systems registered in', () => {
    // What this replaces: order came from R3F render priorities plus, for the
    // nine callbacks at the default priority, mount order in the JSX. That
    // order happens to be correct today and is untested, undeclared, and
    // changed by moving a line in App.tsx.
    const { calls, make } = tracer()
    sim.register('city', 'city', make('city'))
    sim.register('input', 'input', make('input'))
    sim.register('present', 'presentation', make('present'))
    sim.register('vehicles', 'vehicles', make('vehicles'))
    sim.register('clock', 'clock', make('clock'))

    sim.step(1 / 60)
    expect(calls).toEqual(['input', 'clock', 'vehicles', 'city', 'present'])
  })

  it('preserves registration order within a stage', () => {
    const { calls, make } = tracer()
    sim.register('a', 'city', make('a'))
    sim.register('b', 'city', make('b'))
    sim.register('c', 'city', make('c'))
    sim.step(1 / 60)
    expect(calls).toEqual(['a', 'b', 'c'])
  })

  it('vehicles run before city, because the city streams toward the player', () => {
    expect(SIM_STAGES.indexOf('vehicles')).toBeLessThan(SIM_STAGES.indexOf('city'))
    expect(SIM_STAGES.indexOf('input')).toBeLessThan(SIM_STAGES.indexOf('clock'))
  })
})

describe('Simulation — one delta', () => {
  let sim: Simulation
  beforeEach(() => {
    sim = new Simulation()
  })

  it('hands every system the same clamped dt', () => {
    const seen: number[] = []
    for (const stage of ['clock', 'vehicles', 'city'] as SimStage[]) {
      sim.register(stage, stage, (f) => seen.push(f.dt))
    }
    // A 2-second hitch — a tab returning from the background.
    sim.step(2)
    expect(seen).toHaveLength(3)
    expect(new Set(seen).size).toBe(1)
    expect(seen[0]).toBe(MAX_STEP_SECONDS)
  })

  it('passes short frames through unclamped', () => {
    let dt = -1
    sim.register('x', 'city', (f) => {
      dt = f.dt
    })
    sim.step(1 / 120)
    expect(dt).toBeCloseTo(1 / 120, 10)
  })

  it('treats a non-finite or negative delta as no time passing', () => {
    const seen: number[] = []
    sim.register('x', 'city', (f) => seen.push(f.dt))
    sim.step(Number.NaN)
    sim.step(-5)
    sim.step(Number.POSITIVE_INFINITY)
    // Infinity is finite-checked, so it clamps to 0 rather than to MAX_STEP.
    expect(seen).toEqual([0, 0, 0])
  })

  it('still exposes the unclamped delta for presentation', () => {
    let raw = -1
    sim.register('p', 'presentation', (f) => {
      raw = f.rawDt
    })
    sim.step(2)
    expect(raw).toBe(2)
  })
})

describe('Simulation — one pause', () => {
  let sim: Simulation
  beforeEach(() => {
    sim = new Simulation()
  })

  it('a pause taken during input zeroes the delta for the same frame', () => {
    // The property that makes a single pause state worth having, stated as
    // arithmetic rather than left to depend on render priorities: the input
    // stage flips pause and every stage after it in the SAME frame already
    // sees dt 0. Today the -100 priority on GameLoop gets this right by hand;
    // here it is a guarantee of the ordering itself.
    const seen: Array<[string, number]> = []
    sim.register('input', 'input', () => {
      sim.setPaused(true)
    })
    sim.register('city', 'city', (f) => seen.push(['city', f.dt]))
    sim.register('vehicles', 'vehicles', (f) => seen.push(['vehicles', f.dt]))
    sim.register('present', 'presentation', (f) => seen.push(['present', f.dt]))

    const frame = sim.step(1 / 60)
    expect(seen).toEqual([
      ['vehicles', 0],
      ['city', 0],
      ['present', 0],
    ])
    expect(frame.paused).toBe(true)
    expect(frame.dt).toBe(0)
  })

  it('an unpause taken during input resumes the same frame', () => {
    sim.setPaused(true)
    let dt = -1
    sim.register('input', 'input', () => {
      sim.setPaused(false)
    })
    sim.register('city', 'city', (f) => {
      dt = f.dt
    })
    sim.step(1 / 60)
    expect(dt).toBeCloseTo(1 / 60, 10)
  })

  it('pausing zeroes the delta, it does not skip stages', () => {
    // Load-bearing, and the reason the first design was wrong. The city
    // pipeline must keep being called while paused so its tile streamers
    // converge on the loaded set behind the pause menu — skipping the stage
    // would freeze streaming whenever the player opened settings.
    sim.setPaused(true)
    let cityCalls = 0
    let cityDt = -1
    let presentCalls = 0
    sim.register('city', 'city', (f) => {
      cityCalls++
      cityDt = f.dt
    })
    sim.register('present', 'presentation', () => {
      presentCalls++
    })
    sim.step(1 / 60)
    sim.step(1 / 60)
    expect(cityCalls).toBe(2)
    expect(presentCalls).toBe(2)
    expect(cityDt).toBe(0)
  })

  it('tells a system it is a paused frame, for anything that must hard-stop', () => {
    // dt 0 freezes anything that integrates. A system doing dt-independent
    // work — spawning, decisions, audio triggers — reads this instead.
    sim.setPaused(true)
    let paused: boolean | null = null
    let raw = -1
    sim.register('x', 'city', (f) => {
      paused = f.paused
      raw = f.rawDt
    })
    sim.step(1 / 60)
    expect(paused).toBe(true)
    // Real time is still available for anything that legitimately wants it.
    expect(raw).toBeCloseTo(1 / 60, 10)
  })
})

describe('Simulation — registration hygiene', () => {
  let sim: Simulation
  beforeEach(() => {
    sim = new Simulation()
  })

  it('re-registering an id replaces it instead of stepping the world twice', () => {
    // React strict mode and hot reload both mount effects twice. An append
    // would double-step the city, which presents as the world running at 2x
    // and nothing else — no error, no warning.
    let a = 0
    let b = 0
    sim.register('city', 'city', () => {
      a++
    })
    sim.register('city', 'city', () => {
      b++
    })
    sim.step(1 / 60)
    expect(a).toBe(0)
    expect(b).toBe(1)
    expect(sim.stats().systems.city).toEqual(['city'])
  })

  it('re-registering into a different stage moves it rather than duplicating', () => {
    sim.register('x', 'city', () => {})
    sim.register('x', 'vehicles', () => {})
    const s = sim.stats()
    expect(s.systems.city).toEqual([])
    expect(s.systems.vehicles).toEqual(['x'])
  })

  it('returns a disposer that unregisters exactly once', () => {
    let n = 0
    const off = sim.register('x', 'city', () => {
      n++
    })
    sim.step(1 / 60)
    off()
    sim.step(1 / 60)
    expect(n).toBe(1)
    expect(sim.unregister('x')).toBe(false)
  })

  it('rejects an unknown stage loudly', () => {
    expect(() => sim.register('x', 'nope' as SimStage, () => {})).toThrow(/unknown stage/)
  })
})

describe('Simulation — a broken system does not take the frame down', () => {
  let sim: Simulation
  beforeEach(() => {
    sim = new Simulation()
  })

  it('keeps running later systems and later stages, and names the failure', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ran: string[] = []
    sim.register('ok-before', 'city', () => ran.push('ok-before'))
    sim.register('boom', 'city', () => {
      throw new Error('kaboom')
    })
    sim.register('ok-after', 'city', () => ran.push('ok-after'))
    sim.register('present', 'presentation', () => ran.push('present'))

    sim.step(1 / 60)
    expect(ran).toEqual(['ok-before', 'ok-after', 'present'])
    expect(sim.stats().failed).toEqual(['boom'])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('clears the failure list once the system recovers', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let explode = true
    sim.register('flaky', 'city', () => {
      if (explode) throw new Error('nope')
    })
    sim.step(1 / 60)
    expect(sim.stats().failed).toEqual(['flaky'])
    explode = false
    sim.step(1 / 60)
    expect(sim.stats().failed).toEqual([])
    spy.mockRestore()
  })
})

describe('Simulation — bookkeeping', () => {
  it('counts frames and reports its systems by stage', () => {
    const sim = new Simulation()
    sim.register('a', 'input', () => {})
    sim.register('b', 'city', () => {})
    sim.step(1 / 60)
    sim.step(1 / 60)
    const s = sim.stats()
    expect(s.frame).toBe(2)
    expect(s.systems.input).toEqual(['a'])
    expect(s.systems.city).toEqual(['b'])
    expect(s.systems.presentation).toEqual([])
  })

  it('clear() empties every stage', () => {
    const sim = new Simulation()
    for (const stage of SIM_STAGES) sim.register(stage, stage, () => {})
    sim.clear()
    const s = sim.stats()
    for (const stage of SIM_STAGES) expect(s.systems[stage]).toEqual([])
  })
})
