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

import * as THREE from 'three'
import { VehicleFleet } from './vehicles.js'

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

function hash1(n) {
  let x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

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
    this.stats = { lanes: 0, vehicles: 0, simLanes: 0 }
  }

  async load(graphUrl = '/streets/street_graph.json') {
    const g = await fetch(graphUrl).then((r) => (r.ok ? r.json() : null))
    if (!g) { console.warn('[traffic] no street graph'); return this }
    await this.fleet.load('/tiles/vehicles.glb', this.maxVehicles)
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
          for (let i = 1; i < pts.length; i++) {
            cum.push(cum[i - 1] +
              Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
          }
          const id = this.lanes.length
          const heading = Math.atan2(
            pts[pts.length - 1][1] - pts[0][1],
            pts[pts.length - 1][0] - pts[0][0])
          this.lanes.push({
            id, from, to, pts, cum, len: cum[cum.length - 1],
            speed: Math.max(4, e.speed_mph * MPH),
            kind: e.kind, name: e.name, heading,
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

  // ---- signals ------------------------------------------------------------
  // Returns true when a lane may proceed through its end node.
  _green(lane) {
    if (!lane.signalled) return true
    const t = (this.clock + hash1(lane.to) * SIGNAL_CYCLE) % SIGNAL_CYCLE
    const phase = t < SIGNAL_CYCLE / 2 ? 0 : 1
    const within = t % (SIGNAL_CYCLE / 2)
    return phase === lane.axis && within < SIGNAL_GREEN
  }

  // ---- spawn / recycle ----------------------------------------------------
  _spawn(laneId, seed) {
    const lane = this.lanes[laneId]
    const type = this.fleet.pick(hash1(seed * 3.7))
    if (!type) return null
    // buses only on avenues and wide streets, trucks off tiny side streets
    if (type.key === 'bus' && lane.speed < 8) return null
    const v = {
      lane: laneId,
      s: hash1(seed * 11.3) * Math.max(1, lane.len - 6),
      v: lane.speed * (0.5 + hash1(seed * 5.1) * 0.4),
      type,
      seed,
      color: this.fleet.colorFor(type, seed | 0),
      alive: true,
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

  // ---- simulation ---------------------------------------------------------
  update(dt, camera) {
    if (!this.enabled || !this.fleet.ready || !this.lanes.length) return
    this.clock += dt
    dt = Math.min(dt, 0.1)

    // world z = -y_m
    const camX = camera.position.x
    const camY = -camera.position.z
    const inScope = this.lanesNear(camX, camY, SIM_RADIUS)
    this.stats.simLanes = inScope.size

    // recycle anything that has left the area or run off the end of its route
    const keep = []
    for (const v of this.vehicles) {
      const lane = this.lanes[v.lane]
      const p = this._pointAt(lane, Math.min(v.s, lane.len))
      if (Math.hypot(p[0] - camX, p[1] - camY) > DESPAWN) continue
      keep.push(v)
    }
    this.vehicles = keep

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

        const p = this._pointAt(lane, v.s)
        const d = Math.hypot(p[0] - camX, p[1] - camY)
        // Never materialise a car on top of the viewer, but keep the
        // exclusion tight: at 30 m the whole near field stayed empty and the
        // avenue read as deserted from the pavement.
        if (d > SIM_RADIUS || d < 12) continue

        this.vehicles.push(v)
        if (!occupied.has(id)) occupied.set(id, [])
        occupied.get(id).push(v)
      }
    }

    // car-following needs vehicles ordered along each lane
    const byLane = new Map()
    for (const v of this.vehicles) {
      if (!byLane.has(v.lane)) byLane.set(v.lane, [])
      byLane.get(v.lane).push(v)
    }
    for (const list of byLane.values()) list.sort((a, b) => a.s - b.s)

    for (const [laneId, list] of byLane) {
      const lane = this.lanes[laneId]
      for (let i = 0; i < list.length; i++) {
        const v = list[i]
        const ahead = list[i + 1]
        let target = lane.speed

        if (ahead) {
          const gap = ahead.s - v.s - v.type.length * 0.5 -
            ahead.type.length * 0.5
          const safe = GAP_MIN + v.v * REACTION
          if (gap < safe) {
            target = Math.max(0, ahead.v * (gap / Math.max(safe, 0.01)))
          }
        }

        // stop line at a red signal
        const toEnd = lane.len - v.s
        if (lane.signalled && !this._green(lane)) {
          const stopAt = 6.0
          if (toEnd < stopAt + v.v * v.v / (2 * BRAKE) + 4) {
            target = Math.min(target, Math.max(0, (toEnd - stopAt) * 0.9))
          }
        }
        target *= v.type.speedScale

        const a = target > v.v ? ACCEL : -BRAKE
        v.v = a > 0 ? Math.min(target, v.v + ACCEL * dt)
          : Math.max(target, v.v - BRAKE * dt)
        v.v = Math.max(0, v.v)
        v.s += v.v * dt

        if (v.s >= lane.len) {
          const nid = this._routeFrom(lane, v.seed)
          if (nid < 0) { v.alive = false; continue }
          v.s -= lane.len
          v.lane = nid
        }
      }
    }
    this.vehicles = this.vehicles.filter((v) => v.alive)
    this.stats.vehicles = this.vehicles.length

    this._render()
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

  _render() {
    const dummy = new THREE.Object3D()
    this.fleet.reset()
    for (const v of this.vehicles) {
      const t = v.type
      const mesh = t.mesh
      if (mesh.count >= t.capacity) continue
      const lane = this.lanes[v.lane]
      const [x, y, head] = this._pointAt(lane, Math.min(v.s, lane.len))
      dummy.position.set(x, this.roadY, -y)
      // Heading is measured in the local plane (+x east, +y north). World z
      // is -y, so the required world direction is (cos h, 0, -sin h) -- and a
      // Three.js Y-rotation of h takes the body's +x axis exactly there.
      dummy.rotation.set(0, head, 0)
      dummy.updateMatrix()
      const i = mesh.count++
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, v.color)
    }
    this.fleet.flush()
  }
}
