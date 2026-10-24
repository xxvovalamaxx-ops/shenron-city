// traffic.js — vehicles driving the real LION road graph.
//
// The Phase 1 critique was explicit that a Blender Geometry Nodes instancer
// would not export as a live traffic system, and it was right: this is a
// runtime simulation, not baked animation. It drives the graph that
// 47_build_streets.py extracted from NYC Centerline, so one-way streets run
// the correct way, avenues carry more lanes than side streets, and posted
// speed varies by segment.
//
// Structure
//   lanes    every drivable edge becomes 1..n directed lanes, offset from the
//            centreline. Right-hand traffic: forward lanes sit to the right.
//   routing  at the end of a lane a vehicle picks an outgoing lane at that
//            node, preferring to go straight and refusing a U-turn unless it
//            is the only option.
//   signals  junctions of degree 3+ alternate by approach axis on a fixed
//            cycle, offset per node so the whole city does not blink together.
//   scope    only lanes within a radius of the camera are simulated; vehicles
//            outside it are recycled, so cost is bounded by view, not by city.
//
// One vehicle world (see gameplay/vehicles/vehicle-world-link.ts)
//   obstacles  the player's car, the cars the player left behind, the player
//              on foot and knocked traffic cars are projected onto nearby
//              lanes as blocks (traffic-bridge.ts); followers brake for them
//              exactly as for a leader, including across a junction.
//   queries    `queryNear` hands the gameplay session a snapshot of the cars
//              near the player: pose, velocity, kind and paint.
//   claim      a carjack removes the car here; the session carries it on.
//   knock      a collision frees a car from its lane: it slides and spins
//              to rest under tyre scrub, blocks the lane behind it, and
//              rejoins traffic once it is stopped and roughly lined up.

import * as THREE from 'three'
import { VehicleFleet, LOD0_DISTANCE, LOD1_DISTANCE } from './vehicles.js'
import { vehicleShaderTime } from '../world/vehicles/vehicle-assets'
import { laneBlocks, blockSpeedCap, projectOnLane } from '../gameplay/vehicles/traffic-bridge'
import { rt } from '../gameplay/runtime'

const LANE_W = 3.35          // metres, NYC standard travel lane
const SIM_RADIUS = 520       // simulate lanes within this of the camera
const DESPAWN = 620
const CELL = 200             // spatial index cell for lane lookup
const MPH = 0.44704

const GAP_MIN = 2.2          // bumper gap at a stop
const REACTION = 1.15        // seconds of headway to the vehicle ahead
const ACCEL = 3.4            // m/s^2
const BRAKE = 7.5
const SIGNAL_CYCLE = 26.0    // seconds for a full two-phase cycle
const SIGNAL_GREEN = 11.0    // green per phase, rest is all-red clearance

const FREE_SCRUB = 6.5       // m/s^2 a knocked car sheds sliding
const REJOIN_AFTER = 3.5     // seconds at rest before a knocked car drives on
const TAXI_DISTRICTS = /Midtown|Times Sq|Murray Hill|Turtle Bay|Hell's Kitchen|Chelsea|United Nations|Gramercy|Flatiron|Lenox Hill/

