/**
 * Title, loading and pause screens — GTA5-style pause menu.
 */
import { useEffect, useState } from 'react'
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
  ['Esc', 'Pause menu'],
]

type PauseTab = 'map' | 'game' | 'info' | 'settings' | 'display'
type SettingsSubTab = 'graphics' | 'controls' | 'audio'

const PAUSE_TABS: { id: PauseTab; label: string }[] = [
  { id: 'map', label: 'MAP' },
  { id: 'game', label: 'GAME' },
  { id: 'info', label: 'INFO' },
  { id: 'settings', label: 'SETTINGS' },
  { id: 'display', label: 'DISPLAY' },
]

const SETTINGS_SUBTAB_LABELS: Record<SettingsSubTab, string> = {
  graphics: 'GRAPHICS',
  controls: 'CONTROLS',
  audio: 'AUDIO',
}

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

function MapTab() {
  return (
    <div className="pause-tab-content">
      <div className="pause-map-placeholder">
        <div className="pause-map-grid">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="pause-map-tile" />
          ))}
        </div>
        <div className="pause-map-marker" />
        <p className="pause-map-label">MANHATTAN</p>
      </div>
    </div>
  )
}

function GameTab() {
  return (
    <div className="pause-tab-content">
      <h2 className="pause-section-title">GAME</h2>
      <div className="pause-info-grid">
        <div className="pause-info-row">
          <span className="pause-info-label">Location</span>
          <span className="pause-info-value">Manhattan, New York</span>
        </div>
        <div className="pause-info-row">
          <span className="pause-info-label">Time</span>
          <span className="pause-info-value">Night</span>
        </div>
        <div className="pause-info-row">
          <span className="pause-info-label">Weather</span>
          <span className="pause-info-value">Clear</span>
        </div>
        <div className="pause-info-row">
          <span className="pause-info-label">Status</span>
          <span className="pause-info-value pause-info-active">Online</span>
        </div>
      </div>
    </div>
  )
}

