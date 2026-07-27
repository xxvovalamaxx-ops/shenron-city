/**
 * Mission Control client.
 *
 * The only place in the game that performs network I/O. Everything it returns
 * has already been through contracts/. Callers get domain types or null —
 * never a raw response.
 *
 * Security notes:
 *  - The session token lives in memory only. Not localStorage, not a cookie
 *    the game sets — a token in localStorage survives the tab and widens the
 *    blast radius of any XSS in a dependency.
 *  - All requests go to same-origin /api, proxied by Vite to 127.0.0.1:9120.
 *    No provider keys, no upstream URLs, and no secrets exist in this bundle.
 *  - Nothing here can execute anything. It is read-mostly by construction; the
 *    single write path is `requestStatusSummary`, which is a no-argument read.
 */
import {
  normaliseAgents,
  normaliseMetrics,
  normaliseStatus,
  type Agent,
  type HostMetrics,
  type SystemStatus,
} from '../contracts/mission-control'
import { toGameEvent, type GameEvent } from '../contracts/events'

export interface LivePayload {
  status: SystemStatus
  agents: Agent[]
  metrics: HostMetrics | null
}

const SESSION_URL = '/api/auth/session'
const REQUEST_TIMEOUT_MS = 6000

export class MissionControlClient {
  private token: string | null = null
  private minting: Promise<string | null> | null = null
  private socket: WebSocket | null = null
  private reconnectAttempt = 0
  private closed = false
  private eventHandlers = new Set<(e: GameEvent) => void>()

  // ── Auth ───────────────────────────────────────────────────────────────────

  /** Mints a session, de-duplicating concurrent callers onto one request. */
  private async session(): Promise<string | null> {
    if (this.token) return this.token
    if (this.minting) return this.minting

    this.minting = (async () => {
      try {
        const res = await this.timedFetch(SESSION_URL, { method: 'POST' })
        if (!res.ok) return null
        const body = (await res.json()) as Record<string, unknown>
        const token = body.token ?? body.session_token ?? body.sessionToken
        this.token = typeof token === 'string' && token.length > 0 ? token : null
        return this.token
      } catch {
        return null
      } finally {
        this.minting = null
      }
    })()

    return this.minting
  }

  private async timedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(url, { ...init, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  /** GET with the session header, re-minting exactly once on a 401. */
  private async authedJson(path: string, retry = true): Promise<unknown | null> {
    // Honour an active backoff for this path rather than hammering a limiter
    // that has already said no.
    const until = this.backoffUntil.get(path) ?? 0
    if (Date.now() < until) return null

    const token = await this.session()
    const headers: Record<string, string> = {}
    if (token) headers['X-Session-Token'] = token

    let res: Response
    try {
      res = await this.timedFetch(path, { headers })
    } catch {
      return null
    }

    if (res.status === 401 && retry) {
      this.token = null
      return this.authedJson(path, false)
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 15_000
      this.backoffUntil.set(path, Date.now() + waitMs)
      return null
    }

    if (!res.ok) return null
    try {
      return await res.json()
    } catch {
      return null
    }
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /**
   * Per-endpoint refresh cadence.
   *
   * The backend's default bucket is 200 requests per 60 s, shared across every
   * route. Polling three endpoints on one fast timer burns that in well under
   * a minute and the limiter starts returning 429 — which is exactly what
   * happened the first time this ran. Status is the heartbeat and stays quick;
   * the roster and host metrics change slowly and do not need to.
   *
   * Budget at these rates: 30 + 8 + 15 = ~53 requests/minute.
   */
  private static readonly CADENCE_MS: Record<string, number> = {
    '/api/status': 0, // every poll
    '/api/agents': 8000,
    '/api/system/metrics': 4000,
  }

  private lastFetched = new Map<string, number>()
  private cache = new Map<string, unknown>()
  private backoffUntil = new Map<string, number>()

  /**
   * Fetch honouring cadence and caching the last good body.
   *
   * `force` skips the cadence check — used when a socket event says something
   * actually changed, so the world reacts immediately instead of waiting out
   * the interval.
   */
  private async cadenced(path: string, force: boolean): Promise<unknown | null> {
    const now = Date.now()
    const interval = MissionControlClient.CADENCE_MS[path] ?? 0
    const last = this.lastFetched.get(path) ?? 0

    if (!force && interval > 0 && now - last < interval) {
      return this.cache.get(path) ?? null
    }

    const body = await this.authedJson(path)
    if (body === null) {
      // Failed or rate-limited: keep serving the last good body. Blanking the
      // agent roster because one poll got a 429 would empty floor 45 and read
      // as "all your agents vanished".
      return this.cache.get(path) ?? null
    }

    this.lastFetched.set(path, now)
    this.cache.set(path, body)
    return body
  }

  /**
   * One full snapshot. Status is required — without it there is no world to
   * render, so a status failure fails the whole poll and the caller keeps its
   * last known good data. Agents and metrics degrade independently.
   */
  async fetchSnapshot(force = false): Promise<LivePayload | null> {
    const [rawStatus, rawAgents, rawMetrics] = await Promise.all([
      this.cadenced('/api/status', force),
      this.cadenced('/api/agents', force),
      this.cadenced('/api/system/metrics', force),
    ])

    const status = normaliseStatus(rawStatus)
    if (!status) return null

    return {
      status,
      agents: normaliseAgents(rawAgents),
      metrics: normaliseMetrics(rawMetrics),
    }
  }

  /**
   * The one low-risk action the vertical slice exposes. Read-only: it re-reads
   * the agent record and returns it. Deliberately takes no free-form input, so
   * there is nothing for NPC dialogue to smuggle a command through.
   */
  async requestStatusSummary(agentId: string): Promise<Agent | null> {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(agentId)) return null
    const raw = await this.authedJson(`/api/agents/${encodeURIComponent(agentId)}`)
    return normaliseAgents([raw])[0] ?? null
  }

  // ── Realtime ───────────────────────────────────────────────────────────────

  onEvent(fn: (e: GameEvent) => void): () => void {
    this.eventHandlers.add(fn)
    return () => this.eventHandlers.delete(fn)
  }

  /**
   * Connects to the backend's existing /ws broadcaster. Reconnects with capped
   * exponential backoff. Polling continues regardless — the socket is an
   * accelerator for responsiveness, never the only path to fresh data, so
   * losing it degrades latency rather than correctness.
   */
  connectEvents(): void {
    if (this.closed || this.socket) return

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    let ws: WebSocket
    try {
      ws = new WebSocket(`${proto}//${location.host}/ws`)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = ws

    ws.onopen = () => {
      this.reconnectAttempt = 0
    }
    ws.onmessage = (msg) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(msg.data))
      } catch {
        return
      }
      const event = toGameEvent(parsed)
      if (!event) return
      for (const fn of this.eventHandlers) fn(event)
    }
    ws.onclose = () => {
      this.socket = null
      this.scheduleReconnect()
    }
    ws.onerror = () => {
      try {
        ws.close()
      } catch {
        /* onclose handles reconnect */
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5)
    setTimeout(() => this.connectEvents(), delay)
  }

  dispose(): void {
    this.closed = true
    this.eventHandlers.clear()
    try {
      this.socket?.close()
    } catch {
      /* already gone */
    }
    this.socket = null
  }
}
