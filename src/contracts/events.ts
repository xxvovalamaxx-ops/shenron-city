/**
 * Versioned game events.
 *
 * The backend broadcasts on /ws in its own shape. This is the game's stable
 * vocabulary — the set the world is allowed to react to. Adding a backend
 * field must never require touching a 3D component; it requires a mapping
 * here.
 *
 * Bump SCHEMA_VERSION on any breaking change to a payload.
 */
import { z } from 'zod'

export const SCHEMA_VERSION = 1

export const GameEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('agent.status_changed'),
    agentId: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  z.object({ type: z.literal('agent.online'), agentId: z.string() }),
  z.object({ type: z.literal('agent.offline'), agentId: z.string() }),
  z.object({
    type: z.literal('task.started'),
    taskId: z.string(),
    agentId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('task.completed'),
    taskId: z.string(),
    agentId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('task.failed'),
    taskId: z.string(),
    agentId: z.string().nullable(),
    reason: z.string().default(''),
  }),
  z.object({
    type: z.literal('approval.requested'),
    approvalId: z.string(),
    summary: z.string().default(''),
  }),
  z.object({ type: z.literal('approval.resolved'), approvalId: z.string() }),
  z.object({
    type: z.literal('incident.created'),
    incidentId: z.string(),
    severity: z.string().default('unknown'),
  }),
  z.object({ type: z.literal('status.tick') }),
])

export type GameEvent = z.infer<typeof GameEvent>

/**
 * Backend broadcast envelope → game event.
 *
 * Returns null for anything unrecognised. Unknown backend traffic is dropped
 * at the boundary rather than being forwarded as a half-understood event; the
 * world reacting to a message it does not model is how impossible states get
 * in.
 */
export function toGameEvent(raw: unknown): GameEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const env = raw as Record<string, unknown>
  const kind = typeof env.type === 'string' ? env.type : ''
  const data = (
    typeof env.data === 'object' && env.data !== null ? env.data : {}
  ) as Record<string, unknown>

  const s = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)

  switch (kind) {
    case 'status':
    case 'status_update':
    case 'connected':
      return { type: 'status.tick' }
    case 'agent_status': {
      const id = s(data.agent_id ?? data.id)
      if (!id) return null
      return {
        type: 'agent.status_changed',
        agentId: id,
        from: s(data.from, 'unknown'),
        to: s(data.to ?? data.status, 'unknown'),
      }
    }
    case 'task_started':
      return { type: 'task.started', taskId: s(data.task_id ?? data.id), agentId: s(data.agent_id) || null }
    case 'task_completed':
      return { type: 'task.completed', taskId: s(data.task_id ?? data.id), agentId: s(data.agent_id) || null }
    case 'task_failed':
      return {
        type: 'task.failed',
        taskId: s(data.task_id ?? data.id),
        agentId: s(data.agent_id) || null,
        reason: s(data.reason ?? data.error),
      }
    case 'approval_requested':
      return {
        type: 'approval.requested',
        approvalId: s(data.approval_id ?? data.id),
        summary: s(data.summary ?? data.description),
      }
    case 'incident':
    case 'incident_created':
      return {
        type: 'incident.created',
        incidentId: s(data.incident_id ?? data.id),
        severity: s(data.severity, 'unknown'),
      }
    default:
      return null
  }
}
