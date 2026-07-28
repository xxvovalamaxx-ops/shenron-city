/**
 * Title and pause/settings menus for the standalone prototype.
 */
import { useEffect } from 'react'
import { useGame } from '../adapter/store'
import { useHud } from './hud-store'
import type { QualityPreset } from '../world/palette'

export interface Settings {
  quality: QualityPreset
  sensitivity: number
  fov: number
  volume: number
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
  volume: 0.7,
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
  const snapshot = useGame((s) => s.snapshot)

  return (
    <div className="modal">
      <div className="card title-card">
        <h1>Shenron City</h1>
        <p className="sub">
          A standalone Three.js city prototype. Walk Dragon Boulevard, explore the
          night market and Pocket Park, meet the locals, then enter headquarters.
        </p>

        <div
          className="chip"
          style={{ display: 'inline-flex', marginBottom: 4 }}
          role="status"
        >
          <i className="dot standalone" />
          Standalone game · {snapshot.agents.length} fictional residents · no PC connection
        </div>

        <p className="notice safe" style={{ textAlign: 'left' }}>
          This build does not contact Mission Control, your filesystem, local services,
          model providers, telemetry, or any external host.
        </p>

        <div className="controls">
          {CONTROLS.map(([key, what]) => (
            <div key={key}>
              <span>{key.padEnd(9, ' ')}</span> {what}
            </div>
          ))}
        </div>

        <div className="actions">
          <button className="primary" onClick={onStart}>
            Enter Shenron City
          </button>
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
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => onChange({ ...settings, volume: Number(e.target.value) })}
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
        <h1>Shenron City</h1>
        <p className="sub">Lighting the city…</p>
        <div className="bar" style={{ height: 4 }}>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    </div>
  )
}
