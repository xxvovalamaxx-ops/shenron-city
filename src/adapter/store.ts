/**
 * Game-state store: live Mission Control, or an explicitly-labelled standalone
 * simulation.
 *
 * The building is meant to represent the player's actual machine, so live is
 * the point of the thing. But the game must also be runnable by someone with
 * no backend, and it must never quietly present fiction as fact. So the two
 * are separate states rather than a silent fallback: `link` is always the
 * truth about where the data came from, and the HUD and world signage read it.
 *
 * Order of events on start():
 *  1. Show standalone immediately, so there is a world to walk around in.
 *  2. Probe Mission Control.
 *  3. Promote to live only once a snapshot actually validates.
 *
 * A failed probe is not an error. Most people running this will not have
 * Mission Control up, and the game is complete without it.
 */
import { create } from 'zustand'
import type { Agent, WorldSnapshot } from '../contracts/mission-control'
import { driftStandalone, standaloneSnapshot } from './fixtures'
import { MissionControlClient } from './client'

/**
 * 'standalone' — in-repo scenario data on a timer. Never real, always labelled.
 * 'connecting' — probe in flight; still showing standalone data.
 * 'live'       — every field came from Mission Control and validated.
 * 'degraded'   — was live, last poll failed. Data is the last known good:
 *                stale but real, and the HUD has to say so.
 */
export type LinkState = 'standalone' | 'connecting' | 'live' | 'degraded'

const SIMULATION_INTERVAL_MS = 2000
const LIVE_POLL_MS = 2000

/**
 * Opt-in, because a game that reaches for a local port unasked is a surprise.
 * Vite proxies /api to MISSION_CONTROL_URL; this only decides whether to try.
 */
function liveRequested(): boolean {
  if (typeof location === 'undefined') return false
  const mode = new URLSearchParams(location.search).get('mode')
  if (mode === 'demo' || mode === 'standalone') return false
  return mode === 'live' || import.meta.env.VITE_MISSION_CONTROL === 'on'
}

export interface GameState {
  snapshot: WorldSnapshot
  link: LinkState
  start(): void
  requestSummary(agentId: string): Promise<Agent | null>
  dispose(): void
}

let timer: ReturnType<typeof setInterval> | null = null
let client: MissionControlClient | null = null
let simulationTick = 0

function stopTimers(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function teardownClient(): void {
  client?.dispose()
  client = null
}

export const useGame = create<GameState>((set, get) => ({
  snapshot: standaloneSnapshot(),
  link: 'standalone',

  start() {
    stopTimers()
    teardownClient()
    simulationTick = 0
    set({ snapshot: standaloneSnapshot(), link: 'standalone' })

    if (!liveRequested()) {
      timer = setInterval(() => {
        simulationTick += 1
        set({ snapshot: driftStandalone(get().snapshot, simulationTick) })
      }, SIMULATION_INTERVAL_MS)
      return
    }

    set({ link: 'connecting' })
    const mc = new MissionControlClient()
    client = mc

    const poll = async (force = false) => {
      // A stale poll from a disposed client must not write into a new session.
      if (client !== mc) return
      const payload = await mc.fetchSnapshot(force)

      if (!payload) {
        // Never fall back to fiction after having been live: that would swap
        // the player's real agents for invented ones without telling them.
        set((s) => (s.link === 'standalone' ? s : { link: 'degraded' }))
        return
      }

      set({
        link: 'live',
        snapshot: {
          source: 'live',
          status: payload.status,
          agents: payload.agents,
          metrics: payload.metrics,
          fetchedAt: Date.now(),
        },
      })
    }

    // A socket event means something changed; re-read now rather than waiting
    // out the cadence.
    mc.onEvent(() => void poll(true))
    mc.connectEvents()
    void poll(true)
    timer = setInterval(() => void poll(false), LIVE_POLL_MS)
  },

  async requestSummary(agentId: string) {
    // Validated here as well as in the client: this is reachable from NPC
    // dialogue, and the id must never reach a URL path unchecked.
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(agentId)) return null

    const mc = client
    if (mc && get().link !== 'standalone') {
      const live = await mc.requestStatusSummary(agentId)
      if (live) return live
    }
    return get().snapshot.agents.find((agent) => agent.id === agentId) ?? null
  },

  dispose() {
    stopTimers()
    teardownClient()
  },
}))
