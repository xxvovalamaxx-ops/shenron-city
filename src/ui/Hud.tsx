/**
 * The always-on readout.
 *
 * Driven by the 10 Hz HUD store and the adapter, never by the render loop —
 * requestAnimationFrame stops when the window is hidden or minimised, and a
 * monitoring display that silently freezes at stale values is worse than one
 * that admits it is offline.
 */
import { useEffect, useRef, useState } from 'react'
import { useHud } from './hud-store'
import { useGame, type LinkState } from '../adapter/store'
import { rt } from '../gameplay/runtime'

const LINK_TEXT: Record<LinkState, string> = {
  connecting: 'CONNECTING',
  live: 'LIVE',
  degraded: 'DEGRADED — LAST KNOWN',
  unreachable: 'UNREACHABLE — STALE',
  demo: 'DEMO — FIXTURE DATA',
}

function LinkChip() {
  const link = useGame((s) => s.link)
  const cls = link === 'demo' ? 'chip demo' : link === 'unreachable' ? 'chip unreachable' : 'chip'
  return (
    <div className={cls} title="Where the numbers on screen come from">
      <i className={`dot ${link}`} />
      {LINK_TEXT[link]}
    </div>
  )
}

function Telemetry() {
  const snapshot = useGame((s) => s.snapshot)
  if (!snapshot) return null
  const { status, metrics } = snapshot

  return (
    <aside className="telemetry">
      <h2>{status.identity.toUpperCase()}</h2>
      <div className="row">
        <span>MODEL</span>
        <b>{status.model}</b>
      </div>
      <div className="row">
        <span>RUNNING</span>
        <b>{status.runningTasks}</b>
      </div>
      <div className="row">
        <span>DONE / FAIL</span>
        <b>
          {status.completedToday} / {status.failedToday}
        </b>
      </div>
      <div className="row">
        <span>COST TODAY</span>
        <b>${status.costTodayUsd.toFixed(4)}</b>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <span>CPU</span>
        <b>{Math.round(metrics.cpu)}%</b>
      </div>
      <div className="bar">
        <i style={{ width: `${metrics.cpu}%` }} />
      </div>
      <div className="row">
        <span>MEMORY</span>
        <b>{Math.round(metrics.memory)}%</b>
      </div>
      <div className="bar">
        <i style={{ width: `${metrics.memory}%` }} />
      </div>
    </aside>
  )
}

function PerfOverlay() {
  const show = useHud((s) => s.showPerf)
  const [info, setInfo] = useState({ fps: 0, ms: 0, calls: 0, tris: 0, geos: 0 })

  // Sampled on a timer rather than in useFrame, so opening the overlay costs
  // nothing per frame. The numbers come from rt.perf, which the loop fills
  // from the renderer that is actually drawing.
  useEffect(() => {
    if (!show) return
    const id = setInterval(() => {
      const p = rt.perf
      setInfo({
        fps: Math.round(p.fps),
        ms: Math.round(p.frameMs * 10) / 10,
        calls: p.calls,
        tris: p.triangles,
        geos: p.geometries,
      })
    }, 400)
    return () => clearInterval(id)
  }, [show])

  if (!show) return null
  const slow = info.fps > 0 && info.fps < 50

  return (
    <div className="perf">
      <div>
        FPS <b className={slow ? 'warn' : ''}>{info.fps}</b> · frame{' '}
        <b className={slow ? 'warn' : ''}>{info.ms} ms</b>
      </div>
      <div>
        draw calls <b>{info.calls}</b> · tris <b>{info.tris.toLocaleString()}</b> · geos{' '}
        <b>{info.geos}</b>
      </div>
      <div style={{ opacity: 0.6 }}>F3 to hide</div>
    </div>
  )
}

export function Hud() {
  const prompt = useHud((s) => s.promptLabel)
  const floor = useHud((s) => s.floorLabel)
  const phase = useHud((s) => s.elevatorPhase)
  const logRef = useRef<HTMLDivElement>(null)

  return (
    <div className="overlay" ref={logRef}>
      <div className="status-strip">
        <LinkChip />
      </div>

      <Telemetry />

      <div className={`crosshair${prompt ? ' hot' : ''}`} />

      {prompt && (
        <div className="prompt">
          <span className="key">E</span>
          {prompt}
        </div>
      )}

      <div className="floor">
        <span>FLOOR</span>
        <b>{floor}</b>
        <span>{phase === 'travelling' ? 'IN TRANSIT' : phase.toUpperCase()}</span>
      </div>

      <PerfOverlay />
    </div>
  )
}
