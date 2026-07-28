/**
 * The boundary between Mission Control and the game.
 *
 * Nothing in world/, gameplay/, agents/ or ui/ may import a backend response
 * shape directly. Raw payloads land here, get validated, and leave as the
 * stable domain types below. When the backend changes shape, this file is the
 * only thing that breaks.
 *
 * Validation posture: every field carries `.catch(default)`. A malformed
 * field degrades to a sane default instead of throwing away the whole
 * snapshot — a control room that goes blank because one number arrived as a
 * string is worse than one showing a zero. Structural failure (not an object
 * at all) is still a hard parse failure and is reported as such.
 */
import { z } from 'zod'

// ── Raw backend payloads ─────────────────────────────────────────────────────
// Mirrors backend/routes/status.py::get_status and routes/agents.py::list_agents.

const num = (d: number) => z.coerce.number().catch(d)
const str = (d: string) => z.coerce.string().catch(d)

export const RawStatus = z.object({
  overall: str('unknown'),
  active_provider: str('unknown'),
  active_model: str('unknown'),
  agent_identity: str('Shenron'),
  running_tasks: num(0),
  queue_length: num(0),
  completed_today: num(0),
  failed_today: num(0),
  tool_calls_today: num(0),
  tokens_input_today: num(0),
  tokens_output_today: num(0),
  estimated_cost_today_usd: num(0),
  alerts: z.array(z.unknown()).catch([]),
  hermesHomeConfigured: z.boolean().catch(false),
})

export const RawAgent = z.object({
  id: str('unknown'),
  name: str('unnamed'),
  role: str('worker'),
  model: str('unknown'),
  provider: str('unknown'),
  status: str('idle'),
  risk_tier: str('unknown'),
  permissions: z.array(z.string()).catch([]),
  tools: z.array(z.string()).catch([]),
  current_task: z.string().nullish().catch(null),
  completed_tasks: num(0),
  failed_actions: num(0),
})

/**
 * Field names taken from an actual `/api/system/metrics` response, not from
 * the endpoint's name. The first version of this guessed `cpu_percent` /
 * `process_count`; the backend sends `cpu_pct` / `processes`, so every value
 * fell through to its default and the HUD confidently reported 0% CPU on a
 * machine at 31%. The `_percent` aliases are kept because they cost nothing
 * and a rename in either direction should not blank the readout again.
 */
export const RawMetrics = z.object({
  cpu_pct: num(-1),
  cpu_percent: num(-1),
  memory_pct: num(-1),
  memory_percent: num(-1),
  memory_used_gb: num(0),
  memory_total_gb: num(0),
  disk_pct: num(-1),
  disk_percent: num(-1),
  processes: num(-1),
  process_count: num(-1),
})

// ── Domain types — what the game actually renders ────────────────────────────

/**
 * Deliberately a closed set. The backend's `status` string is free-form; the
 * world needs a bounded set to map onto colour, animation and audio, so
 * anything unrecognised becomes 'unknown' rather than silently rendering as
 * idle. An agent in an unknown state must not look like a healthy one.
 */
export type AgentState = 'active' | 'idle' | 'blocked' | 'failed' | 'offline' | 'unknown'

export type RiskTier = 'low' | 'medium' | 'high' | 'critical' | 'unknown'

export interface Agent {
  id: string
  name: string
  role: string
  model: string
  provider: string
  state: AgentState
  riskTier: RiskTier
  currentTask: string | null
  completedTasks: number
  failedActions: number
  toolCount: number
}

export interface SystemStatus {
  identity: string
  model: string
  provider: string
  overall: AgentState
  runningTasks: number
  queued: number
  completedToday: number
  failedToday: number
  toolCallsToday: number
  costTodayUsd: number
  alertCount: number
  homeConfigured: boolean
}

export interface HostMetrics {
  cpu: number
  memory: number
  memoryUsedGb: number
  memoryTotalGb: number
  disk: number
  processes: number
}

