import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGame } from './store'

describe('standalone game store', () => {
  const fetchSpy = vi.fn()
  const websocketSpy = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('WebSocket', websocketSpy)
    fetchSpy.mockClear()
    websocketSpy.mockClear()
  })

  afterEach(() => {
    useGame.getState().dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts from repository fixtures without contacting the computer or network', () => {
    useGame.getState().start()

    const state = useGame.getState()
    expect(state.link).toBe('standalone')
    expect(state.snapshot.source).toBe('standalone')
    expect(state.snapshot.agents.length).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(websocketSpy).not.toHaveBeenCalled()
  })

  it('refreshes a resident from local scenario state only', async () => {
    useGame.getState().start()
    const resident = useGame.getState().snapshot.agents[0]

    await expect(useGame.getState().requestSummary(resident.id)).resolves.toEqual(resident)
    await expect(useGame.getState().requestSummary('../../secrets')).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(websocketSpy).not.toHaveBeenCalled()
  })
})
