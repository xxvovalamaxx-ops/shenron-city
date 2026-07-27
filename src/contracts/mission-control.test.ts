import { describe, expect, it } from 'vitest'
import {
  normaliseAgents,
  normaliseMetrics,
  normaliseStatus,
  toAgentState,
  toRiskTier,
} from './mission-control'
import { toGameEvent } from './events'

describe('status validation', () => {
  it('accepts a well-formed payload', () => {
    const s = normaliseStatus({
      overall: 'active',
      agent_identity: 'Shenron',
      active_model: 'deepseek-v4-flash',
      active_provider: 'opencode-go',
      running_tasks: 2,
      estimated_cost_today_usd: 1.23,
      alerts: [{ id: 'a' }],
      hermesHomeConfigured: true,
    })
    expect(s).not.toBeNull()
    expect(s!.identity).toBe('Shenron')
    expect(s!.runningTasks).toBe(2)
    expect(s!.alertCount).toBe(1)
  })

  it('degrades a malformed field instead of dropping the snapshot', () => {
    const s = normaliseStatus({
      overall: 'active',
      running_tasks: 'not a number',
      estimated_cost_today_usd: null,
      alerts: 'nope',
    })
    expect(s).not.toBeNull()
    expect(s!.runningTasks).toBe(0)
    expect(s!.costTodayUsd).toBe(0)
    expect(s!.alertCount).toBe(0)
  })

  it('rejects structurally wrong input', () => {
    expect(normaliseStatus(null)).toBeNull()
    expect(normaliseStatus('a string')).toBeNull()
    expect(normaliseStatus(42)).toBeNull()
  })

  it('never reports negative counters', () => {
    const s = normaliseStatus({ running_tasks: -5, completed_today: -1 })
    expect(s!.runningTasks).toBe(0)
    expect(s!.completedToday).toBe(0)
  })
})

describe('agent normalisation', () => {
  it('drops only the malformed row', () => {
    const agents = normaliseAgents([
      { id: 'a', name: 'A', status: 'active' },
      null,
      { id: 'b', name: 'B', status: 'idle' },
    ])
    expect(agents.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('returns a stable order regardless of response order', () => {
    const one = normaliseAgents([{ id: 'z' }, { id: 'a' }, { id: 'm' }])
    const two = normaliseAgents([{ id: 'm' }, { id: 'z' }, { id: 'a' }])
    expect(one.map((a) => a.id)).toEqual(two.map((a) => a.id))
  })

  it('maps an unrecognised status to unknown, not idle', () => {
    // The dangerous failure: an agent in a state we do not model must not be
    // painted the same colour as a healthy one.
    expect(toAgentState('wedged')).toBe('unknown')
    expect(toAgentState('')).toBe('unknown')
    expect(toAgentState('ACTIVE')).toBe('active')
    expect(toAgentState(' Running ')).toBe('active')
  })

  it('falls back to the lowest risk tier only for unrecognised values', () => {
    expect(toRiskTier('critical')).toBe('critical')
    expect(toRiskTier('HIGH')).toBe('high')
    expect(toRiskTier('spicy')).toBe('low')
  })

  it('handles a non-array response', () => {
    expect(normaliseAgents({ nope: true })).toEqual([])
    expect(normaliseAgents(null)).toEqual([])
  })
})

describe('metrics', () => {
  it('reads a real /api/system/metrics response', () => {
    // Captured verbatim from the running backend. The first schema guessed
    // `cpu_percent`/`process_count` from the endpoint name, so every field
    // defaulted and the HUD reported 0% CPU on a machine sitting at 31%.
    const m = normaliseMetrics({
      cpu_pct: 31.7,
      memory_total_gb: 31.1,
      memory_used_gb: 24.6,
      memory_pct: 79.0,
      disk_total_gb: 446.3,
      disk_used_gb: 64.3,
      disk_pct: 14.4,
      load_1m: 0.06,
      processes: 447,
    })
    expect(m).not.toBeNull()
    expect(m!.cpu).toBeCloseTo(31.7, 5)
    expect(m!.memory).toBeCloseTo(79, 5)
    expect(m!.disk).toBeCloseTo(14.4, 5)
    expect(m!.processes).toBe(447)
    expect(m!.memoryUsedGb).toBeCloseTo(24.6, 5)
  })

  it('still accepts the _percent spelling', () => {
    const m = normaliseMetrics({ cpu_percent: 12, memory_percent: 40, process_count: 9 })
    expect(m!.cpu).toBe(12)
    expect(m!.memory).toBe(40)
    expect(m!.processes).toBe(9)
  })

  it('clamps percentages into range', () => {
    const m = normaliseMetrics({ cpu_pct: 140, memory_pct: 0, disk_pct: 50 })
    expect(m!.cpu).toBe(100)
    expect(m!.memory).toBe(0)
    expect(m!.disk).toBe(50)
  })

  it('returns null for a non-object', () => {
    expect(normaliseMetrics('boom')).toBeNull()
  })
})

describe('event mapping', () => {
  it('maps known broadcast kinds', () => {
    expect(toGameEvent({ type: 'connected', data: {} })).toEqual({ type: 'status.tick' })
    expect(toGameEvent({ type: 'task_failed', data: { task_id: 't1', reason: 'boom' } })).toEqual({
      type: 'task.failed',
      taskId: 't1',
      agentId: null,
      reason: 'boom',
    })
  })

  it('drops unknown traffic rather than forwarding it half-understood', () => {
    expect(toGameEvent({ type: 'something_new', data: {} })).toBeNull()
    expect(toGameEvent(null)).toBeNull()
    expect(toGameEvent('string')).toBeNull()
    expect(toGameEvent({ type: 'agent_status', data: {} })).toBeNull() // no id
  })
})
