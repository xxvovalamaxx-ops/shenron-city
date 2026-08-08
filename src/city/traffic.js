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
import { buildLaneGraph, hash1, lanesNear, pointAt, routeNextLaneWith } from './street-nav.js'

const SIM_RADIUS = 520       // simulate lanes within this of the camera
const DESPAWN = 620

const GAP_MIN = 2.2          // bumper gap at a stop
const REACTION = 1.15        // seconds of headway to the vehicle ahead
const ACCEL = 3.4            // m/s^2
const BRAKE = 7.5
const SIGNAL_CYCLE = 26.0    // seconds for a full two-phase cycle
const SIGNAL_GREEN = 11.0    // green per phase, rest is all-red clearance

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
    // Vehicles the player's simulation owns, driving the same graph. They
    // participate in car-following and spawn occupancy but are never
    // advanced or rendered by this sim — see setGhosts.
    this.ghosts = []
    this.stats = { lanes: 0, vehicles: 0, simLanes: 0 }
  }

  async load(graphUrl = '/models/manhattan/streets/street_graph.json') {
    const g = await fetch(graphUrl).then((r) => (r.ok ? r.json() : null))
    if (!g) { console.warn('[traffic] no street graph'); return this }
    await this.fleet.load('/models/manhattan/vehicles.glb', this.maxVehicles)
    const { lanes, nodeLanes, grid, nodes } = buildLaneGraph(g, this.demand)
    this.lanes = lanes
    this.nodeLanes = nodeLanes
    this.grid = grid
    this.nodes = nodes
    this.stats.lanes = this.lanes.length
    return this
  }

  // Ghost vehicles: { lane, s, v, length, ghost } driven by another sim.
  // They slot into the same car-following order as real vehicles so city
  // traffic brakes for them, and they occupy spawn space so a new car is
  // never materialised inside the player's car.
  setGhosts(list) {
    this.ghosts = list
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

  // ---- simulation ---------------------------------------------------------
  update(dt, camera) {
    if (!this.enabled || !this.fleet.ready || !this.lanes.length) return
    this.clock += dt
    dt = Math.min(dt, 0.1)

    // world z = -y_m
    const camX = camera.position.x
    const camY = -camera.position.z
    const inScope = lanesNear(this.grid, camX, camY, SIM_RADIUS)
    this.stats.simLanes = inScope.size

    // recycle anything that has left the area or run off the end of its route
    const keep = []
    for (const v of this.vehicles) {
      const lane = this.lanes[v.lane]
      const p = pointAt(lane, Math.min(v.s, lane.len))
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
      // this check the first frame after a spawn shows interpenetration.
      // Ghosts occupy their lane too: the player's car is never a spawn slot.
      const occupied = new Map()
      for (const v of this.vehicles) {
        if (!occupied.has(v.lane)) occupied.set(v.lane, [])
        occupied.get(v.lane).push(v)
      }
      for (const g of this.ghosts) {
        if (!this.lanes[g.lane]) continue
        if (!occupied.has(g.lane)) occupied.set(g.lane, [])
        occupied.get(g.lane).push(g)
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
            const oLen = o.type ? o.type.length : o.length
            const need = (v.type.length + oLen) * 0.5 + GAP_MIN
            if (Math.abs(o.s - v.s) < need) { clash = true; break }
          }
          if (clash) continue
        }

        const p = pointAt(lane, v.s)
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

    // car-following needs vehicles ordered along each lane; ghosts join the
    // same order so city traffic brakes for the player's car
    const byLane = new Map()
    for (const v of this.vehicles) {
      if (!byLane.has(v.lane)) byLane.set(v.lane, [])
      byLane.get(v.lane).push(v)
    }
    for (const g of this.ghosts) {
      if (!this.lanes[g.lane]) continue
      if (!byLane.has(g.lane)) byLane.set(g.lane, [])
      byLane.get(g.lane).push(g)
    }
    for (const list of byLane.values()) list.sort((a, b) => a.s - b.s)

    for (const [laneId, list] of byLane) {
      const lane = this.lanes[laneId]
      for (let i = 0; i < list.length; i++) {
        const v = list[i]
        if (v.ghost) continue
        const ahead = list[i + 1]
        let target = lane.speed

        if (ahead) {
          const aheadLen = ahead.type ? ahead.type.length : ahead.length
          const gap = ahead.s - v.s - v.type.length * 0.5 - aheadLen * 0.5
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
          const nid = routeNextLaneWith(this.lanes, lane, v.seed)
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

  _render() {
    const dummy = new THREE.Object3D()
    this.fleet.reset()
    for (const v of this.vehicles) {
      const t = v.type
      const mesh = t.mesh
      if (mesh.count >= t.capacity) continue
      const lane = this.lanes[v.lane]
      const [x, y, head] = pointAt(lane, Math.min(v.s, lane.len))
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