function InfoTab() {
  return (
    <div className="pause-tab-content">
      <h2 className="pause-section-title">INFORMATION</h2>
      <div className="pause-info-grid">
        <div className="pause-info-row">
          <span className="pause-info-label">Engine</span>
          <span className="pause-info-value">Three.js r185</span>
        </div>
        <div className="pause-info-row">
          <span className="pause-info-label">Renderer</span>
          <span className="pause-info-value">WebGL 2</span>
        </div>
        <div className="pause-info-row">
          <span className="pause-info-label">Framework</span>
          <span className="pause-info-value">React Three Fiber</span>
        </div>
        <div className="pause-info-row">
          <span className="pause-info-label">Build</span>
          <span className="pause-info-value">Manhattan</span>
        </div>
      </div>
      <h2 className="pause-section-title" style={{ marginTop: 24 }}>CONTROLS</h2>
      <div className="pause-controls-grid">
        {CONTROLS.map(([key, what]) => (
          <div key={key} className="pause-control-row">
            <span className="pause-control-key">{key}</span>
            <span className="pause-control-desc">{what}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GraphicsSettings({
  settings,
  onChange,
}: {
  settings: Settings
  onChange(next: Settings): void
}) {
  return (
    <div className="pause-settings-page">
      <div className="pause-setting-row">
        <span className="pause-setting-label">Quality Preset</span>
        <div className="pause-setting-seg">
          {(['low', 'medium', 'high'] as QualityPreset[]).map((q) => (
            <button
              key={q}
              className={`pause-seg-btn${settings.quality === q ? ' active' : ''}`}
              onClick={() => onChange({ ...settings, quality: q })}
            >
              {q.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="pause-setting-row">
        <span className="pause-setting-label">Field of View</span>
        <div className="pause-setting-control">
          <input
            type="range"
            className="pause-slider"
            min={60}
            max={100}
            step={1}
            value={settings.fov}
            onChange={(e) => onChange({ ...settings, fov: Number(e.target.value) })}
          />
          <span className="pause-setting-value">{settings.fov}</span>
        </div>
      </div>
    </div>
  )
}

function ControlsSettings({
  settings,
  onChange,
}: {
  settings: Settings
  onChange(next: Settings): void
}) {
  return (
    <div className="pause-settings-page">
      <div className="pause-setting-row">
        <span className="pause-setting-label">Mouse Sensitivity</span>
        <div className="pause-setting-control">
          <input
            type="range"
            className="pause-slider"
            min={0.3}
            max={2.5}
            step={0.05}
            value={settings.sensitivity}
            onChange={(e) => onChange({ ...settings, sensitivity: Number(e.target.value) })}
          />
          <span className="pause-setting-value">{settings.sensitivity.toFixed(2)}</span>
        </div>
      </div>
      <div className="pause-setting-row">
        <span className="pause-setting-label">Invert Y-Axis</span>
        <button className="pause-toggle-btn">OFF</button>
      </div>
    </div>
  )
}

function AudioSettings({
  settings,
  onChange,
}: {
  settings: Settings
  onChange(next: Settings): void
}) {
  return (
    <div className="pause-settings-page">
      <div className="pause-setting-row">
        <span className="pause-setting-label">Master Volume</span>
        <div className="pause-setting-control">
          <input
            type="range"
            className="pause-slider"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => onChange({ ...settings, volume: Number(e.target.value) })}
          />
          <span className="pause-setting-value">{Math.round(settings.volume * 100)}%</span>
        </div>
      </div>
      <div className="pause-setting-row">
        <span className="pause-setting-label">Music</span>
        <div className="pause-setting-control">
          <input type="range" className="pause-slider" min={0} max={1} step={0.05} defaultValue={0.7} />
          <span className="pause-setting-value">70%</span>
        </div>
      </div>
      <div className="pause-setting-row">
        <span className="pause-setting-label">SFX</span>
        <div className="pause-setting-control">
          <input type="range" className="pause-slider" min={0} max={1} step={0.05} defaultValue={0.8} />
          <span className="pause-setting-value">80%</span>
        </div>
      </div>
      <div className="pause-setting-row">
        <span className="pause-setting-label">Ambient</span>
        <div className="pause-setting-control">
          <input type="range" className="pause-slider" min={0} max={1} step={0.05} defaultValue={0.6} />
          <span className="pause-setting-value">60%</span>
        </div>
      </div>
    </div>
  )
}

function SettingsTab({
  settings,
  onChange,
}: {
  settings: Settings
  onChange(next: Settings): void
}) {
  const [subTab, setSubTab] = useState<SettingsSubTab>('graphics')

  return (
    <div className="pause-tab-content">
      <div className="pause-subtabs">
        {(Object.keys(SETTINGS_SUBTAB_LABELS) as SettingsSubTab[]).map((id) => (
          <button
            key={id}
            className={`pause-subtab${subTab === id ? ' active' : ''}`}
            onClick={() => setSubTab(id)}
          >
            {SETTINGS_SUBTAB_LABELS[id]}
          </button>
        ))}
      </div>
      <div className="pause-settings-body">
        {subTab === 'graphics' && <GraphicsSettings settings={settings} onChange={onChange} />}
        {subTab === 'controls' && <ControlsSettings settings={settings} onChange={onChange} />}
        {subTab === 'audio' && <AudioSettings settings={settings} onChange={onChange} />}
      </div>
    </div>
  )
}

function DisplayTab() {
  const showPerf = useHud((s) => s.showPerf)
  const togglePerf = useHud((s) => s.togglePerf)

  return (
    <div className="pause-tab-content">
      <h2 className="pause-section-title">DISPLAY</h2>
      <div className="pause-settings-page">
        <div className="pause-setting-row">
          <span className="pause-setting-label">Performance Overlay</span>
          <button
            className={`pause-toggle-btn${showPerf ? ' active' : ''}`}
            onClick={togglePerf}
          >
            {showPerf ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className="pause-setting-row">
          <span className="pause-setting-label">V-Sync</span>
          <button className="pause-toggle-btn">OFF</button>
        </div>
        <div className="pause-setting-row">
          <span className="pause-setting-label">Motion Blur</span>
          <button className="pause-toggle-btn">OFF</button>
        </div>
        <div className="pause-setting-row">
          <span className="pause-setting-label">Brightness</span>
          <div className="pause-setting-control">
            <input type="range" className="pause-slider" min={0} max={1} step={0.05} defaultValue={0.5} />
            <span className="pause-setting-value">50%</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PauseMenu({
  settings,
  onChange,
  onResume,
  onExit,
}: {
  settings: Settings
  onChange(next: Settings): void
  onResume(): void
  onExit(): void
}) {
  const [activeTab, setActiveTab] = useState<PauseTab>('map')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onResume()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onResume])

  return (
    <div className="pause-overlay">
      <div className="pause-header">
        <div className="pause-title">PAUSED</div>
        <div className="pause-tabs">
          {PAUSE_TABS.map((tab) => (
            <button
              key={tab.id}
              className={`pause-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pause-body">
        {activeTab === 'map' && <MapTab />}
        {activeTab === 'game' && <GameTab />}
        {activeTab === 'info' && <InfoTab />}
        {activeTab === 'settings' && (
          <SettingsTab settings={settings} onChange={onChange} />
        )}
        {activeTab === 'display' && <DisplayTab />}
      </div>
      <div className="pause-footer">
        <button className="pause-resume-btn" onClick={onResume}>
          RESUME
        </button>
        <button className="pause-exit-btn" onClick={onExit}>
          EXIT TO TITLE
        </button>
        <span className="pause-footer-hint">ESC to resume</span>
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
