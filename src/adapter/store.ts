/**
 * Standalone game-state store.
 *
 * This phase is intentionally isolated from Mission Control and the host
 * computer. The world starts from in-repository scenario data, advances on a
 * deterministic timer, and exposes no network, filesystem, shell, desktop, or
 * environment bridge.
 */
import { create } from 'zustand'
import type { Agent, WorldSnapshot } from '../contracts/mission-control'
import { driftStandalone, standaloneSnapshot } from './fixtures'

export type LinkState = 'standalone'

const SIMULATION_INTERVAL_MS = 2000

export interface GameState {
  snapshot: WorldSnapshot
  link: LinkState
  start(): void
  requestSummary(agentId: string): Promise<Agent | null>
  dispose(): void
}

let timer: ReturnType<typeof setInterval> | null = null
let simulationTick = 0

function stopSimulation(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export const useGame = create<GameState>((set, get) => ({
  snapshot: standaloneSnapshot(),
  link: 'standalone',

  start() {
    stopSimulation()
    simulationTick = 0
    set({ snapshot: standaloneSnapshot(), link: 'standalone' })
    timer = setInterval(() => {
      simulationTick += 1
      set({ snapshot: driftStandalone(get().snapshot, simulationTick) })
    }, SIMULATION_INTERVAL_MS)
  },

  async requestSummary(agentId: string) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(agentId)) return null
    return get().snapshot.agents.find((agent) => agent.id === agentId) ?? null
  },

  dispose() {
    stopSimulation()
  },
}))
