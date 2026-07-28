/**
 * Standalone game scenario.
 *
 * Every value here is fictional and ships with the repository. Nothing is
 * read from Mission Control, the host computer, a model provider, or a remote
 * service. The UI labels this as a standalone prototype.
 *
 * Nothing in here is read from disk or the network.
 */
import type { Agent, HostMetrics, SystemStatus, WorldSnapshot } from '../contracts/mission-control'

const STANDALONE_STATUS: SystemStatus = {
  identity: 'Shenron City prototype',
  model: 'offline-scenario',
  provider: 'in-repository fixture',
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

const STANDALONE_AGENTS: Agent[] = [
  {
    id: 'prototype-director',
    name: 'Nova',
    role: 'headquarters director',
    model: 'offline-scenario',
    provider: 'in-repository fixture',
    state: 'active',
    riskTier: 'high',
    currentTask: 'Planning the floor 45 expansion',
    completedTasks: 128,
    failedActions: 2,
    toolCount: 5,
  },
  {
    id: 'prototype-engineer',
    name: 'Atlas',
    role: 'world engineer',
    model: 'offline-scenario',
    provider: 'in-repository fixture',
    state: 'active',
    riskTier: 'low',
    currentTask: 'Testing the elevator route',
    completedTasks: 54,
    failedActions: 0,
    toolCount: 3,
  },
  {
    id: 'prototype-artist',
    name: 'Lyra',
    role: 'environment artist',
    model: 'offline-scenario',
    provider: 'in-repository fixture',
    state: 'blocked',
    riskTier: 'medium',
    currentTask: 'Waiting for the first art brief',
    completedTasks: 33,
    failedActions: 1,
    toolCount: 2,
  },
  {
    id: 'prototype-qa',
    name: 'Aegis',
    role: 'quality specialist',
    model: 'offline-scenario',
    provider: 'in-repository fixture',
    state: 'failed',
    riskTier: 'medium',
    currentTask: 'Investigating a simulated door fault',
    completedTasks: 71,
    failedActions: 4,
    toolCount: 4,
  },
  {
    id: 'prototype-archivist',
    name: 'Echo',
    role: 'lore archivist',
    model: 'offline-scenario',
    provider: 'in-repository fixture',
    state: 'idle',
    riskTier: 'low',
    currentTask: null,
    completedTasks: 19,
    failedActions: 0,
    toolCount: 2,
  },
  {
    id: 'prototype-sentry',
    name: 'Sentry',
    role: 'lobby security',
    model: 'offline-scenario',
    provider: 'in-repository fixture',
    state: 'idle',
    riskTier: 'critical',
    currentTask: null,
    completedTasks: 8,
    failedActions: 0,
    toolCount: 1,
  },
]

const STANDALONE_METRICS: HostMetrics = {
  cpu: 34,
  memory: 61,
  memoryUsedGb: 19.5,
  memoryTotalGb: 32,
  disk: 47,
  processes: 284,
}

export function standaloneSnapshot(): WorldSnapshot {
  return {
    status: { ...STANDALONE_STATUS },
    agents: STANDALONE_AGENTS.map((a) => ({ ...a })),
    metrics: { ...STANDALONE_METRICS },
    source: 'standalone',
    fetchedAt: 0,
  }
}

/** Gentle drift so the demo world is not visibly frozen. Deterministic. */
export function driftStandalone(base: WorldSnapshot, tick: number): WorldSnapshot {
  const wave = (phase: number, amp: number) => Math.sin((tick + phase) / 9) * amp
  return {
    ...base,
    metrics: {
      // STANDALONE_METRICS, not base.metrics: metrics are nullable now that a
      // live snapshot can arrive without them, and the standalone world always
      // has a full set.
      ...STANDALONE_METRICS,
      cpu: Math.min(100, Math.max(4, STANDALONE_METRICS.cpu + wave(0, 22))),
      memory: Math.min(100, Math.max(10, STANDALONE_METRICS.memory + wave(4, 7))),
      disk: STANDALONE_METRICS.disk,
    },
  }
}
