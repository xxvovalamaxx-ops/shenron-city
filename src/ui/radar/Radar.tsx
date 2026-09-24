/**
 * The GTA radar, bottom-left: the real streets around the player, turning
 * with the camera, zooming out with speed, with the GPS line to the map
 * waypoint, nearby traffic, the player's car and a north marker on the rim.
 * Health and armor sit underneath, as in GTA V.
 *
 * Drawn on its own animation frame into a 2D canvas from pre-rendered tiles
 * (`street-atlas.ts`), reading the frame's view from `viewState` — no React
 * re-render per frame.
 */
import { useEffect, useRef } from 'react'
import { rt } from '../../gameplay/runtime'
import { playerMotion } from '../../gameplay/player/player-motion'
import { viewState } from '../../gameplay/player/view-state'
import { useHud } from '../hud-store'
import { useStreetAtlas } from './atlas-store'
import { MAP_COLORS } from './street-atlas'
import { streetDataNow } from './street-data'
import { gps, updateGps } from './gps'
import {
  bearingFromBodyYaw,
  clampToBox,
  northDirection,
  radarScale,
  worldToRadar,
} from './radar-math'
import { drawPlayerArrow, drawWaypoint, ownedVehicle, strokeRoute, trafficNear } from './map-overlays'

export const RADAR_WIDTH = 268
export const RADAR_HEIGHT = 170
/** The player sits below centre, so more of the road ahead is on the radar. */
const PIVOT_Y = 0.62

export function Radar() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const atlas = useStreetAtlas()
  const health = useHud((s) => s.health)
  const armor = useHud((s) => s.armor)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    let raf = 0
    let scale = radarScale(0, false)
    let last = performance.now()
    const traffic: number[] = []

    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = RADAR_WIDTH
      const h = RADAR_HEIGHT
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
      }
      const px = viewState.live ? viewState.x : rt.player.pos.x
      const pz = viewState.live ? viewState.z : rt.player.pos.z
      const heading = viewState.heading
      const target = radarScale(viewState.speed, viewState.driving)
      scale += (target - scale) * (1 - Math.exp(-2.5 * dt))
      const pivotX = w / 2
      const pivotY = h * PIVOT_Y

      // GPS upkeep rides on the radar's frame: it is the only consumer.
      const hud = useHud.getState()
      if (updateGps(streetDataNow(), hud.waypoint, { x: px, z: pz }, viewState.driving, now)) {
        hud.setWaypoint(null)
        hud.showBanner('DESTINATION REACHED', null, { kind: 'info', durationMs: 2600 })
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = MAP_COLORS.water
      ctx.fillRect(0, 0, w, h)

      if (atlas) {
        const view = {
          cx: px,
          cz: pz,
          metresPerPx: scale,
          rotation: -heading,
          width: w,
          height: h,
          pivotX,
          pivotY,
          dpr,
        }
        atlas.draw(ctx, view, atlas.levelFor(dpr / scale))
        atlas.pump(4)

        // World-space overlays share the map transform the atlas just set.
        if (gps.route) strokeRoute(ctx, gps.route.pts, { x: px, z: pz }, scale, 3.6)
        const reach = Math.hypot(w, h) * scale
        trafficNear(px, pz, reach, traffic)
        ctx.fillStyle = 'rgba(214, 222, 230, 0.85)'
        const dot = 2.6 * scale
        for (let i = 0; i < traffic.length; i += 2) {
          ctx.fillRect(traffic[i] - dot / 2, traffic[i + 1] - dot / 2, dot, dot)
        }
      }

      // Screen-space overlays.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const box = { left: pivotX, right: w - pivotX, top: pivotY, bottom: h - pivotY }

      const car = ownedVehicle()
      if (car && !viewState.driving) {
        const o = worldToRadar(car.x - px, car.z - pz, heading)
        const p = clampToBox({ x: o.x / scale, y: o.y / scale }, box, 9)
        ctx.fillStyle = '#4aa3ff'
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.roundRect(pivotX + p.x - 5, pivotY + p.y - 3.5, 10, 7, 2)
        ctx.stroke()
        ctx.fill()
      }

      const wp = hud.waypoint
      if (wp) {
        const o = worldToRadar(wp.x - px, wp.z - pz, heading)
        const p = clampToBox({ x: o.x / scale, y: o.y / scale }, box, 9)
        drawWaypoint(ctx, pivotX + p.x, pivotY + p.y, p.clamped ? 6 : 7)
      }

      // North on the rim.
      const n = northDirection(heading)
      const np = clampToBox({ x: n.x * 1e4, y: n.y * 1e4 }, box, 11)
      ctx.beginPath()
      ctx.arc(pivotX + np.x, pivotY + np.y, 8, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(12, 14, 18, 0.85)'
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.font = '700 10px "Bahnschrift", "DIN Condensed", "Arial Narrow", "Liberation Sans Narrow", "DejaVu Sans", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('N', pivotX + np.x, pivotY + np.y + 0.5)

      // The player: the body's facing on foot, the car's heading when driving.
      const bearing = viewState.driving
        ? Math.atan2(rt.player.forward.x, -rt.player.forward.z)
        : bearingFromBodyYaw(playerMotion.foot.bodyYaw)
      drawPlayerArrow(ctx, pivotX, pivotY, bearing - heading)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [atlas])

  return (
    <div className="radar" aria-label="Radar">
      <div className="radar-frame">
        <canvas ref={canvas} className="radar-canvas" style={{ width: RADAR_WIDTH, height: RADAR_HEIGHT }} />
      </div>
      <div className="radar-bars">
        <div className="radar-bar health" title="Health">
          <i style={{ width: `${health}%` }} />
        </div>
        <div className="radar-bar armor" title="Armor">
          <i style={{ width: `${armor}%` }} />
        </div>
      </div>
    </div>
  )
}
