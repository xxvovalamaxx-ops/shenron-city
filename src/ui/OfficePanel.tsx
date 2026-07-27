/**
 * Inspecting an agent from inside its office.
 *
 * Reads only the in-repository standalone scenario. It has no adapter to the
 * host computer or Mission Control.
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

export function OfficePanel({ agentId, onClose }: { agentId: string; onClose(): void }) {
  const snapshot = useGame((s) => s.snapshot)
  const requestSummary = useGame((s) => s.requestSummary)

  const [refreshed, setRefreshed] = useState<Agent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agent = refreshed ?? snapshot?.agents.find((a) => a.id === agentId) ?? null
  const close = () => {
    useHud.setState({ openAgentId: null })
    onClose()
  }

  const onSummary = async () => {
    setBusy(true)
    setError(null)
    try {
      const fresh = await requestSummary(agentId)
      if (fresh) setRefreshed(fresh)
      else setError('The local scenario has no record for this resident.')
    } catch {
      setError('The local scenario could not refresh this resident.')
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
            <Field label="CURRENT ACTIVITY">{agent.currentTask ?? '—'}</Field>
            <Field label="SCENARIO STATUS">{STATE_LABEL[agent.state]}</Field>
            <Field label="COMPLETED BEATS">{agent.completedTasks}</Field>
            <Field label="INCIDENTS">{agent.failedActions}</Field>
          </dl>
        ) : (
          <p style={{ color: 'var(--dim)' }}>
            No record for this agent in the current snapshot.
          </p>
        )}

        <p className="notice safe">
          Standalone game data. This panel cannot contact Mission Control, read your
          computer, execute commands, or reach a model provider.
        </p>

        {error && <p className="notice">{error}</p>}

        <div className="actions" style={{ marginTop: 20, justifyContent: 'flex-start' }}>
          <button className="primary" onClick={onSummary} disabled={busy}>
            {busy ? 'Refreshing…' : 'Refresh local profile'}
          </button>
          <button className="ghost" onClick={close}>
            Close · Esc
          </button>
        </div>

        {refreshed && (
          <p style={{ color: 'var(--dim)', fontSize: 12, marginTop: 12 }}>
            Refreshed from the in-repository game scenario.
          </p>
        )}
      </div>
    </div>
  )
}
