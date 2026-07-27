/**
 * Demo-mode fixtures.
 *
 * Every value here is obviously synthetic on inspection. Agent names are
 * prefixed `demo-`, the identity says DEMO, and the UI renders an amber
 * FIXTURE DATA badge whenever `source === 'demo'`. Requirement from the build
 * plan: demo data must never be mistakable for live production data.
 *
 * Nothing in here is read from disk or the network.
 */
import type { Agent, HostMetrics, SystemStatus, WorldSnapshot } from '../contracts/mission-control'

const DEMO_STATUS: SystemStatus = {
  identity: 'DEMO — not a live agent',
  model: 'demo-model',
  provider: 'demo-provider',
  overall: 'active',
  runningTasks: 3,
  queued: 2,
  completedToday: 41,
  failedToday: 1,
  toolCallsToday: 212,
  costTodayUsd: 0.8421,
  alertCount: 1,
  homeConfigured: true,
}

const DEMO_AGENTS: Agent[] = [
  {
    id: 'demo-orchestrator',
    name: 'demo-orchestrator',
    role: 'orchestrator',
    model: 'demo-model',
    provider: 'demo-provider',
    state: 'active',
    riskTier: 'high',
    currentTask: 'Coordinating three subagents',
    completedTasks: 128,
    failedActions: 2,
    toolCount: 5,
  },
  {
    id: 'demo-researcher',
    name: 'demo-researcher',
    role: 'specialist',
    model: 'demo-model',
    provider: 'demo-provider',
    state: 'active',
    riskTier: 'low',
    currentTask: 'Reading source documents',
    completedTasks: 54,
    failedActions: 0,
    toolCount: 3,
  },
  {
    id: 'demo-reviewer',
    name: 'demo-reviewer',
    role: 'specialist',
    model: 'demo-model',
    provider: 'demo-provider',
    state: 'blocked',
    riskTier: 'medium',
    currentTask: 'Waiting for approval',
    completedTasks: 33,
    failedActions: 1,
    toolCount: 2,
  },
  {
    id: 'demo-builder',
    name: 'demo-builder',
    role: 'worker',
    model: 'demo-model',
    provider: 'demo-provider',
    state: 'failed',
    riskTier: 'medium',
    currentTask: 'Build step exited non-zero',
    completedTasks: 71,
    failedActions: 4,
    toolCount: 4,
  },
  {
    id: 'demo-archivist',
    name: 'demo-archivist',
    role: 'worker',
    model: 'demo-model',
    provider: 'demo-provider',
    state: 'idle',
    riskTier: 'low',
    currentTask: null,
    completedTasks: 19,
    failedActions: 0,
    toolCount: 2,
  },
  {
    id: 'demo-sentry',
    name: 'demo-sentry',
    role: 'specialist',
    model: 'demo-model',
    provider: 'demo-provider',
    state: 'idle',
    riskTier: 'critical',
    currentTask: null,
    completedTasks: 8,
    failedActions: 0,
    toolCount: 1,
  },
]

const DEMO_METRICS: HostMetrics = {
  cpu: 34,
  memory: 61,
  memoryUsedGb: 19.5,
  memoryTotalGb: 32,
  disk: 47,
  processes: 284,
}

export function demoSnapshot(): WorldSnapshot {
  return {
    status: { ...DEMO_STATUS },
    agents: DEMO_AGENTS.map((a) => ({ ...a })),
    metrics: { ...DEMO_METRICS },
    source: 'demo',
    fetchedAt: 0,
  }
}

/** Gentle drift so the demo world is not visibly frozen. Deterministic. */
export function driftDemo(base: WorldSnapshot, tick: number): WorldSnapshot {
  const wave = (phase: number, amp: number) => Math.sin((tick + phase) / 9) * amp
  return {
    ...base,
    metrics: {
      ...base.metrics,
      cpu: Math.min(100, Math.max(4, DEMO_METRICS.cpu + wave(0, 22))),
      memory: Math.min(100, Math.max(10, DEMO_METRICS.memory + wave(4, 7))),
      disk: DEMO_METRICS.disk,
    },
  }
}
