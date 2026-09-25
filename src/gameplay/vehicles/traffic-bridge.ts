/**
 * The traffic obstacle rule: how LION lane followers (src/city/traffic.js)
 * see bodies that are not on their lane list — the player's car, parked and
 * abandoned session cars, knocked traffic cars sliding free, and the player
 * on foot.
 *
 * Lane followers are 1-D: a position `s` along a polyline and a speed. An
 * obstacle becomes a *block* on a lane when its footprint, projected onto the
 * lane, overlaps the lane's band; the block sits at the obstacle's near edge
 * along the lane and moves at the obstacle's speed along the lane. The
 * car-following rule then treats the nearest block ahead exactly like a
 * leader: close the gap to a stand-off that grows with speed, stop short if
 * it does not move.
 *
 * Coordinates: lanes live in the city's local plane (x east, y north);
 * obstacles arrive in world coordinates (x, z = -y) with the session's
 * heading convention (forward = (sin h, cos h)). Pure and renderer-free.
 */

/** A lane polyline in the local plane, as traffic.js stores it. */
export interface LaneLike {
  pts: ReadonlyArray<readonly [number, number]>
  cum: ReadonlyArray<number>
  len: number
}

/** A body traffic must not drive through, in world coordinates. */
export interface TrafficObstacle {
  x: number
  z: number
  heading: number
  halfLength: number
  halfWidth: number
  /** Planar velocity, m/s. */
  vx: number
  vz: number
}

export interface LaneProjection {
  /** Distance along the lane of the nearest point, metres. */
  s: number
  /** Signed offset to the right of travel, metres. */
  lateral: number
  /** Lane direction at that point (unit, local plane). */
  dir: { x: number; y: number }
}

export interface LaneBlock {
  /** Near edge of the obstacle along the lane, metres. */
  s: number
  /** Obstacle speed along the lane, m/s (negative: coming toward). */
  speed: number
}

/** Project a local-plane point onto a lane polyline. */
export function projectOnLane(lane: LaneLike, px: number, py: number): LaneProjection {
  const pts = lane.pts
  let best = Infinity
  let out: LaneProjection = { s: 0, lateral: 0, dir: { x: 1, y: 0 } }
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0]
    const ay = pts[i - 1][1]
    const dx = pts[i][0] - ax
    const dy = pts[i][1] - ay
    const len2 = dx * dx + dy * dy
    if (len2 < 1e-12) continue
    let t = ((px - ax) * dx + (py - ay) * dy) / len2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const qx = ax + dx * t
    const qy = ay + dy * t
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy)
    if (d2 < best) {
      best = d2
      const len = Math.sqrt(len2)
      const ux = dx / len
      const uy = dy / len
      // right of travel in the local plane is (uy, -ux)
      out = {
        s: lane.cum[i - 1] + t * len,
        lateral: (px - qx) * uy + (py - qy) * -ux,
        dir: { x: ux, y: uy },
      }
    }
  }
  return out
}

/**
 * Blocks an obstacle list puts on one lane, sorted by `s`. `laneHalfWidth`
 * is half the lane band; a body only blocks when its footprint reaches into
 * the band by more than `tolerance` (so a car parked at the kerb does not
 * stop the traffic beside it).
 */
export function laneBlocks(
  lane: LaneLike,
  obstacles: ReadonlyArray<TrafficObstacle>,
  laneHalfWidth: number,
  tolerance = 0.3,
): LaneBlock[] {
  const out: LaneBlock[] = []
  for (const ob of obstacles) {
    const py = -ob.z
    const proj = projectOnLane(lane, ob.x, py)
    // Obstacle axes in the local plane: world (sin h, cos h) -> local (sin h, -cos h).
    const fx = Math.sin(ob.heading)
    const fy = -Math.cos(ob.heading)
    const cos = Math.abs(fx * proj.dir.x + fy * proj.dir.y)
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos))
    const along = cos * ob.halfLength + sin * ob.halfWidth
    const across = sin * ob.halfLength + cos * ob.halfWidth
    if (Math.abs(proj.lateral) > laneHalfWidth + across - tolerance) continue
    if (proj.s + along < 0 || proj.s - along > lane.len) continue
    // velocity along the lane: world (vx, vz) -> local (vx, -vz)
    const speed = ob.vx * proj.dir.x + -ob.vz * proj.dir.y
    out.push({ s: proj.s - along, speed })
  }
  out.sort((a, b) => a.s - b.s)
  return out
}

/**
 * Speed cap for a lane follower at `s` (its centre) with half-length
 * `halfLength` and speed `v`, given the blocks on its lane (and, offset by
 * `ahead`, those on the lane it turns into). Infinity when nothing blocks.
 * Mirrors the leader rule in traffic.js: a stand-off of `gapMin` plus
 * `reaction` seconds of travel.
 */
export function blockSpeedCap(
  s: number,
  halfLength: number,
  v: number,
  blocks: ReadonlyArray<LaneBlock>,
  gapMin = 2.2,
  reaction = 1.15,
  ahead = 0,
): number {
  const front = s + halfLength
  for (const block of blocks) {
    const at = block.s + ahead
    // A block the follower has already driven into (its own back half) is
    // behind it for the purpose of following.
    if (at < s) continue
    const gap = at - front
    const safe = gapMin + Math.max(0, v) * reaction
    if (gap >= safe) return Infinity
    if (gap <= gapMin * 0.5) return 0
    // Follow a moving block at its pace; creep up to a stopped one no faster
    // than a comfortable deceleration can shed before the stand-off.
    const follow = Math.max(0, block.speed) * (gap / safe)
    const creep = Math.sqrt(2 * COMFORT_DECEL * (gap - gapMin * 0.5))
    return Math.max(follow, creep)
  }
  return Infinity
}

/** Deceleration a lane follower plans with when closing on a block, m/s². */
export const COMFORT_DECEL = 3.5
