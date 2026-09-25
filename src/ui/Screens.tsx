/**
 * Title, loading and pause screens, GTA-style.
 *
 * The pause menu is GTA's: a full-screen panel with a header, tabs (MAP and
 * SETTINGS) and a key-hint bar. The map tab is the island with the GPS
 * waypoint (see radar/PauseMap.tsx); settings are unchanged.
 */
import { useEffect, useState } from 'react'
import { useGame } from '../adapter/store'
import { useHud } from './hud-store'
import type { QualityPreset } from '../world/palette'
import { PauseMap } from './radar/PauseMap'
import { rt } from '../gameplay/runtime'
import { formatClock, formatMoney } from './radar/radar-math'

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
  ['Right mouse', 'Aim'],
  ['E', 'Enter / exit vehicle'],
  ['V', 'First / third person'],
  ['Double-Space', 'Fly / land'],
  ['Esc', 'Pause · map'],
  ['F2 · F3', 'Dev tools · performance'],
]

function Wordmark({ size = 'large' }: { size?: 'large' | 'small' }) {
  return (
    <div className={`gta-wordmark ${size}`} aria-label="Shenzhen City">
      <span className="gta-wordmark-top">SHENZHEN</span>
      <span className="gta-wordmark-bottom">CITY</span>
    </div>
  )
}

export function TitleScreen({ onStart }: { onStart(): void }) {
  const snapshot = useGame((s) => s.snapshot)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') onStart()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStart])

  return (
    <div className="modal title-backdrop gta-title">
      <div className="title-card">
        <Wordmark />
        <p className="sub">
          A streamed Manhattan, street by street. Walk the avenues, take a car,
          set a waypoint and make the city yours.
        </p>

        <div className="gta-controls">
          {CONTROLS.map(([key, what]) => (
            <div key={key}>
              <kbd className="gta-key">{key}</kbd>
              <span>{what}</span>
            </div>
          ))}
        </div>

        <div className="actions">
          <button className="primary enter-button" onClick={onStart}>
            ENTER MANHATTAN
          </button>
        </div>
        <div className="gta-title-foot" role="status">
          Offline city · {snapshot.agents.length} local characters · no PC connection
        </div>
      </div>
    </div>
  )
}

type PauseTab = 'map' | 'settings'

export function PauseMenu({
  settings,
  onChange,
  onResume,
}: {
  settings: Settings
  onChange(next: Settings): void
  onResume(): void
}) {
  const [tab, setTab] = useState<PauseTab>('map')
  const money = useHud((s) => s.money)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') onResume()
      if (e.code === 'KeyQ' || e.code === 'KeyE') setTab((t) => (t === 'map' ? 'settings' : 'map'))
      if (e.code === 'KeyM') setTab('map')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResume])

  return (
    <div className="modal gta-pause">
      <header className="gta-pause-head">
        <Wordmark size="small" />
        <div className="gta-pause-meta">
          <span>{formatClock(rt.clock.hour)}</span>
          <span className="gta-pause-money">{formatMoney(money)}</span>
        </div>
      </header>
      <nav className="gta-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'map'} className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>
          MAP
        </button>
        <button
          role="tab"
          aria-selected={tab === 'settings'}
          className={tab === 'settings' ? 'on' : ''}
          onClick={() => setTab('settings')}
        >
          SETTINGS
        </button>
      </nav>

      <section className="gta-pause-body">
        {tab === 'map' ? <PauseMap /> : <SettingsPanel settings={settings} onChange={onChange} />}
      </section>

      <footer className="gta-pause-foot">
        <button className="gta-resume" onClick={onResume}>
          <kbd className="gta-key">Esc</kbd> Resume
        </button>
        {tab === 'map' ? (
          <span className="gta-hints">
            <kbd className="gta-key">Click</kbd> Set waypoint <kbd className="gta-key">Right click</kbd> Clear{' '}
            <kbd className="gta-key">Scroll</kbd> Zoom <kbd className="gta-key">Drag</kbd> Pan{' '}
            <kbd className="gta-key">Q</kbd> Settings
          </span>
        ) : (
          <span className="gta-hints">
            <kbd className="gta-key">Q</kbd> Map
          </span>
        )}
      </footer>
    </div>
  )
}

function SettingsPanel({ settings, onChange }: { settings: Settings; onChange(next: Settings): void }) {
  const showPerf = useHud((s) => s.showPerf)
  const togglePerf = useHud((s) => s.togglePerf)
  return (
    <div className="gta-settings">
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
    </div>
  )
}

export function LoadingScreen({ progress }: { progress: number }) {
  return (
    <div className="modal loading-backdrop gta-loading">
      <div className="loading-center">
        <Wordmark />
        <p className="sub">Streaming Manhattan…</p>
        <div className="bar gta-loading-bar">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    </div>
  )
}
