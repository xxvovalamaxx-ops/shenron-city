/**
 * Lanes and routes for the vehicle simulation.
 *
 * The Manhattan island is a mesh city; there is no road-authoring data to
 * read, so Phase 3A lanes are hand-authored polylines along the midtown
 * street grid, looped so AI traffic can circulate forever. The sampling
 * helpers here are the whole routing primitive the traffic system needs —
 * nearest point, point-at-distance, heading-at-point, curvature — and they
 * are pure so routes can be unit tested and re-authored without touching the
 * simulation. See docs/phase3/PHASE3A.md for the caveat that lane geometry is
 * approximate until exact street centre-lines are exported.
 */
export interface LanePoint {
  x: number
  z: number
}

export interface Lane {
  id: string
  /** Closed loop: the first and last point are joined by the final segment. */
  loop: boolean
  /** Lane speed limit, m/s. AI traffic cruises under it. */
  speedLimit: number
  /** Signed distance from the centre-line the traffic should hold. */
  laneWidth: number
  points: readonly LanePoint[]
}

export interface LaneSample {
  /** Distance along the lane, metres, in [0, length). */
  distance: number
  /** Nearest point on the centre-line. */
  point: LanePoint
  /** Signed lateral offset, metres, positive to the right of travel. */
  lateral: number
  /** Heading of travel at the nearest point, radians. */
  heading: number
  /** Absolute curvature of the centre-line at the sample, 1/m. */
  curvature: number
}

/**
 * The midtown boulevard loop: a one-block rounded rectangle around the
 * Midtown East spawn (36th St & Lexington, MANHATTAN_SPAWN_POINT), so the
 * owned car parks within ~150 m of the player. Coordinates follow the street
 * grid used by MANHATTAN_SPAWN_CANDIDATES.
 */
export const BOULEVARD_LOOP: Lane = {
  id: 'boulevard-loop',
  loop: true,
  speedLimit: 13.5,
  laneWidth: 1.6,
  points: [
    { x: 920, z: -2850 },
    { x: 1080, z: -2850 },
    { x: 1150, z: -2920 },
    { x: 1150, z: -3080 },
    { x: 1080, z: -3150 },
    { x: 920, z: -3150 },
    { x: 850, z: -3080 },
    { x: 850, z: -2920 },
  ],
}

export const LANES: Readonly<Record<string, Lane>> = {
  [BOULEVARD_LOOP.id]: BOULEVARD_LOOP,
}

export function laneLength(lane: Lane): number {
  const n = lane.points.length
  let total = 0
  for (let i = 0; i < n; i++) {
    const a = lane.points[i]
    const b = lane.points[(i + 1) % n]
    total += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return total
}

function segmentHeading(a: LanePoint, b: LanePoint): number {
  return Math.atan2(b.x - a.x, b.z - a.z)
}

/** Heading used by the simulation: forward = (sin h, cos h). */
function headingOfSegment(a: LanePoint, b: LanePoint): number {
  return segmentHeading(a, b)
}

/**
 * Nearest-point projection onto the centre-line with signed lateral offset.
 * The right of travel is +lateral (matching vehicleRight(heading));
 * `distance` is in metres along the centre-line.
 */
export function nearestLanePoint(lane: Lane, x: number, z: number): LaneSample {
  const n = lane.points.length
  const segments = n - (lane.loop ? 0 : 1)
  let bestDistance = Infinity
  let best: LaneSample | null = null
  let cumulative = 0

  for (let i = 0; i < segments; i++) {
    const a = lane.points[i]
    const b = lane.points[(i + 1) % n]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const len = Math.sqrt(len2)
    let t = len2 > 1e-12 ? ((x - a.x) * dx + (z - a.z) * dz) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const px = a.x + t * dx
    const pz = a.z + t * dz
    const dist = Math.hypot(x - px, z - pz)
    if (dist < bestDistance) {
      bestDistance = dist
      const heading = headingOfSegment(a, b)
      const right = { x: -Math.cos(heading), z: Math.sin(heading) }
      const lateral = (x - px) * right.x + (z - pz) * right.z
      const curvature = segmentCurvature(lane, i)
      best = { distance: cumulative + t * len, point: { x: px, z: pz }, lateral, heading, curvature }
    }
    cumulative += len
  }
  return best as LaneSample
}

/**
 * Curvature (1/m) of the lane at the junction a segment belongs to.
 *
 * Loop lanes bend at the junction at the start of each segment; the last
 * segment of an open lane bends at its own start. Either way a car sitting
 * on a corner reads the corner.
 */
function segmentCurvature(lane: Lane, i: number): number {
  const n = lane.points.length
  const segments = lane.loop ? n : n - 1
  const last = i === segments - 1
  let a: LanePoint
  let b: LanePoint
  let c: LanePoint
  if (last && !lane.loop) {
    a = lane.points[i - 1] ?? lane.points[i]
    b = lane.points[i]
    c = lane.points[(i + 1) % n]
  } else {
    a = lane.points[i]
    b = lane.points[(i + 1) % n]
    c = lane.points[(i + 2) % n]
  }
  const ux = b.x - a.x
  const uz = b.z - a.z
  const vx = c.x - b.x
  const vz = c.z - b.z
  const cross = ux * vz - uz * vx
  const dot = ux * vx + uz * vz
  const ulen = Math.hypot(ux, uz)
  const vlen = Math.hypot(vx, vz)
  if (ulen < 1e-6 || vlen < 1e-6) return 0
  const angle = Math.abs(Math.atan2(cross, dot))
  // Turn angle spread across the average segment length is the discrete
  // curvature; 1 m segments would make this exact.
  const length = (ulen + vlen) / 2
  return angle / Math.max(0.1, length)
}

/** Wrap a travelled distance into [0, length) for a looped lane. */
export function wrapLaneDistance(lane: Lane, distance: number): number {
  if (!lane.loop) return distance
  const length = laneLength(lane)
  let d = distance % length
  if (d < 0) d += length
  return d
}

/** Point and travel heading at a distance along the lane. */
export function pointAlongLane(
  lane: Lane,
  distance: number,
): { point: LanePoint; heading: number } {
  const n = lane.points.length
  const d = wrapLaneDistance(lane, distance)
  let travelled = 0
  for (let i = 0; i < n; i++) {
    const a = lane.points[i]
    const b = lane.points[(i + 1) % n]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (travelled + len >= d || i === n - 1) {
      const t = len > 1e-9 ? (d - travelled) / len : 0
      return {
        point: { x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) },
        heading: headingOfSegment(a, b),
      }
    }
    travelled += len
  }
  return { point: { ...lane.points[0] }, heading: 0 }
}