/** Everything the world renders from, in one immutable snapshot. */
export interface WorldSnapshot {
  status: SystemStatus
  agents: Agent[]
  /**
   * Null when Mission Control served a snapshot but its metrics endpoint did
   * not — the roster is still real and worth rendering, so host metrics
   * degrade on their own rather than failing the whole poll. The HUD shows a
   * dash, never a fabricated zero.
   */
  metrics: HostMetrics | null
  /**
   * Where this data came from. Load-bearing, not decorative: the HUD chip, the
   * floor-45 signage and the secretary's answers all branch on it, so fiction
   * can never be mistaken for the player's real system.
   */
  source: 'standalone'
  /** Epoch ms the snapshot was taken. Zero while standalone. */
  fetchedAt: number
}

// ── Normalisation ────────────────────────────────────────────────────────────

const AGENT_STATES: Record<string, AgentState> = {
  active: 'active',
  running: 'active',
  working: 'active',
  busy: 'active',
  idle: 'idle',
  ready: 'idle',
  ok: 'idle',
  healthy: 'idle',
  blocked: 'blocked',
  waiting: 'blocked',
  paused: 'blocked',
  degraded: 'blocked',
  failed: 'failed',
  error: 'failed',
  crashed: 'failed',
  offline: 'offline',
  stopped: 'offline',
}

export function toAgentState(raw: string): AgentState {
  return AGENT_STATES[raw.trim().toLowerCase()] ?? 'unknown'
}

const RISK_TIERS: RiskTier[] = ['low', 'medium', 'high', 'critical']

export function toRiskTier(raw: string): RiskTier {
  const v = raw.trim().toLowerCase() as RiskTier
  return RISK_TIERS.includes(v) ? v : 'unknown'
}

export function normaliseStatus(input: unknown): SystemStatus | null {
  const parsed = RawStatus.safeParse(input)
  if (!parsed.success) return null
  const r = parsed.data
  return {
    identity: r.agent_identity,
    model: r.active_model,
    provider: r.active_provider,
    overall: toAgentState(r.overall),
    runningTasks: Math.max(0, Math.round(r.running_tasks)),
    queued: Math.max(0, Math.round(r.queue_length)),
    completedToday: Math.max(0, Math.round(r.completed_today)),
    failedToday: Math.max(0, Math.round(r.failed_today)),
    toolCallsToday: Math.max(0, Math.round(r.tool_calls_today)),
    costTodayUsd: Math.max(0, r.estimated_cost_today_usd),
    alertCount: r.alerts.length,
    homeConfigured: r.hermesHomeConfigured,
  }
}

export function normaliseAgents(input: unknown): Agent[] {
  if (!Array.isArray(input)) return []
  const out: Agent[] = []
  for (const item of input) {
    const parsed = RawAgent.safeParse(item)
    if (!parsed.success) continue // drop the bad row, keep the rest
    const r = parsed.data
    out.push({
      id: r.id,
      name: r.name,
      role: r.role,
      model: r.model,
      provider: r.provider,
      state: toAgentState(r.status),
      riskTier: toRiskTier(r.risk_tier),
      currentTask: r.current_task ?? null,
      completedTasks: Math.max(0, Math.round(r.completed_tasks)),
      failedActions: Math.max(0, Math.round(r.failed_actions)),
      toolCount: r.tools.length,
    })
  }
  // Stable order: the world assigns offices by index, so a reordered response
  // must not teleport agents between rooms.
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function normaliseMetrics(input: unknown): HostMetrics | null {
  const parsed = RawMetrics.safeParse(input)
  if (!parsed.success) return null
  const r = parsed.data
  const pct = (v: number) => Math.min(100, Math.max(0, v))
  /** -1 is the "absent" sentinel; fall through the aliases before giving up. */
  const first = (...vals: number[]) => vals.find((v) => v >= 0) ?? 0

  return {
    cpu: pct(first(r.cpu_pct, r.cpu_percent)),
    memory: pct(first(r.memory_pct, r.memory_percent)),
    memoryUsedGb: Math.max(0, r.memory_used_gb),
    memoryTotalGb: Math.max(0, r.memory_total_gb),
    disk: pct(first(r.disk_pct, r.disk_percent)),
    processes: Math.max(0, Math.round(first(r.processes, r.process_count))),
  }
}
