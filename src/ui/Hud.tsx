/**
 * The always-on readout for the Manhattan build.
 *
 * FPS + draw-call stats, player position, camera mode, the dev-tools hint,
 * and the city-life readout (tiles, LOD, traffic, crowds, props, sky) fed by
 * the ported engine through the cityHud handle.
 */
import { useEffect, useState } from 'react'
import { useHud } from './hud-store'
import { cityHud } from '../city/city-hud.js'
import { cityWorld } from '../city/registry.js'

export function Hud() {
  const showPerf = useHud((s) => s.showPerf)
  const thirdPerson = useHud((s) => s.thirdPerson)
  const mapX = useHud((s) => s.mapPlayerX)
  const mapZ = useHud((s) => s.mapPlayerZ)
  const heading = useHud((s) => s.mapHeading)
  const promptLabel = useHud((s) => s.promptLabel)
  const vehicleSpeedKmh = useHud((s) => s.vehicleSpeedKmh)

  return (
    <div className="overlay">
      <div className="status-strip">
        <div className="chip" title="This build uses only local game data">
          <i className="dot standalone" />
          SHENZHEN CITY · MANHATTAN
        </div>
        <div className="chip">
          {thirdPerson ? 'THIRD PERSON · V' : 'FIRST PERSON · V'}
        </div>
        {vehicleSpeedKmh > 0 && (
          <div className="chip speed">{vehicleSpeedKmh} km/h</div>
        )}
        <div className="chip">
          {mapX}, {mapZ} · {heading}°
        </div>
        <div className="chip">F2 DEV TOOLS</div>
      </div>

      {promptLabel && <div className="prompt">{promptLabel}</div>}

      {showPerf && <PerfPanel />}
    </div>
  )
}

function PerfPanel() {
  const perf = useHud((s) => s)
  const [, setTick] = useState(0)

  // The engine writes cityHud at ~2 Hz; poll it at the same cadence rather
  // than re-rendering sixty times a second.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500)
    return () => clearInterval(id)
  }, [])

  return (
    <aside className="perf" aria-live="off">
      <b>
        {perf.fps} FPS · {perf.frameMs} ms
      </b>
      {cityWorld.ready && (
        <>
          <span>{cityHud.tiles}</span>
          <span>{cityHud.lod}</span>
          <span>{cityHud.cars}</span>
          <span>{cityHud.peds}</span>
          <span>{cityHud.props} props drawn</span>
          <span>{cityHud.sky}</span>
          <span>{cityHud.where}</span>
        </>
      )}
      <span>Double-Space to fly · Shift to sprint · Esc to pause</span>
    </aside>
  )
}