function hash1(n) {
  let x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const _m = new THREE.Matrix4()
const _w = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler(0, 0, 0, 'YXZ')
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _sphere = new THREE.Sphere()
const _pv = new THREE.Matrix4()
const _spinQ = new THREE.Quaternion()
const _xAxis = new THREE.Vector3(1, 0, 0)

export class Traffic {
  constructor(scene, city, demand = null) {
    this.scene = scene
    this.city = city
    this.demand = demand
    this.groundY = city?.meta?.land_level_m ?? 12.0
    this.roadY = this.groundY + 0.05
    this.fleet = new VehicleFleet(scene)

    this.lanes = []
    this.nodeLanes = new Map()   // node index -> outgoing lane ids
    this.grid = new Map()        // cell key -> lane ids
    this.vehicles = []
    this.active = new Set()      // lane ids currently in scope
    this.clock = 0
    this.enabled = true
    this.maxVehicles = 700
    this.stats = { lanes: 0, vehicles: 0, simLanes: 0, knocked: 0 }
    this.nextId = 1
    this.obstacles = []          // external bodies, world coords
    this.districtCache = new Map()
    this.frustum = new THREE.Frustum()
  }

  async load(graphUrl = '/models/manhattan/streets/street_graph.json') {
    const g = await fetch(graphUrl).then((r) => (r.ok ? r.json() : null))
    if (!g) { console.warn('[traffic] no street graph'); return this }
    await this.fleet.load(this.maxVehicles)
    this._buildLanes(g)
    this.stats.lanes = this.lanes.length
    return this
  }

  // ---- lane construction --------------------------------------------------
  _buildLanes(g) {
    const nodes = g.nodes
    const deg = g.node_degree

    for (const e of g.edges) {
      if (!e.drivable) continue
      if (e.kind === 'ferry' || e.kind === 'non_physical') continue
      if (e.length < 8) continue

      const total = Math.max(1, e.lanes)
      // LION's number_travel_lanes is the segment total, both directions
      const dirs = e.oneway === 0
        ? [{ sign: 1, n: Math.max(1, Math.floor(total / 2)) },
           { sign: -1, n: Math.max(1, Math.ceil(total / 2)) }]
        : [{ sign: e.oneway, n: total }]

      // LION's streetwidth is the whole carriageway, kerb to kerb, and in
      // Manhattan a lot of that is parked cars. Travel lanes have to fit
      // inside what is left, centred on the centreline -- stacking them at a
      // fixed 3.35 m to the right of centre put the outer lanes of every
      // avenue up on the pavement.
      const parked = Math.max(0, e.park_lanes || 0) * 2.45
      const usable = Math.max(LANE_W, e.width - parked)

      for (const d of dirs) {
        // one-way traffic uses the whole usable width; two-way gets its half
        const band = e.oneway === 0 ? usable * 0.5 : usable
        const laneW = Math.min(LANE_W * 1.25, band / d.n)
        for (let k = 0; k < d.n; k++) {
          // offset measured to the right of the direction of travel
          const off = e.oneway === 0
            ? (k + 0.5) * laneW
            : -band * 0.5 + (k + 0.5) * laneW
          const pts = this._offsetPolyline(e.pts, d.sign, off)
          if (pts.length < 2) continue
          const from = d.sign === 1 ? e.a : e.b
          const to = d.sign === 1 ? e.b : e.a
          const cum = [0]
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (let i = 0; i < pts.length; i++) {
            if (i > 0) {
              cum.push(cum[i - 1] +
                Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
            }
            minX = Math.min(minX, pts[i][0]); maxX = Math.max(maxX, pts[i][0])
            minY = Math.min(minY, pts[i][1]); maxY = Math.max(maxY, pts[i][1])
          }
          const id = this.lanes.length
          const heading = Math.atan2(
            pts[pts.length - 1][1] - pts[0][1],
            pts[pts.length - 1][0] - pts[0][0])
          this.lanes.push({
            id, from, to, pts, cum, len: cum[cum.length - 1],
            speed: Math.max(4, e.speed_mph * MPH),
            kind: e.kind, name: e.name, heading,
            halfW: laneW * 0.5,
            bb: [minX, minY, maxX, maxY],
            // right of the kerb-side lane: offset to the parking-lane centre
            park: (e.park_lanes || 0) > 0 && k === d.n - 1
              ? (e.oneway === 0 ? band : band * 0.5) - off + 1.225
              : 0,
            // the LION edge, so the DOT volume counts can weight this lane
            eid: e.id,
            weight: this.demand?.ready ? this.demand.vehNorm(e.id) : 0.6,
            signalled: deg[to] >= 3,
            // two-phase signal: roughly north-south versus east-west
            axis: (Math.abs(Math.cos(heading)) > 0.5) ? 0 : 1,
            queue: [],
          })
          if (!this.nodeLanes.has(from)) this.nodeLanes.set(from, [])
          this.nodeLanes.get(from).push(id)
          this._index(id, pts)
        }
      }
    }

    // outgoing lanes at the end node, for routing
    for (const l of this.lanes) {
      l.next = this.nodeLanes.get(l.to) || []
    }
    this.nodes = nodes
  }

  _offsetPolyline(pts, sign, off) {
    const src = sign === 1 ? pts : pts.slice().reverse()
    const out = []
    for (let i = 0; i < src.length; i++) {
      const a = src[Math.max(0, i - 1)]
      const b = src[Math.min(src.length - 1, i + 1)]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const d = Math.hypot(dx, dy) || 1
      // right of travel is (dy, -dx) normalised
      out.push([src[i][0] + (dy / d) * off, src[i][1] + (-dx / d) * off])
    }
    return out
  }

  _index(id, pts) {
    const seen = new Set()
    for (const p of pts) {
      const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`
      if (seen.has(k)) continue
      seen.add(k)
      if (!this.grid.has(k)) this.grid.set(k, [])
      this.grid.get(k).push(id)
    }
  }

  lanesNear(xM, yM, radius) {
    const r = Math.ceil(radius / CELL)
    const cx = Math.floor(xM / CELL)
    const cy = Math.floor(yM / CELL)
    const out = new Set()
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const list = this.grid.get(`${cx + dx},${cy + dy}`)
        if (list) for (const id of list) out.add(id)
      }
    }
    return out
  }

  // Lanes whose bounding box comes within `pad` of a local-plane point.
  _lanesTouching(xM, yM, pad) {
    const out = []
    for (const id of this.lanesNear(xM, yM, pad)) {
      const bb = this.lanes[id].bb
      if (xM < bb[0] - pad || xM > bb[2] + pad || yM < bb[1] - pad || yM > bb[3] + pad) continue
      out.push(id)
    }
    return out
  }

  // ---- signals ------------------------------------------------------------
  // Returns true when a lane may proceed through its end node.
  _green(lane) {
    if (!lane.signalled) return true
    const t = (this.clock + hash1(lane.to) * SIGNAL_CYCLE) % SIGNAL_CYCLE
    const phase = t < SIGNAL_CYCLE / 2 ? 0 : 1
    const within = t % (SIGNAL_CYCLE / 2)
    return phase === lane.axis && within < SIGNAL_GREEN
  }

  // ---- districts: taxis crowd Midtown -------------------------------------
  _taxiBias(xM, yM) {
    const key = `${Math.floor(xM / 250)},${Math.floor(yM / 250)}`
    let bias = this.districtCache.get(key)
    if (bias === undefined) {
      bias = 0
      const city = this.city
      if (city && typeof city.nearest === 'function') {
        const i = city.nearest(xM, -yM, 300)
        if (i >= 0 && TAXI_DISTRICTS.test(city.district(i))) bias = 1
      }
      this.districtCache.set(key, bias)
    }
    return bias
  }

  // ---- spawn / recycle ----------------------------------------------------
  _spawn(laneId, seed) {
    const lane = this.lanes[laneId]
    const mid = lane.pts[(lane.pts.length / 2) | 0]
    const type = this.fleet.pick(hash1(seed * 3.7), this._taxiBias(mid[0], mid[1]))
    if (!type) return null
    // vans stay off the narrowest side streets
    if (type.key === 'van' && lane.speed < 6) return null
    const v = {
      id: 0,
      lane: laneId,
      s: hash1(seed * 11.3) * Math.max(1, lane.len - 6),
      v: lane.speed * (0.5 + hash1(seed * 5.1) * 0.4),
      type,
      seed,
      paint: this.fleet.paintFor(type, seed),
      alive: true,
      spin: 0,
      brake: 0,
      pitch: 0,
      accel: 0,
      free: null,
      next: -1,
      // a third of the police cars run with the lightbar going
      strobe: type.key === 'police' && hash1(seed * 7.7) < 0.35 ? hash1(seed * 1.9) : -1,
      sign: type.key === 'taxi' && hash1(seed * 2.3) < 0.6 ? 1 : 0,
      // world pose cache, refreshed every render
      wx: 0, wy: 0, wz: 0, wh: 0, wvx: 0, wvz: 0,
    }
    return v
  }

  _routeFrom(lane, seed) {
    const next = lane.next
    if (!next || !next.length) return -1
    if (next.length === 1) return next[0]
    // prefer going straight: score by heading continuity, and never turn back
    let best = -1
    let bestScore = -Infinity
    for (const id of next) {
      const n = this.lanes[id]
      let d = n.heading - lane.heading
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      if (Math.abs(d) > 2.7) continue           // U-turn
      const score = Math.cos(d) * 2.0 + hash1(seed + id) * 1.4
      if (score > bestScore) { bestScore = score; best = id }
    }
    return best >= 0 ? best : next[(seed | 0) % next.length]
  }

  // ---- the one vehicle world ----------------------------------------------

  /**
   * Bodies traffic must not drive through, in world coordinates
   * ({x, z, heading, halfLength, halfWidth, vx, vz}). Replaced every frame
   * by the game loop; knocked traffic cars are added internally.
   */
  setObstacles(list) {
    this.obstacles = list || []
  }

  /**
   * Cars within `radius` of a world point, as session views (see
   * TrafficCarView in vehicle-world-link.ts). Reads the pose cache written by
   * the last render, so it is at most a frame old.
   */
  queryNear(x, z, radius, out = []) {
    out.length = 0
    const r2 = radius * radius
    for (const v of this.vehicles) {
      const dx = v.wx - x
      const dz = v.wz - z
      if (dx * dx + dz * dz > r2) continue
      const f = { x: Math.sin(v.wh), z: Math.cos(v.wh) }
      out.push({
        id: v.id,
        kind: v.type.key,
        x: v.wx,
        y: v.wy,
        z: v.wz,
        heading: v.wh,
        speed: v.wvx * f.x + v.wvz * f.z,
        vx: v.wvx,
        vz: v.wvz,
        yawRate: v.free ? v.free.w : 0,
        paint: v.paint,
      })
    }
    return out
  }

  /** Remove a car (a carjack). Returns what the session needs, or null. */
  claim(id) {
    const i = this.vehicles.findIndex((v) => v.id === id)
    if (i < 0) return null
    const [v] = this.vehicles.splice(i, 1)
    return { kind: v.type.key, paint: v.paint }
  }

  /**
   * A collision: free the car from its lane with the pose and velocity the
   * session computed for it ({x, z, heading, vx, vz, yawRate}, world).
   */
  knock(id, view) {
    const v = this.vehicles.find((c) => c.id === id)
    if (!v) return
    v.free = {
      x: view.x, z: view.z, h: view.heading,
      vx: view.vx, vz: view.vz, w: view.yawRate,
      rest: 0,
    }
    v.v = 0
  }

  /**
   * A kerb-side parking spot near a world point: the parking-lane centre
   * beside the nearest kerb lane, clear of the junctions at either end.
   * Returns world {x, z, heading} (session heading), or null.
   */
  parkingSpotNear(x, z, radius = 90) {
    const yM = -z
    let best = null
    for (const id of this._lanesTouching(x, yM, radius)) {
      const lane = this.lanes[id]
      if (!lane.park || lane.len < 30) continue
      const proj = projectOnLane(lane, x, yM)
      const s = Math.min(lane.len - 12, Math.max(12, proj.s))
      const [px, py, head] = this._pointAt(lane, s)
      // right of travel in the local plane
      const rx = Math.sin(head)
      const ry = -Math.cos(head)
      const sx = px + rx * lane.park
      const sy = py + ry * lane.park
      const d = Math.hypot(sx - x, sy - yM)
      if (d > radius) continue
      if (!best || d < best.d) best = { d, x: sx, z: -sy, heading: head + Math.PI / 2 }
    }
    return best ? { x: best.x, z: best.z, heading: best.heading } : null
  }

  // ---- simulation ---------------------------------------------------------
  update(dt, camera) {
    if (!this.enabled || !this.fleet.ready || !this.lanes.length) return
    this.clock += dt
    dt = Math.min(dt, 0.1)
    vehicleShaderTime.value += dt

    // world z = -y_m
    const camX = camera.position.x
    const camY = -camera.position.z
    const inScope = this.lanesNear(camX, camY, SIM_RADIUS)
    this.stats.simLanes = inScope.size

    // recycle anything that has left the area or run off the end of its route
    const keep = []
    for (const v of this.vehicles) {
      let px, py
      if (v.free) { px = v.free.x; py = -v.free.z } else {
        const lane = this.lanes[v.lane]
        const p = this._pointAt(lane, Math.min(v.s, lane.len))
        px = p[0]; py = p[1]
      }
      if (Math.hypot(px - camX, py - camY) > DESPAWN) continue
      keep.push(v)
    }
    this.vehicles = keep

    // Obstacles: what the game handed us, plus our own knocked cars.
    const obstacles = this.obstacles.slice()
    for (const v of this.vehicles) {
      if (!v.free) continue
      obstacles.push({
        x: v.free.x, z: v.free.z, heading: v.free.h,
        halfLength: v.type.halfLength, halfWidth: v.type.halfWidth,
        vx: v.free.vx, vz: v.free.vz, self: v.id,
      })
    }
    const blocks = this._blocks(obstacles)

    // Top up, biased toward the lanes the camera can actually see, and scaled
    // by what the city measured on them. Counting lanes alone makes every
    // street equally busy, which puts as much traffic on a Village mews as on
    // Sixth Avenue.
    let load = 0.55
    if (this.demand?.ready) {
      let sum = 0
      for (const id of inScope) sum += this.lanes[id].weight
      // Superlinear, so a quiet neighbourhood is visibly quiet. A linear map
      // over weights that now centre on 0.76 pinned every location against
      // the vehicle cap, which differentiates nothing.
      const mean = sum / Math.max(1, inScope.size)
      load = Math.min(0.95, 0.9 * mean ** 1.6)
    }
    const want = Math.min(this.maxVehicles, Math.round(inScope.size * load))
    if (this.vehicles.length < want) {
      // occupancy per lane, so a new car is not dropped inside an existing
      // one -- car-following only resolves gaps *after* a frame, so without
      // this check the first frame after a spawn shows interpenetration
      const occupied = new Map()
      for (const v of this.vehicles) {
        if (v.free) continue
        if (!occupied.has(v.lane)) occupied.set(v.lane, [])
        occupied.get(v.lane).push(v)
      }
      // Pick lanes weighted toward the camera. A uniform pick spreads the
      // fleet over the whole disc, and area grows with r^2, so almost every
      // car ended up in the far ring: 557 vehicles simulating and 6 of them
      // within 120 m, with the camera's own street empty.
      const ids = Array.from(inScope)
      const withDist = ids.map((id) => {
        const lane = this.lanes[id]
        const p = lane.pts[(lane.pts.length / 2) | 0]
        return { id, d: Math.hypot(p[0] - camX, p[1] - camY) }
      }).sort((a, b) => a.d - b.d)

      let guard = 0
      while (this.vehicles.length < want && guard++ < 1200) {
        // squaring a uniform sample biases hard toward the head of the list
        const pickIx = Math.min(withDist.length - 1,
          (Math.random() ** 2 * withDist.length) | 0)
        const id = withDist[pickIx].id
        const lane = this.lanes[id]
        if (!lane || lane.len < 12) continue
        // Reject in proportion to how little traffic this street carries.
        // Cubed, not linear: the weights centre on 0.79, so a linear
        // acceptance ran 0.82 against 1.00 and concentrated nothing -- cars
        // sat on the mews as readily as on Sixth Avenue.
        if (this.demand?.ready && Math.random() > lane.weight ** 3) continue
        const v = this._spawn(id, (Math.random() * 1e6) | 0)
        if (!v) continue

        const here = occupied.get(id)
        if (here) {
          let clash = false
          for (const o of here) {
            const need = (v.type.length + o.type.length) * 0.5 + GAP_MIN
            if (Math.abs(o.s - v.s) < need) { clash = true; break }
          }
          if (clash) continue
        }
        // never inside (or just behind) a block: the player's car, a wreck
        const laneBlocksHere = blocks.get(id)
        if (laneBlocksHere && laneBlocksHere.some((b) => Math.abs(b.s - v.s) < 12)) continue

        const p = this._pointAt(lane, v.s)
        const d = Math.hypot(p[0] - camX, p[1] - camY)
        // Never materialise a car on top of the viewer, but keep the
        // exclusion tight: at 30 m the whole near field stayed empty and the
        // avenue read as deserted from the pavement.
        if (d > SIM_RADIUS || d < 12) continue

        v.id = this.nextId++
        this.vehicles.push(v)
        if (!occupied.has(id)) occupied.set(id, [])
        occupied.get(id).push(v)
      }
    }

    // car-following needs vehicles ordered along each lane
    const byLane = new Map()
    for (const v of this.vehicles) {
      if (v.free) continue
      if (!byLane.has(v.lane)) byLane.set(v.lane, [])
      byLane.get(v.lane).push(v)
    }
    for (const list of byLane.values()) list.sort((a, b) => a.s - b.s)

    for (const [laneId, list] of byLane) {
      const lane = this.lanes[laneId]
      const laneBlocksHere = blocks.get(laneId)
      for (let i = 0; i < list.length; i++) {
        const v = list[i]
        const ahead = list[i + 1]
        let target = lane.speed
        const half = v.type.length * 0.5

        if (ahead) {
          const gap = ahead.s - v.s - v.type.length * 0.5 -
            ahead.type.length * 0.5
          const safe = GAP_MIN + v.v * REACTION
          if (gap < safe) {
            target = Math.max(0, ahead.v * (gap / Math.max(safe, 0.01)))
          }
        }

        // the player's car, parked cars, a wreck: blocks on this lane, and on
        // the lane it is about to turn into
        if (laneBlocksHere) {
          target = Math.min(target, blockSpeedCap(v.s, half, v.v, laneBlocksHere, GAP_MIN, REACTION))
        }
        const toEnd = lane.len - v.s
        if (toEnd < 30) {
          if (v.next < 0) v.next = this._routeFrom(lane, v.seed)
          const nb = v.next >= 0 ? blocks.get(v.next) : null
          if (nb) target = Math.min(target, blockSpeedCap(v.s, half, v.v, nb, GAP_MIN, REACTION, lane.len))
        }

        // stop line at a red signal
        if (lane.signalled && !this._green(lane)) {
          const stopAt = 6.0
          if (toEnd < stopAt + v.v * v.v / (2 * BRAKE) + 4) {
            target = Math.min(target, Math.max(0, (toEnd - stopAt) * 0.9))
          }
        }
        target *= v.type.speedScale

        const before = v.v
        const a = target > v.v ? ACCEL : -BRAKE
        v.v = a > 0 ? Math.min(target, v.v + ACCEL * dt)
          : Math.max(target, v.v - BRAKE * dt)
        v.v = Math.max(0, v.v)
        v.s += v.v * dt
        v.accel = dt > 0 ? (v.v - before) / dt : 0
        // brake lamps: decelerating, or held at a standstill
        const braking = v.accel < -0.6 || (v.v < 0.3 && target < 0.5)
        v.brake += ((braking ? 1 : 0) - v.brake) * Math.min(1, dt * 12)

        if (v.s >= lane.len) {
          const nid = v.next >= 0 ? v.next : this._routeFrom(lane, v.seed)
          if (nid < 0) { v.alive = false; continue }
          v.s -= lane.len
          v.lane = nid
          v.next = -1
        }
      }
    }

    // knocked cars slide, spin down, and drive on once lined up with a lane
    let knocked = 0
    for (const v of this.vehicles) {
      if (!v.free) continue
      knocked++
      this._stepFree(v, dt)
    }
    this.stats.knocked = knocked

    this.vehicles = this.vehicles.filter((v) => v.alive)
    this.stats.vehicles = this.vehicles.length

    this._render(camera, dt)
  }

  _blocks(obstacles) {
    const blocks = new Map()
    for (const ob of obstacles) {
      const yM = -ob.z
      for (const id of this._lanesTouching(ob.x, yM, 12)) {
        const lane = this.lanes[id]
        const list = laneBlocks(lane, [ob], lane.halfW)
        if (!list.length) continue
        if (!blocks.has(id)) blocks.set(id, [])
        blocks.get(id).push(...list)
      }
    }
    for (const list of blocks.values()) list.sort((a, b) => a.s - b.s)
    return blocks
  }

  _stepFree(v, dt) {
    const f = v.free
    const sp = Math.hypot(f.vx, f.vz)
    if (sp > 1e-6) {
      const next = Math.max(0, sp - FREE_SCRUB * dt)
      f.vx *= next / sp
      f.vz *= next / sp
    }
    f.x += f.vx * dt
    f.z += f.vz * dt
    f.h += f.w * dt
    f.w *= Math.exp(-2.5 * dt)
    v.brake = 1
    const resting = sp < 0.05 && Math.abs(f.w) < 0.02
    f.rest = resting ? f.rest + dt : 0
    if (f.rest < REJOIN_AFTER) return
    // Rejoin: nearest lane that runs the way the car points.
    const yM = -f.z
    let best = null
    for (const id of this._lanesTouching(f.x, yM, 6)) {
      const lane = this.lanes[id]
      const proj = projectOnLane(lane, f.x, yM)
      if (Math.abs(proj.lateral) > 2.2) continue
      // car forward in the local plane
      const cx = Math.sin(f.h)
      const cy = -Math.cos(f.h)
      if (cx * proj.dir.x + cy * proj.dir.y < 0.85) continue
      if (!best || Math.abs(proj.lateral) < Math.abs(best.proj.lateral)) best = { id, proj }
    }
    if (best && best.proj.s < this.lanes[best.id].len - 1) {
      v.lane = best.id
      v.s = best.proj.s
      v.v = 0
      v.next = -1
      v.free = null
    } else {
      f.rest = 0   // try again in a few seconds (it may be pushed into line)
    }
  }

  _pointAt(lane, s) {
    const cum = lane.cum
    let i = 1
    while (i < cum.length - 1 && cum[i] < s) i++
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
    const a = lane.pts[i - 1]
    const b = lane.pts[i]
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
            Math.atan2(b[1] - a[1], b[0] - a[0])]
  }

  _render(camera, dt) {
    camera.updateMatrixWorld()
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(_pv)
    const hour = rt.clock.hour
    const rain = rt.clock.weather?.rain ?? 0
    const heads = Math.max(
      smoothstep(18.2, 19.2, hour) + (1 - smoothstep(6.0, 7.0, hour)),
      rain > 0.4 ? 0.8 : 0,
    )
    const night = Math.min(1, heads)
    const camX = camera.position.x
    const camZ = camera.position.z

    this.fleet.reset()
    for (const v of this.vehicles) {
      const t = v.type
      // world pose
      if (v.free) {
        v.wx = v.free.x
        v.wz = v.free.z
        v.wh = v.free.h
        v.wvx = v.free.vx
        v.wvz = v.free.vz
      } else {
        const lane = this.lanes[v.lane]
        const [x, y, head] = this._pointAt(lane, Math.min(v.s, lane.len))
        v.wx = x
        v.wz = -y
        // Lane heading is in the local plane (+x east, +y north); the models
        // face +Z, and world z is -y, so the session heading (forward =
        // (sin h, cos h)) is the lane heading plus a quarter turn.
        v.wh = head + Math.PI / 2
        v.wvx = Math.sin(v.wh) * v.v
        v.wvz = Math.cos(v.wh) * v.v
      }
      v.wy = this.groundY
      v.spin += (v.free ? 0 : v.v / t.wheelRadius) * dt
      // nose dips under braking, lifts a touch under power
      const pitchTarget = Math.max(-0.025, Math.min(0.03, -v.accel * 0.004))
      v.pitch += (pitchTarget - v.pitch) * Math.min(1, dt * 6)

      _sphere.center.set(v.wx, this.roadY + 0.9, v.wz)
      _sphere.radius = 4
      if (!this.frustum.intersectsSphere(_sphere)) continue
      const d = Math.hypot(v.wx - camX, v.wz - camZ)
      const lod = d < LOD0_DISTANCE ? 0 : d < LOD1_DISTANCE ? 1 : 2

      _e.set(v.pitch, v.wh, 0)
      _q.setFromEuler(_e)
      _p.set(v.wx, this.roadY, v.wz)
      _m.compose(_p, _q, _s)
      const used = this.fleet.put(t, lod, _m, v.paint, v.brake, heads,
        v.strobe, v.sign * night)
      if (used !== 0) continue
      // spinning wheels on the near model
      _spinQ.setFromAxisAngle(_xAxis, v.spin)
      for (const w of t.wheels) {
        _q.copy(_spinQ).multiply(w.quaternion)
        _w.compose(w.position, _q, _s)
        _w.premultiply(_m)
        this.fleet.putWheel(t, _w)
      }
    }
    this.fleet.flush()
  }
}
