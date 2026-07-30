import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGame } from './store'

describe('standalone game store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    useGame.getState().dispose()
    useGame.getState().setPaused(true)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts from repository fixtures', () => {
    useGame.getState().start()

    const state = useGame.getState()
    expect(state.snapshot.source).toBe('standalone')
    expect(state.snapshot.agents.length).toBeGreaterThan(0)
  })

  it('refreshes a resident from local scenario state only', async () => {
    useGame.getState().start()
    const resident = useGame.getState().snapshot.agents[0]

    await expect(useGame.getState().requestSummary(resident.id)).resolves.toEqual(resident)
    await expect(useGame.getState().requestSummary('../../secrets')).resolves.toBeNull()
  })

  it('never opens a network path during startup or local refresh', async () => {
    const fetchSpy = vi.fn()
    const webSocketSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('WebSocket', webSocketSpy)

    useGame.getState().start()
    vi.advanceTimersByTime(6000)
    await useGame.getState().requestSummary('iris')

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(webSocketSpy).not.toHaveBeenCalled()
  })

  it('drifts metrics over time', () => {
    useGame.getState().start()
    useGame.getState().setPaused(false)
    const before = useGame.getState().snapshot

    vi.advanceTimersByTime(6000)
    const after = useGame.getState().snapshot

    expect(after.metrics).toBeDefined()
    expect(after.metrics!.cpu).not.toBe(before.metrics!.cpu)
  })

  it('freezes local scenario timers while paused and resumes without catch-up', () => {
    useGame.getState().start()
    const before = useGame.getState().snapshot

    vi.advanceTimersByTime(6000)
    expect(useGame.getState().snapshot).toBe(before)

    useGame.getState().setPaused(false)
    vi.advanceTimersByTime(2000)
    expect(useGame.getState().snapshot).not.toBe(before)
  })
})
