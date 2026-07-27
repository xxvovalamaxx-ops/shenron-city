/**
 * The single source of truth the 3D world reads from.
 *
 * Connection policy: the game attempts live Mission Control on start. If it
 * cannot reach it, it does NOT silently fall back to demo data — it surfaces
 * the failure and makes entering demo mode an explicit choice. A monitoring
 * surface that quietly starts showing fiction is the exact failure the build
 * plan calls out.
 */
import { create } from 'zustand'
import type { Agent, WorldSnapshot } from '../contracts/mission-control'
import type { GameEvent } from '../contracts/events'
import { MissionControlClient } from './client'
import { demoSnapshot, driftDemo } from './fixtures'

export type LinkState = 'connecting' | 'live' | 'degraded' | 'unreachable' | 'demo'

const POLL_INTERVAL_MS = 2000
const EVENT_LOG_LIMIT = 40
/** Trailing debounce on socket-triggered refreshes. */
const EVENT_DEBOUNCE_MS = 700

export interface GameState {
  snapshot: WorldSnapshot | null
  link: LinkState
  /** Consecutive failed polls. Drives the degraded → unreachable transition. */
  failures: number
  events: GameEvent[]
  start(): void
  enterDemoMode(): void
  retryLive(): void
  requestSummary(agentId: string): Promise<Agent | null>
  dispose(): void
}

let client: MissionControlClient | null = null
let timer: ReturnType<typeof setInterval> | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let demoTick = 0

/** Below this many consecutive failures we keep showing last-known data. */
const DEGRADED_LIMIT = 3

export const useGame = create<GameState>((set, get) => {
  const stopPolling = () => {
    if (timer) clearInterval(timer)
    timer = null
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  const pollOnce = async (force = false) => {
    const c = client
    if (!c) return
    const payload = await c.fetchSnapshot(force)

    if (!payload) {
      const failures = get().failures + 1
      set({
        failures,
        // Keep the last good snapshot on screen while degraded — but say so.
        link: failures >= DEGRADED_LIMIT ? 'unreachable' : 'degraded',
      })
      return
    }

    set({
      failures: 0,
      link: 'live',
      snapshot: {
        status: payload.status,
        agents: payload.agents,
        metrics: payload.metrics ?? {
          cpu: 0,
          memory: 0,
          memoryUsedGb: 0,
          memoryTotalGb: 0,
          disk: 0,
          processes: 0,
        },
        source: 'live',
        fetchedAt: Date.now(),
      },
    })
  }

  const startDemoLoop = () => {
    stopPolling()
    const base = demoSnapshot()
    set({ snapshot: base, link: 'demo', failures: 0 })
    timer = setInterval(() => {
      demoTick += 1
      const current = get().snapshot
      if (current && current.source === 'demo') {
        set({ snapshot: driftDemo(current, demoTick) })
      }
    }, POLL_INTERVAL_MS)
  }

  const startLive = () => {
    stopPolling()
    client?.dispose()
    client = new MissionControlClient()
    set({ link: 'connecting', failures: 0 })

    client.onEvent((event) => {
      set((s) => ({ events: [event, ...s.events].slice(0, EVENT_LOG_LIMIT) }))
      // A socket event means something changed; pull the authoritative state
      // rather than trying to patch the snapshot from the event payload.
      //
      // Coalesced: the broadcaster can emit a burst, and one full refresh per
      // event walked straight into the backend's rate limiter.
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void pollOnce(true)
      }, EVENT_DEBOUNCE_MS)
    })
    client.connectEvents()

    void pollOnce()
    timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS)
  }

  return {
    snapshot: null,
    link: 'connecting',
    failures: 0,
    events: [],

    start() {
      // ?mode=demo is an explicit opt-in, useful for showing the game with no
      // backend running at all.
      const forced = new URLSearchParams(location.search).get('mode')
      if (forced === 'demo') startDemoLoop()
      else startLive()
    },

    enterDemoMode() {
      client?.dispose()
      client = null
      startDemoLoop()
    },

    retryLive() {
      startLive()
    },

    async requestSummary(agentId: string) {
      const c = client
      if (!c) {
        // Demo mode answers from fixtures so the interaction still works, and
        // the caller still knows it is demo via snapshot.source.
        return get().snapshot?.agents.find((a) => a.id === agentId) ?? null
      }
      return c.requestStatusSummary(agentId)
    },

    dispose() {
      stopPolling()
      client?.dispose()
      client = null
    },
  }
})

/** True when what is on screen is real Mission Control data. */
export function isLive(link: LinkState): boolean {
  return link === 'live' || link === 'degraded'
}
