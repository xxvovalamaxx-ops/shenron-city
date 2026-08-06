/**
 * Dev tools overlay (F2).
 *
 * Everything here mutates either rt (position, clock, speeds) or the dev
 * spawn store, so the game loop picks it up on the next frame. The menu itself
 * is plain DOM on top of the canvas and does not steal pointer lock on open.
 */
import { useState } from 'react'
import { rt } from '../gameplay/runtime'
import { useHud } from './hud-store'
import {
  DEV_SPAWN_CATALOG,
  useDevSpawns,
} from '../gameplay/dev-spawns'
import { MANHATTAN_LANDMARKS, manhattanCollision, resolveManhattanSpawn } from '../world/manhattan-collision'
import { cityAudio } from '../audio'

function teleport(x: number, z: number): void {
  const ground = manhattanCollision.groundHeightAt(x, z) ?? 12.4
  rt.player.pos.x = x
  rt.player.pos.y = ground
  rt.player.pos.z = z
  rt.player.velocityY = 0
  rt.player.flying = false
  rt.player.grounded = true
}

export function DevMenu() {
  const open = useHud((s) => s.devToolsOpen)
  const spawns = useDevSpawns((s) => s.spawns)
  const [fly, setFly] = useState(rt.player.flying)
  const [speed, setSpeed] = useState(rt.devSpeed)
  const [hour, setHour] = useState(Math.round(rt.clock.hour * 10) / 10)

  if (!open) return null

  return (
    <div className="dev-menu">
      <div className="dev-menu-head">
        <b>DEV TOOLS</b>
        <span>
          {Math.round(rt.player.pos.x)} {Math.round(rt.player.pos.y)}{' '}
          {Math.round(rt.player.pos.z)} · F2 close
        </span>
      </div>

      <div className="dev-menu-section">
        <div className="dev-menu-title">Teleport</div>
        <div className="dev-menu-grid">
          {MANHATTAN_LANDMARKS.map((landmark) => (
            <button key={landmark.id} className="small" onClick={() => teleport(landmark.x, landmark.z)}>
              {landmark.label}
            </button>
          ))}
          <button className="small" onClick={() => {
            const p = resolveManhattanSpawn()
            teleport(p.x, p.z)
          }}>
            Respawn
          </button>
        </div>
      </div>

      <div className="dev-menu-section">
        <div className="dev-menu-title">Spawn (in front of you)</div>
        <div className="dev-menu-grid">
          {DEV_SPAWN_CATALOG.map((entry, i) => (
            <button key={entry.url} className="small" onClick={() => useDevSpawns.getState().addSpawn(i)}>
              {entry.label}
            </button>
          ))}
          <button className="small" onClick={() => useDevSpawns.getState().clearSpawns()}>
            Clear ({spawns.length})
          </button>
        </div>
      </div>

      <div className="dev-menu-section">
        <div className="dev-menu-title">World</div>
        <label className="dev-menu-row">
          <span>Fly mode</span>
          <button
            className={`small ${fly ? 'on' : ''}`}
            onClick={() => {
              rt.player.flying = !rt.player.flying
              setFly(rt.player.flying)
              rt.player.velocityY = 0
            }}
          >
            {fly ? 'ON' : 'OFF'}
          </button>
        </label>
        <label className="dev-menu-row">
          <span>Speed ×{speed.toFixed(1)}</span>
          <input
            type="range"
            min={0.2}
            max={6}
            step={0.1}
            value={speed}
            onChange={(e) => {
              const value = Number(e.target.value)
              rt.devSpeed = value
              setSpeed(value)
            }}
          />
        </label>
        <label className="dev-menu-row">
          <span>Time {hour.toFixed(1)}h</span>
          <input
            type="range"
            min={0}
            max={24}
            step={0.1}
            value={hour}
            onChange={(e) => {
              const value = Number(e.target.value)
              rt.clock.hour = value
              setHour(value)
            }}
          />
        </label>
        <label className="dev-menu-row">
          <span>Rain {Math.round(rt.clock.rainTarget * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={rt.clock.rainTarget}
            onChange={(e) => {
              const value = Number(e.target.value)
              rt.clock.rainTarget = value
              rt.clock.weather = { rain: value, wetness: value >= 0.5 ? 1 : 0 }
            }}
          />
        </label>
        <label className="dev-menu-row">
          <span>Volume {Math.round(cityAudio.getMasterVolume() * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cityAudio.getMasterVolume()}
            onChange={(e) => cityAudio.setMasterVolume(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="dev-menu-section">
        <div className="dev-menu-title">Camera</div>
        <label className="dev-menu-row">
          <span>Third person (V)</span>
          <button className={`small ${useHud.getState().thirdPerson ? 'on' : ''}`} onClick={() => useHud.getState().toggleThirdPerson()}>
            {useHud.getState().thirdPerson ? 'ON' : 'OFF'}
          </button>
        </label>
      </div>
    </div>
  )
}
