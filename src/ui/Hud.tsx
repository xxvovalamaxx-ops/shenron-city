/**
 * The always-on readout for the Manhattan build.
 *
 * FPS + draw-call stats, player position, camera mode and the dev-tools hint.
 * Driven by the HUD store, written at ~10 Hz by the game loop.
 */
import { useHud } from './hud-store'

export function Hud() {
  const showPerf = useHud((s) => s.showPerf)
  const thirdPerson = useHud((s) => s.thirdPerson)
  const mapX = useHud((s) => s.mapPlayerX)
  const mapZ = useHud((s) => s.mapPlayerZ)
  const heading = useHud((s) => s.mapHeading)
  const promptLabel = useHud((s) => s.promptLabel)

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
  return (
    <aside className="perf" aria-live="off">
      <b>
        {perf.fps} FPS · {perf.frameMs} ms
      </b>
      <span>Double-Space to fly · Shift to sprint · Esc to pause</span>
    </aside>
  )
}
