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

  it('a pause taken during input stops the same frame, not the next one', () => {
    // The property that makes a single pause state worth having, stated as
    // arithmetic rather than left to depend on render priorities: the input
    // stage flips pause and every gameplay stage after it in the SAME frame
    // already sees it. Today the -100 priority on GameLoop gets this right by
    // hand; here it is a guarantee of the ordering itself.
    const ran: string[] = []
    sim.register('input', 'input', () => {
      sim.setPaused(true)
      ran.push('input')
    })
    sim.register('city', 'city', () => ran.push('city'))
    sim.register('vehicles', 'vehicles', () => ran.push('vehicles'))
    sim.register('present', 'presentation', () => ran.push('present'))

    const frame = sim.step(1 / 60)
    expect(ran).toEqual(['input', 'present'])
    expect(frame.paused).toBe(true)
    expect(frame.dt).toBe(0)
  })

  it('an unpause taken during input resumes the same frame', () => {
    sim.setPaused(true)
    const ran: string[] = []
    sim.register('input', 'input', () => {
      sim.setPaused(false)
      ran.push('input')
    })
    sim.register('city', 'city', () => ran.push('city'))
    sim.step(1 / 60)
    expect(ran).toEqual(['input', 'city'])
  })

  it('presentation still runs while paused, so a paused frame still draws', () => {
    sim.setPaused(true)
    let drew = 0
    let stepped = 0
    sim.register('present', 'presentation', () => {
      drew++
    })
    sim.register('city', 'city', () => {
      stepped++
    })
    sim.step(1 / 60)
    sim.step(1 / 60)
    expect(drew).toBe(2)
    expect(stepped).toBe(0)
  })

  it('presentation sees dt 0 while paused, so nothing integrates behind the menu', () => {
    sim.setPaused(true)
    let dt = -1
    let raw = -1
    sim.register('p', 'presentation', (f) => {
      dt = f.dt
      raw = f.rawDt
    })
    sim.step(1 / 60)
    expect(dt).toBe(0)
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
