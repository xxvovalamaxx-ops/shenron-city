/**
 * Game-state store: standalone simulation only.
 *
 * The world displays a fictional scenario with clearly-labelled agent
 * activity. There is no live backend connection — the game is self-contained.
 */
import { create } from 'zustand'
import type { WorldSnapshot } from '../contracts/mission-control'
import { standaloneSnapshot, driftStandalone } from './fixtures'

const SIMULATION_INTERVAL_MS = 2000

export interface GameState {
  snapshot: WorldSnapshot
  paused: boolean
  start(): void
  setPaused(paused: boolean): void
  requestSummary(agentId: string): Promise<import('../contracts/mission-control').Agent | null>
  dispose(): void
}

let timer: ReturnType<typeof setInterval> | null = null
let simulationTick = 0

function stopTimers(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export const useGame = create<GameState>((set, get) => ({
  snapshot: standaloneSnapshot(),
  paused: true,

  start() {
    stopTimers()
    simulationTick = 0
    set({ snapshot: standaloneSnapshot() })

    timer = setInterval(() => {
      if (get().paused) return
      simulationTick += 1
      set({ snapshot: driftStandalone(get().snapshot, simulationTick) })
    }, SIMULATION_INTERVAL_MS)
  },

  setPaused(paused) {
    set({ paused })
  },

  async requestSummary(agentId: string) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(agentId)) return null
    return get().snapshot.agents.find((agent) => agent.id === agentId) ?? null
  },

  dispose() {
    stopTimers()
  },
}))
