/**
 * Shared canvas drawing for the radar and the pause map: the GPS line, the
 * player arrow, blips and the waypoint pin. Everything takes CSS-pixel
 * coordinates on a context already scaled for the device pixel ratio.
 */
import { cityWorld } from '../../city/registry.js'
import { vehicleSim } from '../../gameplay/vehicles/vehicle-session'

export const GPS_COLOR = '#b44ff0'
export const WAYPOINT_COLOR = '#c05cf5'

/** Player arrow: a GTA-style chevron pointing along `angle` (screen radians, 0 = up). */
export function drawPlayerArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size = 9): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(size * 0.72, size * 0.78)
  ctx.lineTo(0, size * 0.38)
  ctx.lineTo(-size * 0.72, size * 0.78)
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)'
  ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()
}

/** Waypoint pin: a filled diamond with a dark rim. */
export function drawWaypoint(ctx: CanvasRenderingContext2D, x: number, y: number, size = 7): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(size, 0)
  ctx.lineTo(0, size)
  ctx.lineTo(-size, 0)
  ctx.closePath()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  ctx.stroke()
  ctx.fillStyle = WAYPOINT_COLOR
  ctx.fill()
  ctx.restore()
}

/**
 * Stroke a world-space polyline (interleaved x, z) with the context in world
 * units; `pxPerUnit` converts the wanted on-screen width.
 */
export function strokeRoute(
  ctx: CanvasRenderingContext2D,
  pts: Float32Array,
  start: { x: number; z: number } | null,
  metresPerPx: number,
  widthPx = 4,
): void {
  if (pts.length < 4) return
  ctx.beginPath()
  const first = start ? 2 : 0
  if (start) ctx.moveTo(start.x, start.z)
  else ctx.moveTo(pts[0], pts[1])
  for (let i = first; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(24, 6, 36, 0.7)'
  ctx.lineWidth = (widthPx + 2.5) * metresPerPx
  ctx.stroke()
  ctx.strokeStyle = GPS_COLOR
  ctx.lineWidth = widthPx * metresPerPx
  ctx.stroke()
}

interface LaneLike {
  pts?: Array<[number, number]>
  cum?: number[]
  len?: number
}

/**
 * World positions of the simulated traffic within `radius` of (x, z), as
 * interleaved x, z. Read defensively: the traffic sim is plain JS owned by
 * another workstream, and a missing field must cost a blip, not the HUD.
 */
export function trafficNear(x: number, z: number, radius: number, out: number[]): number[] {
  out.length = 0
  const traffic = cityWorld.traffic as unknown as {
    vehicles?: Array<{ lane?: number; s?: number }>
    lanes?: LaneLike[]
  } | null
  const vehicles = traffic?.vehicles
  const lanes = traffic?.lanes
  if (!vehicles || !lanes) return out
  const r2 = radius * radius
  for (const v of vehicles) {
    const lane = typeof v.lane === 'number' ? lanes[v.lane] : undefined
    const pts = lane?.pts
    const cum = lane?.cum
    if (!pts || !cum || pts.length < 2 || typeof v.s !== 'number') continue
    const s = Math.min(v.s, lane?.len ?? v.s)
    let i = 1
    while (i < cum.length - 1 && cum[i] < s) i++
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
    const a = pts[i - 1]
    const b = pts[i]
    const wx = a[0] + (b[0] - a[0]) * t
    const wz = -(a[1] + (b[1] - a[1]) * t)
    const dx = wx - x
    const dz = wz - z
    if (dx * dx + dz * dz > r2) continue
    out.push(wx, wz)
  }
  return out
}

/** The player's own (owned, parked) car, if the vehicle sim has one. */
export function ownedVehicle(): { x: number; z: number } | null {
  for (const vehicle of vehicleSim.registry.vehicles.values()) {
    if (vehicle.owned && vehicle.id !== vehicleSim.registry.playerVehicleId) {
      return { x: vehicle.pose.pos.x, z: vehicle.pose.pos.z }
    }
  }
  return null
}
