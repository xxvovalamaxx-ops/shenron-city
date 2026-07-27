/**
 * Inspecting an agent from inside its office.
 *
 * Exposes exactly one Mission Control interaction: re-reading the agent's
 * record. That is deliberately the least consequential thing available — the
 * slice proves the round trip works without giving the world the power to
 * change anything. Anything that mutates state gets an approval flow of its
 * own before it ships, not a button next to a read.
 */
import { useState } from 'react'
import { useGame } from '../adapter/store'
import { useHud } from './hud-store'
import { STATE_COLOR, STATE_LABEL } from '../world/palette'
import type { Agent } from '../contracts/mission-control'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

export function OfficePanel({ agentId }: { agentId: string }) {
  const setScreen = useHud((s) => s.setScreen)
  const snapshot = useGame((s) => s.snapshot)
  const link = useGame((s) => s.link)
  const requestSummary = useGame((s) => s.requestSummary)

  const [refreshed, setRefreshed] = useState<Agent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agent = refreshed ?? snapshot?.agents.find((a) => a.id === agentId) ?? null
  const isDemo = snapshot?.source === 'demo'
  const close = () => {
    useHud.setState({ openAgentId: null })
    setScreen('playing')
  }

  const onSummary = async () => {
    setBusy(true)
    setError(null)
    try {
      const fresh = await requestSummary(agentId)
      if (fresh) setRefreshed(fresh)
      else setError('Mission Control did not return a record for this agent.')
    } catch {
      setError('The request to Mission Control failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal"
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
    >
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 21 }}>{agent?.name ?? agentId}</h1>
            <div style={{ color: 'var(--dimmer)', fontSize: 12, marginTop: 4 }}>
              {agent?.role ?? 'unknown role'}
            </div>
          </div>
          {agent && (
            <span className="badge" style={{ color: STATE_COLOR[agent.state] }}>
              {STATE_LABEL[agent.state]}
            </span>
          )}
        </div>

        {agent ? (
          <dl className="kv">
            <Field label="ID">{agent.id}</Field>
            <Field label="MODEL">{agent.model}</Field>
            <Field label="PROVIDER">{agent.provider}</Field>
            <Field label="CURRENT TASK">{agent.currentTask ?? '—'}</Field>
            <Field label="RISK TIER">{agent.riskTier}</Field>
            <Field label="TOOLS">{agent.toolCount}</Field>
            <Field label="COMPLETED">{agent.completedTasks}</Field>
            <Field label="FAILED ACTIONS">{agent.failedActions}</Field>
          </dl>
        ) : (
          <p style={{ color: 'var(--dim)' }}>
            No record for this agent in the current snapshot.
          </p>
        )}

        {isDemo && (
          <p className="notice">
            This is fixture data. Nothing shown here reflects your real system, and the
            action below reads from the fixtures rather than from Mission Control.
          </p>
        )}

        {link === 'unreachable' && !isDemo && (
          <p className="notice">
            Mission Control is unreachable. This is the last snapshot received, not the
            current state.
          </p>
        )}

        <p className="notice safe">
          Read-only. This panel can request a status summary; it cannot start, stop,
          pause or approve anything. Actions that change state will require explicit
          approval outside NPC dialogue.
        </p>

        {error && <p className="notice">{error}</p>}

        <div className="actions" style={{ marginTop: 20, justifyContent: 'flex-start' }}>
          <button className="primary" onClick={onSummary} disabled={busy}>
            {busy ? 'Requesting…' : 'Request status summary'}
          </button>
          <button className="ghost" onClick={close}>
            Close · Esc
          </button>
        </div>

        {refreshed && (
          <p style={{ color: 'var(--dim)', fontSize: 12, marginTop: 12 }}>
            Re-read from {isDemo ? 'fixtures' : 'Mission Control'}.
          </p>
        )}
      </div>
    </div>
  )
}
