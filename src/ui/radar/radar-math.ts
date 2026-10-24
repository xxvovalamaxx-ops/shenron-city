/**
 * The arithmetic of the radar and the HUD readouts, kept out of the canvas
 * code so it is unit tested: heading-up rotation, the zoom-out with speed,
 * clamping blips to the rim, and the number formats.
 *
 * World axes: x east, z south (north is -z). Headings are compass bearings in
 * radians, clockwise from north.
 */

export interface Point {
  x: number
  y: number
}

/**
 * A world offset from the player, as a radar-screen offset in world units,
 * for a heading-up map: the camera's heading points straight up.
 */
export function worldToRadar(dx: number, dz: number, heading: number): Point {
  // North-up screen space is (dx, dz); rotate by -heading.
  const c = Math.cos(-heading)
  const s = Math.sin(-heading)
  return { x: dx * c - dz * s, y: dx * s + dz * c }
}

/** Inverse of {@link worldToRadar}. */
export function radarToWorld(x: number, y: number, heading: number): { dx: number; dz: number } {
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  return { dx: x * c - y * s, dz: x * s + y * c }
}

/** Where true north sits on the radar, as a unit screen direction. */
export function northDirection(heading: number): Point {
  return worldToRadar(0, -1, heading)
}

/**
 * Metres per CSS pixel for the radar. On foot GTA's radar shows about a block
 * either side; it pulls out as speed builds so a driver sees the next
 * junctions coming.
 */
export function radarScale(speed: number, driving: boolean): number {
  const s = Number.isFinite(speed) ? Math.max(0, speed) : 0
  if (!driving) return 0.85 + Math.min(1, s / 7.1) * 0.25
  return 1.25 + Math.min(1, s / 30) * 1.6
}

/**
 * Pull a screen point (relative to the radar centre) back onto a rectangle's
 * inset border, along the ray from the centre. Points already inside are
 * returned unchanged, with `clamped: false`.
 *
 * The centre need not be the middle of the rectangle — the radar puts the
 * player below centre to show more road ahead — so the box is given by its
 * extents from the centre.
 */
export function clampToBox(
  p: Point,
  box: { left: number; right: number; top: number; bottom: number },
  inset = 0,
): Point & { clamped: boolean } {
  const left = box.left - inset
  const right = box.right - inset
  const top = box.top - inset
  const bottom = box.bottom - inset
  if (p.x >= -left && p.x <= right && p.y >= -top && p.y <= bottom) {
    return { x: p.x, y: p.y, clamped: false }
  }
  let t = Infinity
  if (p.x > 0) t = Math.min(t, right / p.x)
  if (p.x < 0) t = Math.min(t, -left / p.x)
  if (p.y > 0) t = Math.min(t, bottom / p.y)
  if (p.y < 0) t = Math.min(t, -top / p.y)
  if (!Number.isFinite(t)) return { x: 0, y: 0, clamped: true }
  return { x: p.x * t, y: p.y * t, clamped: true }
}

/** Body facing (model yaw: facing = (sin, cos)) as a compass bearing. */
export function bearingFromBodyYaw(yaw: number): number {
  return Math.atan2(Math.sin(yaw), -Math.cos(yaw))
}

/** "17:05" for a 0..24 hour. */
export function formatClock(hour: number): string {
  const h = ((Number.isFinite(hour) ? hour : 0) % 24 + 24) % 24
  let hh = Math.floor(h)
  let mm = Math.floor((h - hh) * 60 + 1e-6)
  if (mm >= 60) {
    mm -= 60
    hh = (hh + 1) % 24
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** "$1,234,567"; negative balances read "-$50". */
export function formatMoney(amount: number): string {
  const value = Number.isFinite(amount) ? Math.round(amount) : 0
  const digits = Math.abs(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${value < 0 ? '-' : ''}$${digits}`
}

/** Clamp a wanted level to GTA's 0–5 stars. */
export function clampWanted(level: number): number {
  if (!Number.isFinite(level)) return 0
  return Math.max(0, Math.min(5, Math.round(level)))
}

/** Clamp a health/armor value to 0..100. */
export function clampStat(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/** Metres as a GPS distance readout: "180 m", "1.4 km". */
export function formatDistance(metres: number): string {
  const m = Number.isFinite(metres) ? Math.max(0, metres) : 0
  if (m < 1000) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(1)} km`
}

/** LION writes "5 AVE", "W 42 ST"; the HUD reads "5th Ave", "W 42nd St". */
export function titleCase(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      if (/^\d+$/.test(word)) {
        const n = Number(word)
        const tens = n % 100
        const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
        return `${n}${suffix}`
      }
      if (word === 'ave') return 'Ave'
      if (word === 'st') return 'St'
      if (word.length <= 1) return word.toUpperCase()
      return word[0].toUpperCase() + word.slice(1)
    })
    .join(' ')
}
