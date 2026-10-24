/**
 * The pause-menu map: the whole island from the same pre-rendered street
 * tiles as the radar, north up. Drag to pan, scroll to zoom, click to drop a
 * waypoint (click it again, or right-click, to clear). The GPS route to the
 * waypoint is drawn here and on the radar.
 */
import { useEffect, useRef, useState } from 'react'
import { rt } from '../../gameplay/runtime'
import { playerMotion } from '../../gameplay/player/player-motion'
import { viewState } from '../../gameplay/player/view-state'
import { useHud } from '../hud-store'
import { useStreetAtlas } from './atlas-store'
import { MAP_COLORS } from './street-atlas'
import { nearestStreet, streetDataNow } from './street-data'
import { gps, updateGps } from './gps'
import { bearingFromBodyYaw, formatDistance, titleCase } from './radar-math'
import { drawPlayerArrow, drawWaypoint, strokeRoute } from './map-overlays'

const MIN_MPP = 0.4
const MAX_MPP = 18

export function PauseMap() {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const atlas = useStreetAtlas()
  const waypoint = useHud((s) => s.waypoint)
  const view = useRef({ cx: rt.player.pos.x, cz: rt.player.pos.z, mpp: 3 })
  const [hover, setHover] = useState<string | null>(null)
  const [routeLength, setRouteLength] = useState<number | null>(null)

  useEffect(() => {
    const el = canvas.current
    const box = host.current
    if (!el || !box) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    let raf = 0
    let shownLength: number | null = null

    const frame = () => {
      raf = requestAnimationFrame(frame)
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = box.clientWidth
      const h = box.clientHeight
      if (w === 0 || h === 0) return
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr)
        el.height = Math.round(h * dpr)
      }
      const v = view.current
      const hud = useHud.getState()
      const player = { x: rt.player.pos.x, z: rt.player.pos.z }
      updateGps(streetDataNow(), hud.waypoint, player, viewState.driving, performance.now())
      const length = gps.route ? Math.round(gps.route.length / 10) * 10 : null
      if (length !== shownLength) {
        shownLength = length
        setRouteLength(length)
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = MAP_COLORS.water
      ctx.fillRect(0, 0, w, h)
      if (atlas) {
        atlas.draw(
          ctx,
          { cx: v.cx, cz: v.cz, metresPerPx: v.mpp, rotation: 0, width: w, height: h, pivotX: w / 2, pivotY: h / 2, dpr },
          atlas.levelFor(dpr / v.mpp),
        )
        atlas.pump(10)
        if (gps.route) strokeRoute(ctx, gps.route.pts, player, v.mpp, 4)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const toScreen = (x: number, z: number) => ({ x: w / 2 + (x - v.cx) / v.mpp, y: h / 2 + (z - v.cz) / v.mpp })
      if (hud.waypoint) {
        const p = toScreen(hud.waypoint.x, hud.waypoint.z)
        drawWaypoint(ctx, p.x, p.y, 9)
      }
      const me = toScreen(player.x, player.z)
      const bearing = viewState.driving
        ? Math.atan2(rt.player.forward.x, -rt.player.forward.z)
        : bearingFromBodyYaw(playerMotion.foot.bodyYaw)
      drawPlayerArrow(ctx, me.x, me.y, bearing, 11)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [atlas])

  // Pan, zoom, click.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    let drag: { x: number; y: number; cx: number; cz: number; moved: number } | null = null

    const worldAt = (event: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const v = view.current
      return {
        x: v.cx + (event.clientX - rect.left - rect.width / 2) * v.mpp,
        z: v.cz + (event.clientY - rect.top - rect.height / 2) * v.mpp,
      }
    }
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      drag = { x: event.clientX, y: event.clientY, cx: view.current.cx, cz: view.current.cz, moved: 0 }
      try {
        el.setPointerCapture(event.pointerId)
      } catch {
        // convenience only
      }
    }
    const onMove = (event: PointerEvent) => {
      if (drag) {
        const dx = event.clientX - drag.x
        const dy = event.clientY - drag.y
        drag.moved = Math.max(drag.moved, Math.hypot(dx, dy))
        view.current.cx = drag.cx - dx * view.current.mpp
        view.current.cz = drag.cz - dy * view.current.mpp
        return
      }
      const data = streetDataNow()
      if (!data) return
      const p = worldAt(event)
      const street = nearestStreet(data, p.x, p.z, 30 * Math.max(1, view.current.mpp))
      setHover(street ? titleCase(street.name) : null)
    }
    const onUp = (event: PointerEvent) => {
      if (!drag || event.button !== 0) return
      const click = drag.moved < 5
      drag = null
      if (!click) return
      const p = worldAt(event)
      const hud = useHud.getState()
      const wp = hud.waypoint
      const rect = el.getBoundingClientRect()
      if (wp) {
        const sx = rect.width / 2 + (wp.x - view.current.cx) / view.current.mpp
        const sy = rect.height / 2 + (wp.z - view.current.cz) / view.current.mpp
        if (Math.hypot(sx - (event.clientX - rect.left), sy - (event.clientY - rect.top)) < 14) {
          hud.setWaypoint(null)
          return
        }
      }
      hud.setWaypoint(p)
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const before = worldAt(event)
      const v = view.current
      v.mpp = Math.max(MIN_MPP, Math.min(MAX_MPP, v.mpp * Math.pow(1.0015, event.deltaY)))
      // Keep the point under the cursor fixed.
      const after = worldAt(event)
      v.cx += before.x - after.x
      v.cz += before.z - after.z
    }
    const onContext = (event: MouseEvent) => {
      event.preventDefault()
      useHud.getState().setWaypoint(null)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onContext)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('contextmenu', onContext)
    }
  }, [])

  const recentre = () => {
    view.current.cx = rt.player.pos.x
    view.current.cz = rt.player.pos.z
  }

  return (
    <div className="pause-map" ref={host}>
      <canvas ref={canvas} className="pause-map-canvas" />
      {!atlas && <div className="pause-map-loading">Loading map…</div>}
      <div className="pause-map-legend">
        <span>
          <i className="legend-player" /> You
        </span>
        <span>
          <i className="legend-waypoint" /> Waypoint
        </span>
        <span>
          <i className="legend-route" /> GPS
        </span>
      </div>
      <div className="pause-map-info">
        {hover && <b>{hover}</b>}
        {waypoint && routeLength !== null && <span>Waypoint · {formatDistance(routeLength)} by road</span>}
        {!waypoint && <span>Click the map to set a waypoint</span>}
      </div>
      <button className="pause-map-recentre small" onClick={recentre}>
        Centre on me
      </button>
    </div>
  )
}
