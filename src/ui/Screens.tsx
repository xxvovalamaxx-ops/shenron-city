/**
 * Title, loading and pause screens for the Manhattan build.
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
  ['Double-Space', 'Fly / land'],
  ['V', 'First / third person'],
  ['F2', 'Dev tools'],
  ['F3', 'Performance overlay'],
  ['Esc', 'Release cursor / menu'],
]

export function TitleScreen({ onStart }: { onStart(): void }) {
  const snapshot = useGame((s) => s.snapshot)

  return (
    <div className="modal title-backdrop">
      <div className="card title-card">
        <div className="logo-row">
          <span className="title-logo">SHENZHEN</span>
          <span className="title-logo-accent">CITY</span>
        </div>
        <p className="sub">
          A streamed Manhattan after dark. Walk the grid, take in the skyline, and
          make the city yours — thousands of buildings, one island, no limits.
        </p>

        <div className="chip" style={{ display: 'inline-flex', marginBottom: 4 }} role="status">
          <i className="dot standalone" />
          Offline city · {snapshot.agents.length} local characters · no PC connection
        </div>

        <div className="controls">
          {CONTROLS.map(([key, what]) => (
            <div key={key}>
              <span>{key.padEnd(13, ' ')}</span> {what}
            </div>
          ))}
        </div>

        <div className="actions">
          <button className="primary enter-button" onClick={onStart}>
            ENTER MANHATTAN
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
    <div className="modal loading-backdrop">
      <div className="loading-center">
        <div className="loading-logo-wrap">
          <div className="loading-logo" aria-hidden="true">
            <span className="loading-logo-inner">SH</span>
          </div>
        </div>
        <h1 className="loading-title">SHENZHEN CITY</h1>
        <p className="sub">Streaming Manhattan…</p>
        <div className="bar" style={{ height: 4, width: 320 }}>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    </div>
  )
}
