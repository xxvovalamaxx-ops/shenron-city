/**
 * The always-on readout.
 *
 * Driven by the HUD store and the local standalone scenario, never by a host
 * telemetry or Mission Control connection.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useHud } from './hud-store'
import { useGame } from '../adapter/store'
import { rt } from '../gameplay/runtime'
import {
  CITY_TOUR_STEPS,
  cityTourProgress,
  currentCityTourStep,
} from '../gameplay/city-tour'
import { minimapPoint, minimapRect, type MinimapBox } from '../gameplay/minimap'
import { BOULEVARD, MARKET_STALLS, STOREFRONTS } from '../world/city-data'
import { TOWER } from '../world/layout'

function LinkChip() {
  return (
    <div className="chip" title="This build uses only local game scenario data">
      <i className="dot standalone" />
      STANDALONE GAME
    </div>
  )
}

function Telemetry() {
  const snapshot = useGame((s) => s.snapshot)
  if (!snapshot) return null
  const { status, agents } = snapshot
  const active = agents.filter((agent) => agent.state === 'active').length
  const blocked = agents.filter((agent) => agent.state === 'blocked').length
  const incidents = agents.filter((agent) => agent.state === 'failed').length

  return (
    <aside className="telemetry">
      <h2>{status.identity.toUpperCase()}</h2>
      <div className="row">
        <span>RESIDENTS</span>
        <b>{agents.length}</b>
      </div>
      <div className="row">
        <span>ACTIVE</span>
        <b>{active}</b>
      </div>
      <div className="row">
        <span>WAITING</span>
        <b>{blocked}</b>
      </div>
      <div className="row">
        <span>INCIDENTS</span>
        <b>{incidents}</b>
      </div>
    </aside>
  )
}

function CityTour() {
  const state = useHud((s) => s.cityTour)
  const bearing = useHud((s) => s.tourBearing)
  const distance = useHud((s) => s.tourDistance)
  const step = currentCityTourStep(state)
  const complete = step === null
  const progress = Math.round(cityTourProgress(state) * 100)

  return (
    <aside className={`city-tour${complete ? ' complete' : ''}`} aria-live="polite">
      <div className="city-tour-heading">
        <span>CITY TOUR</span>
        <b>
          {state.completed}/{CITY_TOUR_STEPS.length}
        </b>
      </div>
      <div className="bar">
        <i style={{ width: `${progress}%` }} />
      </div>
      {step ? (
        <>
          <strong>{step.title}</strong>
          <p>{step.hint}</p>
          {bearing !== null && distance !== null && (
            <div className="city-tour-nav" aria-label={`Objective ${distance} metres away`}>
              <i
                className="city-tour-arrow"
                aria-hidden="true"
                style={{ transform: `rotate(${bearing}deg)` }}
              >
                ↑
              </i>
              <span>{distance} m</span>
            </div>
          )}
        </>
      ) : (
        <>
          <strong>Route complete</strong>
          <p>You met the city and reached the headquarters team.</p>
        </>
      )}
    </aside>
  )
}

function mapRectStyle(box: MinimapBox): CSSProperties {
  const rect = minimapRect(box)
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  }
}

const HQ_MAP_BOX = {
  x: 0,
  z: -TOWER.depth / 2,
  width: TOWER.halfWidth * 2,
  depth: TOWER.depth,
} as const

function Minimap() {
  const x = useHud((s) => s.mapPlayerX)
  const z = useHud((s) => s.mapPlayerZ)
  const heading = useHud((s) => s.mapHeading)
  const targetX = useHud((s) => s.mapTargetX)
  const targetZ = useHud((s) => s.mapTargetZ)
  const player = minimapPoint({ x, z })
  const target =
    targetX === null || targetZ === null ? null : minimapPoint({ x: targetX, z: targetZ })

  return (
    <aside className="minimap" aria-label={`City map. Player at ${x}, ${z}. North is up.`}>
      <header>
        <span>CITY MAP</span>
        <b>N ↑</b>
      </header>
      <div className="minimap-field" role="img" aria-label="Shenron City district minimap">
        <i className="minimap-road" style={mapRectStyle(BOULEVARD)} />
        <i className="minimap-hq" style={mapRectStyle(HQ_MAP_BOX)} title="Shenron headquarters" />
        {STOREFRONTS.map((store) => (
          <i
            key={store.id}
            className="minimap-building"
            style={mapRectStyle(store)}
            title={store.name}
          />
        ))}
        {MARKET_STALLS.map((stall) => (
          <i
            key={stall.id}
            className="minimap-market"
            style={mapRectStyle(stall)}
            title={stall.name}
          />
        ))}
        {target && (
          <i
            className={`minimap-target${target.clamped ? ' clamped' : ''}`}
            style={{ left: `${target.left}%`, top: `${target.top}%` }}
            title="Current City Tour objective"
          />
        )}
        <i
          className={`minimap-player${player.clamped ? ' clamped' : ''}`}
          style={{ left: `${player.left}%`, top: `${player.top}%` }}
          title="You"
        >
          <b style={{ transform: `rotate(${heading}deg)` }}>▲</b>
        </i>
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
      <CityTour />
      <Minimap />

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
