/**
 * Lanes and routes for the vehicle simulation.
 *
 * A {@link LaneProvider} supplies the lanes the AI drives. The default
 * provider is the hand-authored midtown boulevard loop, kept as the test
 * fallback (the unit tests and the replay arena pin its geometry). The live
 * build installs the LION street graph through
 * `graph-lane-provider.ts`, so AI traffic and the player's car drive real
 * one-way streets with real speed limits instead of one drawn loop. The
 * sampling helpers here are the whole routing primitive the traffic system
 * needs — nearest point, point-at-distance, heading-at-point, curvature,
 * and lane-end routing — and they are pure so routes can be unit tested and
 * re-authored without touching the simulation.
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
  /** Outgoing lane ids at the end of a graph lane, for routing. Loop lanes
   * never route; a graph lane with no outgoing lanes is a dead end. */
  next?: readonly string[]
  /** Curb offset for parking, metres right of travel. Absent on the loop. */
  parkOffset?: number
  /** Signalled approach: this lane ends at an intersection signal. */
  signalled?: boolean
  /** Phase axis of the lane's signal: 0 or 1 in the two-phase cycle. */
  axis?: number
  /** Baked copy of the intersection's fixed signal program. */
  signal?: { cycle: number; green: number; amber: number; offset: number }
  /**
   * The junction this approach feeds, baked with the lane ids of the
   * approaches whose paths cross it (left-turn yield set included). The
   * arbitration rule reads it: yield at the stop line while one of those
   * lanes holds the box or claims priority.
   */
  junction?: {
    id: number
    boxRadius: number
    crossingLaneIds: string[]
    opposingLaneIds: string[]
  }
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

export const LANES: Record<string, Lane> = {
  [BOULEVARD_LOOP.id]: BOULEVARD_LOOP,
}

export function laneLength(lane: Lane): number {
  const n = lane.points.length
  const segments = n - (lane.loop ? 0 : 1)
  let total = 0
  for (let i = 0; i < segments; i++) {
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

// ── Routing across lane ends ────────────────────────────────────────────────

/** Smallest signed angle from `from` to `to`, radians. */
function wrapAngleRad(from: number, to: number): number {
  let diff = to - from
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  return diff
}

/** Deterministic hash used for seeded routing choices. */
function laneHash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

export function laneEndHeading(lane: Lane): number {
  const n = lane.points.length
  const a = lane.points[n - 2] ?? lane.points[0]
  const b = lane.points[n - 1]
  return Math.atan2(b.x - a.x, b.z - a.z)
}

export function laneStartHeading(lane: Lane): number {
  const a = lane.points[0]
  const b = lane.points[1] ?? a
  return Math.atan2(b.x - a.x, b.z - a.z)
}

/**
 * Route to an outgoing lane at the end of a graph lane: prefer going
 * straight, refuse a U-turn unless it is the only option, seeded so the
 * choice is deterministic. Mirrors the LION traffic sim's routing decision
 * (city/street-nav.js) so both sims read the graph the same way. `lanes`
 * is the lane table the `next` ids resolve against — callers with an
 * explicit table pass it so the decision never depends on module state.
 */
export function routeNextLaneId(
  lane: Lane,
  seed: number,
  lanes: Readonly<Record<string, Lane>> = LANES,
): string | null {
  if (!lane.next || lane.next.length === 0) return null
  if (lane.next.length === 1) return lane.next[0]
  const h = laneEndHeading(lane)
  let best = -1
  let bestScore = -Infinity
  for (let i = 0; i < lane.next.length; i++) {
    const n = lanes[lane.next[i]]
    if (!n) continue
    const d = wrapAngleRad(h, laneStartHeading(n))
    if (Math.abs(d) > 2.7) continue
    const score = Math.cos(d) * 2.0 + laneHash(seed + Number(n.id)) * 1.4
    if (score > bestScore) { bestScore = score; best = i }
  }
  if (best >= 0) return lane.next[best]
  return lane.next[(seed | 0) % lane.next.length]
}

/**
 * Point and heading `lookahead` metres along the route from `distance` on
 * `lane`. On a loop lane this wraps; on a graph lane the sample crosses lane
 * ends onto the routed follow-on lanes, so the pursuit target leads the car
 * around the corner instead of pointing straight through the intersection.
 * `lanes` is the lane table the route resolves against, so the sample never
 * depends on module state.
 */
export function laneAheadPoint(
  lane: Lane,
  distance: number,
  lookahead: number,
  seed: number,
  lanes: Readonly<Record<string, Lane>> = LANES,
): { point: LanePoint; heading: number } {
  let cur = lane
  let d = distance + lookahead
  for (let guard = 0; guard < 6; guard++) {
    if (cur.loop) return pointAlongLane(cur, d)
    const len = laneLength(cur)
    if (d < len) return pointAlongLane(cur, d)
    const nextId = routeNextLaneId(cur, seed, lanes)
    if (nextId === null) return pointAlongLane(cur, len - 0.01)
    const next = lanes[nextId]
    if (!next) return pointAlongLane(cur, len - 0.01)
    d -= len
    cur = next
  }
  return pointAlongLane(cur, 0)
}

/**
 * Swap the lane lookup table in place. The AI traffic reads `LANES` through
 * the module table, so installing the street graph replaces the drawn loop
 * without touching any call site. The loop itself remains available as the
 * fallback for lanes that are no longer in the table.
 */
export function setLaneTable(table: Readonly<Record<string, Lane>>): void {
  for (const key of Object.keys(LANES)) delete LANES[key]
  for (const [key, lane] of Object.entries(table)) LANES[key] = lane
}

// ── Lane providers ──────────────────────────────────────────────────────────

/**
 * A source of lanes for the vehicle simulation. The loop provider (default,
 * and the test fallback) serves the drawn boulevard; the graph provider
 * serves the LION street graph, installed once the city pipeline loads it.
 */
export interface LaneProvider {
  /** Whether the lanes come from the street graph (enables LION ghost sync). */
  readonly graph: boolean
  /** The lanes this provider supplies, for table installation. */
  readonly lanes: Readonly<Record<string, Lane>>
  /** Nearest lane to (x, z) within radius, optionally restricted to lanes
   * with a parking bay. */
  nearestLane(x: number, z: number, radius: number, parkable?: boolean): Lane | null
  /** Nearest lane to (x, z) with the projected distance along it. */
  project(x: number, z: number, radius: number): { lane: Lane; distance: number } | null
}

/** The drawn boulevard loop, as a provider. `lanes` is the live table, so
 * the arena lanes tests inject still resolve through it. */
export const loopLaneProvider: LaneProvider = {
  graph: false,
  lanes: LANES,
  nearestLane(x, z, radius, parkable = false) {
    let best: Lane | null = null
    let bestDist = radius
    for (const lane of Object.values(LANES)) {
      if (parkable && lane.parkOffset === undefined) continue
      const sample = nearestLanePoint(lane, x, z)
      const d = Math.hypot(sample.point.x - x, sample.point.z - z)
      if (d < bestDist) { bestDist = d; best = lane }
    }
    return best
  },
  project(x, z, radius) {
    const lane = this.nearestLane(x, z, radius)
    if (!lane) return null
    return { lane, distance: nearestLanePoint(lane, x, z).distance }
  },
}
