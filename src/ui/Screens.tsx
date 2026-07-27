/**
 * Title, connection choice, and the pause/settings menu.
 *
 * The connection choice is a real decision the player makes, not a silent
 * fallback: if Mission Control is unreachable the game says so and offers demo
 * mode explicitly. A world that quietly starts showing fiction when the backend
 * dies is the failure this whole design is built to avoid.
 */
import { useEffect } from 'react'
import { useGame } from '../adapter/store'
import { useHud } from './hud-store'
import type { QualityPreset } from '../world/palette'

export interface Settings {
  quality: QualityPreset
  sensitivity: number
  fov: number
}

/**
 * `?quality=low|medium|high` overrides the default preset. Used for measuring
 * each preset on the target machine, and as an escape hatch when a driver
 * chokes on postprocessing.
 */
function initialQuality(): QualityPreset {
  const q = new URLSearchParams(location.search).get('quality')
  return q === 'low' || q === 'medium' || q === 'high' ? q : 'high'
}

export const DEFAULT_SETTINGS: Settings = {
  quality: initialQuality(),
  sensitivity: 1,
  fov: 72,
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'Move'],
  ['Mouse', 'Look'],
  ['Shift', 'Sprint'],
  ['Space', 'Jump'],
  ['E', 'Interact'],
  ['Esc', 'Release cursor / menu'],
  ['F3', 'Performance overlay'],
]

export function TitleScreen({ onStart }: { onStart(): void }) {
  const link = useGame((s) => s.link)
  const enterDemo = useGame((s) => s.enterDemoMode)
  const retry = useGame((s) => s.retryLive)
  const snapshot = useGame((s) => s.snapshot)

  const connected = link === 'live' || link === 'degraded'
  const unreachable = link === 'unreachable'

  return (
    <div className="modal">
      <div className="card title-card">
        <h1>Shenron AI Headquarters</h1>
        <p className="sub">
          A spatial interface to Mission Control. Walk in, ask reception what your system
          is doing, take the lift to 45, and look your agents in the eye.
        </p>

        <div
          className="chip"
          style={{ display: 'inline-flex', marginBottom: 4 }}
          role="status"
        >
          <i className={`dot ${link}`} />
          {link === 'connecting' && 'Connecting to Mission Control…'}
          {connected && `Connected · ${snapshot?.agents.length ?? 0} agents`}
          {link === 'demo' && 'Demo mode · fixture data'}
          {unreachable && 'Mission Control unreachable'}
        </div>

        {unreachable && (
          <p className="notice" style={{ textAlign: 'left' }}>
            Nothing is listening on <code>127.0.0.1:9120</code>. Start the backend with{' '}
            <code>python backend/server.py</code>, or continue in demo mode — everything
            you see will then be clearly-labelled fixture data, not your system.
          </p>
        )}

        <div className="controls">
          {CONTROLS.map(([key, what]) => (
            <div key={key}>
              <span>{key.padEnd(9, ' ')}</span> {what}
            </div>
          ))}
        </div>

        <div className="actions">
          <button className="primary" onClick={onStart} disabled={link === 'connecting'}>
            {connected ? 'Enter — live data' : link === 'demo' ? 'Enter — demo' : 'Enter'}
          </button>
          {unreachable && (
            <>
              <button onClick={retry}>Retry connection</button>
              <button className="ghost" onClick={enterDemo}>
                Use demo data
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function PauseMenu({
  settings,
  onChange,
  onResume,
}: {
  settings: Settings
  onChange(next: Settings): void
  onResume(): void
}) {
  const showPerf = useHud((s) => s.showPerf)
  const togglePerf = useHud((s) => s.togglePerf)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onResume()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResume])

  return (
    <div className="modal">
      <div className="card">
        <h1 style={{ margin: '0 0 18px', fontSize: 21 }}>Paused</h1>

        <div className="setting">
          <span>Quality</span>
          <div className="seg">
            {(['low', 'medium', 'high'] as QualityPreset[]).map((q) => (
              <button
                key={q}
                className={`small ${settings.quality === q ? 'on' : ''}`}
                onClick={() => onChange({ ...settings, quality: q })}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <span>Mouse sensitivity</span>
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.05}
            value={settings.sensitivity}
            onChange={(e) => onChange({ ...settings, sensitivity: Number(e.target.value) })}
          />
        </div>

        <div className="setting">
          <span>Field of view</span>
          <input
            type="range"
            min={60}
            max={100}
            step={1}
            value={settings.fov}
            onChange={(e) => onChange({ ...settings, fov: Number(e.target.value) })}
          />
        </div>

        <div className="setting">
          <span>Performance overlay</span>
          <button className={`small ${showPerf ? 'on' : ''}`} onClick={togglePerf}>
            {showPerf ? 'On' : 'Off'} · F3
          </button>
        </div>

        <div className="actions" style={{ marginTop: 22 }}>
          <button className="primary" onClick={onResume}>
            Resume
          </button>
        </div>
      </div>
    </div>
  )
}

export function LoadingScreen({ progress }: { progress: number }) {
  return (
    <div className="modal">
      <div className="card title-card">
        <h1>Shenron AI Headquarters</h1>
        <p className="sub">Building the world…</p>
        <div className="bar" style={{ height: 4 }}>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    </div>
  )
}
