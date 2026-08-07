// corridor.js — the hero corridor, end to end.
//
//   penthouse -> lift -> lobby -> street -> car -> market -> car -> HQ
//             -> lift -> Floor 45 -> Shenron
//
// Every leg is the real thing rather than a cut. The lift ride moves the
// camera up the shaft inside an authored cab; the drive follows a route
// solved over the actual LION street graph with the authored cabin around
// the camera and the city's own traffic, crowd and weather running past the
// glass. Nothing here fades to black and resumes somewhere else.
//
// Two joins had to be built for it to make sense as a journey:
//
//   * the penthouse gets a lobby *in its own building*. interiors.js anchors
//     the penthouse and the lobby independently, so they landed in two
//     different towers half a mile apart -- you cannot take a lift between
//     those.
//   * the car is a ride, not a drive. The player is a passenger on the
//     driving legs and can look around but not steer. Calling it driving
//     would be a claim the controls do not support.
//
// SHENRON_form is an original abstract light form, not a character model.
// See the header of scripts/phase2/64_corridor.py.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

const LIFT_SPEED = 26.0     // m/s; a real express lift is 6-10, and a 460 m
                            // descent at 8 m/s is a minute of looking at a
                            // steel wall
const CAR_SPEED = 12.0      // m/s, about 27 mph
const CAR_EYE = [-0.10, 0.36, 1.07]   // matches 64_corridor.py

// One entry per leg. `kind` is what the runtime has to do; everything else is
// what the player is told.
const LEGS = [
  { key: 'penthouse', kind: 'room', room: 'penthouse',
    title: 'Penthouse', hint: 'Take the lift down' },
  { key: 'descend', kind: 'lift', to: 'home_lobby',
    title: 'Lift', hint: 'Descending' },
  { key: 'lobby', kind: 'room', room: 'home_lobby',
    title: 'Lobby', hint: 'Step out to the street' },
  { key: 'kerb', kind: 'street', title: 'Street', hint: 'Get in the car' },
  { key: 'drive_market', kind: 'drive', to: 'market',
    title: 'Driving', hint: 'To the market' },
  { key: 'market', kind: 'room', room: 'bodega',
    title: 'Corner market', hint: 'Back to the car' },
  { key: 'drive_hq', kind: 'drive', to: 'hq',
    title: 'Driving', hint: 'To the HQ' },
  { key: 'hq_lobby', kind: 'room', room: 'hq_lobby',
    title: 'HQ lobby', hint: 'Take the lift to Floor 45' },
  { key: 'ascend', kind: 'lift', to: 'hq_floor45',
    title: 'Lift', hint: 'Floor 45' },
  { key: 'floor45', kind: 'room', room: 'hq_floor45',
    title: 'Mission Control', hint: 'Walk to the dais' },
  { key: 'shenron', kind: 'arrive', title: 'Shenron', hint: '' },
]

const HOME_LOBBY = {
  key: 'home_lobby', mesh: 'INT_lobby', glass: 'GLAZE_lobby',
  label: 'Lobby', eye: [6.0, 0.0, 1.7],
  shot: { eye: [11.5, -6.0, 1.70], at: [1.5, 5.0, 1.70] },
  links: [{ to: 'penthouse', label: 'Lift — penthouse', at: [11.4, 5.6, 1.7] }],
}

// ---------------------------------------------------------------------------
// route solving over the drivable graph
// ---------------------------------------------------------------------------
class RoadNet {
  constructor(graph) {
    this.nodes = graph.nodes
    this.adj = new Map()
    this.edges = []
    for (const e of graph.edges) {
      if (!e.drivable) continue
      const ix = this.edges.push(e) - 1
      const push = (from, to, rev) => {
        if (!this.adj.has(from)) this.adj.set(from, [])
        this.adj.get(from).push({ to, ix, rev, w: e.length || 1 })
      }
      // One-way is respected: routing the corridor the wrong way up Eighth
      // Avenue and then driving it into oncoming traffic is worse than a
      // longer route. But `oneway` is tri-state -- 1 is a->b, -1 is b->a and
      // 0 is both -- and treating it as a boolean sends 4,271 of the 11,395
      // drivable edges the wrong way, which strands whole neighbourhoods.
      if (e.oneway >= 0) push(e.a, e.b, false)
      if (e.oneway <= 0) push(e.b, e.a, true)
    }
  }

  nearestNode(x, y) {
    let best = -1
    let bd = Infinity
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i]
      if (!this.adj.has(i)) continue
      const d = (n[0] - x) ** 2 + (n[1] - y) ** 2
      if (d < bd) { bd = d; best = i }
    }
    return best
  }

  // Dijkstra with a binary heap. 11,256 nodes, so a linear scan would be
  // 126 million comparisons for one route and this runs at boot.
  route(from, to) {
    const dist = new Float64Array(this.nodes.length).fill(Infinity)
    const prev = new Int32Array(this.nodes.length).fill(-1)
    const prevEdge = new Int32Array(this.nodes.length).fill(-1)
    const prevRev = new Uint8Array(this.nodes.length)
    const heap = [[0, from]]
    dist[from] = 0
    const pop = () => {
      const top = heap[0]
      const last = heap.pop()
      if (heap.length) {
        heap[0] = last
        let i = 0
        for (;;) {
          let s = i
          const l = 2 * i + 1
          const r = l + 1
          if (l < heap.length && heap[l][0] < heap[s][0]) s = l
          if (r < heap.length && heap[r][0] < heap[s][0]) s = r
          if (s === i) break
          ;[heap[i], heap[s]] = [heap[s], heap[i]]
          i = s
        }
      }
      return top
    }
    const push = (d, n) => {
      heap.push([d, n])
      let i = heap.length - 1
      while (i > 0) {
        const p = (i - 1) >> 1
        if (heap[p][0] <= heap[i][0]) break
        ;[heap[i], heap[p]] = [heap[p], heap[i]]
        i = p
      }
    }
    while (heap.length) {
      const [d, u] = pop()
      if (u === to) break
      if (d > dist[u]) continue
      for (const a of this.adj.get(u) || []) {
        const nd = d + a.w
        if (nd < dist[a.to]) {
          dist[a.to] = nd
          prev[a.to] = u
          prevEdge[a.to] = a.ix
          prevRev[a.to] = a.rev ? 1 : 0
          push(nd, a.to)
        }
      }
    }
    if (!isFinite(dist[to])) return null

    const pts = []
    let cur = to
    const chain = []
    while (cur !== from && prev[cur] >= 0) {
      chain.push([prevEdge[cur], prevRev[cur]])
      cur = prev[cur]
    }
    chain.reverse()
    for (const [ix, rev] of chain) {
      const p = this.edges[ix].pts
      const seq = rev ? [...p].reverse() : p
      for (const q of seq) {
        const last = pts[pts.length - 1]
        if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) > 0.5) {
          pts.push(q)
        }
      }
    }
    return { pts, length: dist[to], edges: chain.length }
  }
}

function polyLength(pts) {
  let L = 0
  for (let i = 1; i < pts.length; i++) {
    L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  }
  return L
}

export class Corridor {
  constructor(scene, city, interiors, hq, streamer) {
    this.scene = scene
    this.city = city
    this.interiors = interiors
    this.hq = hq
    this.streamer = streamer
    this.groundY = city?.meta?.land_level_m ?? 12.0
    this.ready = false
    this.active = false
    this.ix = -1
    this.t = 0
    this.routes = {}
    this.stats = { leg: null, title: '–', hint: '', progress: 0, legs: 0 }
  }

  async load(url = '/tiles/corridor.glb',
    graphUrl = '/streets/street_graph.json') {
    const [gltf, graph] = await Promise.all([
      new GLTFLoader().loadAsync(url + bust()).catch(() => null),
      fetch(graphUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    if (!gltf || !graph) {
      console.warn('[corridor] missing', !gltf && 'corridor.glb',
        !graph && 'street_graph.json')
      return this
    }
    const src = new Map()
    gltf.scene.traverse((o) => { if (o.isMesh) src.set(o.name, o) })
    this.src = src
    this.net = new RoadNet(graph)

    // ---- a lobby in the penthouse's own building -------------------------
    const pent = this.interiors.rooms.find((r) => r.key === 'penthouse')
    if (pent && pent.building) {
      const b = pent.building
      const lob = this.interiors.place(HOME_LOBBY, this.interiors.src,
        new THREE.Vector3(b.x, this.groundY, -b.y), pent.yaw,
        { building: b, atStreet: true })
      if (lob) {
        pent.links = [...(pent.links || []), {
          to: 'home_lobby', label: 'Lift — lobby',
          at: pent.local(11.4, 5.6, 1.7), room: null,
        }]
      }
      this.interiors.linkRooms()
    }

    // ---- the two driving routes -----------------------------------------
    const at = (key) => {
      if (key === 'hq') {
        const s = this.hq && this.hq.site
        return s ? { x: s.origin[0], y: s.origin[1] } : null
      }
      const r = this.interiors.rooms.find((x) => x.key === key)
      return r && r.building ? { x: r.building.x, y: r.building.y } : null
    }
    const home = at('home_lobby') || at('penthouse')
    const market = at('bodega')
    const hq = at('hq')
    if (home && market) this.routes.market = this._solve(home, market)
    if (market && hq) this.routes.hq = this._solve(market, hq)

    // ---- Shenron, on the dais -------------------------------------------
    const form = src.get('SHENRON_form')
    const f45 = this.hq && this.hq.rooms && this.hq.rooms.floor45
    if (form && f45) {
      const g = new THREE.Group()
      g.name = 'SHENRON'
      const m = new THREE.Mesh(form.geometry, this.interiors.material)
      m.name = 'SHENRON_form'
      g.add(m)
      const d = this.hq.spec.anchor.dais
      g.position.copy(f45.local(d.x, d.y, d.z))
      g.rotation.set(0, f45.yaw, 0)
      g.visible = false
      this.scene.add(g)
      this.shenron = g
      f45.group.add(new THREE.Object3D())   // keep the group's matrix live
    }

    // ---- the cab and the cabin, parented to nothing until needed --------
    this.lift = this._rig('LIFT_cab', 'GLAZE_lift')
    this.car = this._rig('CAR_cabin', 'GLAZE_car')

    this.ready = !!(this.routes.market && this.routes.hq)
    this.stats.legs = LEGS.length
    console.info('[corridor]',
      this.routes.market
        ? `${(this.routes.market.length / 1000).toFixed(2)} km to the market,`
        : 'no market route,',
      this.routes.hq
        ? `${(this.routes.hq.length / 1000).toFixed(2)} km to the HQ`
        : 'no HQ route')
    return this
  }

  _rig(name, glassName) {
    const body = this.src.get(name)
    if (!body) return null
    const g = new THREE.Group()
    g.name = name
    const m = new THREE.Mesh(body.geometry, this.interiors.material)
    m.name = name
    g.add(m)
    const gl = this.src.get(glassName)
    if (gl) {
      const gm = new THREE.Mesh(gl.geometry, this.interiors.glassMaterial)
      gm.name = glassName
      gm.userData.glaze = true
      g.add(gm)
    }
    g.visible = false
    this.scene.add(g)
    return g
  }

  _solve(a, b) {
    const from = this.net.nearestNode(a.x, a.y)
    const to = this.net.nearestNode(b.x, b.y)
    if (from < 0 || to < 0 || from === to) return null
    const r = this.net.route(from, to)
    if (!r || r.pts.length < 2) return null
    r.straight = Math.hypot(b.x - a.x, b.y - a.y)
    r.measured = polyLength(r.pts)
    return r
  }

  // ---- running it -------------------------------------------------------
  start(camera, controls) {
    if (!this.ready) return false
    this.active = true
    this.ix = -1
    this.camera = camera
    this.controls = controls
    this.next()
    return true
  }

  stop() {
    this.active = false
    this.ix = -1
    if (this.lift) this.lift.visible = false
    if (this.car) this.car.visible = false
    this.interiors.exit()
    this.stats.leg = null
    this.stats.title = '–'
    this.stats.hint = ''
    this.stats.progress = 0
  }

  next() {
    if (!this.active) return null
    this.ix++
    this.t = 0
    if (this.ix >= LEGS.length) { this.stop(); return null }
    const leg = LEGS[this.ix]
    this.stats.leg = leg.key
    this.stats.title = leg.title
    this.stats.hint = leg.hint
    this.stats.progress = 0
    this._enter(leg)
    return leg
  }

  _room(key) { return this.interiors.rooms.find((r) => r.key === key) }

  _look(eye, at) {
    const c = this.camera
    c.position.copy(eye)
    c.lookAt(at)
    const e = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ')
    this.controls.yaw = e.y
    this.controls.pitch = e.x
  }

  _enter(leg) {
    if (this.lift) this.lift.visible = false
    if (this.car) this.car.visible = false

    if (leg.kind === 'room') {
      const r = this._room(leg.room)
      if (!r) return
      this.interiors.enter(r)
      this._look(r.shot ? r.shot.eye : r.eyeWorld,
        r.shot ? r.shot.at : r.lookAt)
      this.controls.mode = 'walk'
      if (leg.room === 'hq_floor45' && this.shenron) {
        this.shenron.visible = true
      }
      return
    }

    if (leg.kind === 'lift') {
      const from = this._room(LEGS[this.ix - 1].room)
      const to = this._room(leg.to)
      if (!from || !to) return
      this.interiors.exit()
      // The cab rides the shaft: same plan position as the room it leaves,
      // travelling to the height of the room it arrives at.
      const p = from.local(2.0, 0, 0)
      this._liftFrom = p.y
      this._liftTo = to.local(2.0, 0, 0).y
      this._liftYaw = from.yaw
      this._liftXZ = p
      this._liftT = Math.abs(this._liftTo - this._liftFrom) / LIFT_SPEED + 1.4
      this.lift.position.set(p.x, p.y, p.z)
      this.lift.rotation.set(0, from.yaw, 0)
      this.lift.visible = true
      this.interiors.lamp.intensity = 1.6
      this.controls.mode = 'walk'
      this.lift.updateMatrixWorld(true)
      // face the doors and the floor indicator, which is what you look at in
      // a lift. Without this the camera kept whatever heading the previous
      // leg left it with and rode 460 m staring into a corner.
      this._look(this.lift.localToWorld(new THREE.Vector3(1.15, 1.7, 0)),
        this.lift.localToWorld(new THREE.Vector3(-3.0, 1.45, 0)))
      return
    }

    if (leg.kind === 'street') {
      const r = this._room(LEGS[this.ix - 1].room)
      if (!r) return
      this.interiors.exit()
      this.camera.position.copy(r.door)
      this.controls.mode = 'walk'
      return
    }

    if (leg.kind === 'drive') {
      const route = this.routes[leg.to === 'market' ? 'market' : 'hq']
      if (!route) return
      this.interiors.exit()
      this._route = route
      this._routeLen = route.measured
      this._driveT = this._routeLen / CAR_SPEED
      this.car.visible = true
      this.controls.mode = 'walk'
      // A car interior in daylight is full of bounce off the road and the
      // buildings; the scene's sun reaches none of it, so without a fill the
      // dashboard and wheel render as black cut-outs. Kept low so the city
      // through the glass is still the bright thing.
      this.interiors.lamp.intensity = 0.62
      this._carYaw = undefined
      this._driveAt(0)
      return
    }

    if (leg.kind === 'arrive') {
      const r = this._room('hq_floor45')
      if (!r || !this.shenron) return
      this.interiors.enter(r)
      this.shenron.visible = true
      // Stand between the glass and the dais, off to one side, so the form
      // is against the room rather than against the window. d.x - 5.6 put
      // the camera at room-local x = -0.8, which is outside the room and
      // inside the tower's curtain wall: the capture came back a flat colour.
      const d = this.hq.spec.anchor.dais
      this._look(r.local(1.6, d.y - 3.4, 1.72),
        r.local(d.x, d.y, d.z + 1.8))
      this.controls.mode = 'walk'
    }
  }

  // Position along the route at parameter u in [0, 1], and the heading there.
  _driveAt(u) {
    const pts = this._route.pts
    const want = u * this._routeLen
    let acc = 0
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0],
        pts[i][1] - pts[i - 1][1])
      if (acc + seg >= want || i === pts.length - 1) {
        const t = seg > 1e-6 ? (want - acc) / seg : 0
        const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t
        const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t
        const dx = pts[i][0] - pts[i - 1][0]
        const dy = pts[i][1] - pts[i - 1][1]
        // world forward for yaw a is (-sin a, 0, -cos a); world z = -y
        const yaw = Math.atan2(-dx, dy)
        this.car.position.set(x, this.groundY + 0.02, -y)
        this.car.rotation.set(0, yaw, 0)
        this.car.updateMatrixWorld(true)
        // driver's eye: cabin-local (x fwd, y left, z up) -> mesh (x, z, -y)
        const eye = this.car.localToWorld(new THREE.Vector3(
          CAR_EYE[0], CAR_EYE[2], -CAR_EYE[1]))
        this.camera.position.copy(eye)
        if (this._carYaw === undefined) {
          this._look(eye, this.car.localToWorld(new THREE.Vector3(
            CAR_EYE[0] + 30.0, CAR_EYE[2] - 1.0, -CAR_EYE[1])))
        } else {
          // Turn the view with the car, but by the *delta*, so mouse-look
          // still works during the ride. Re-aiming at the road every frame
          // would nail the head to the windscreen.
          let d = yaw - this._carYaw
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          this.controls.yaw += d
        }
        this._carYaw = yaw
        return
      }
      acc += seg
    }
  }

  update(dt) {
    if (!this.active || this.ix < 0 || this.ix >= LEGS.length) return this.stats
    const leg = LEGS[this.ix]
    this.t += dt
    if (this.shenron && this.shenron.visible) {
      this.shenron.rotation.y += dt * 0.28
    }

    if (leg.kind === 'lift') {
      const u = Math.min(1, this.t / this._liftT)
      // ease in and out; a lift that starts at line speed is a lift crash
      const s = u * u * (3 - 2 * u)
      const y = this._liftFrom + (this._liftTo - this._liftFrom) * s
      this.lift.position.y = y
      // localToWorld reads matrixWorld, which the renderer only refreshes on
      // its own traversal -- without this the camera trails the cab by a
      // frame, which at 26 m/s is most of a metre
      this.lift.updateMatrixWorld(true)
      const p = this.lift.localToWorld(new THREE.Vector3(1.15, 1.7, 0))
      this.camera.position.copy(p)
      this.stats.progress = u
      if (u >= 1) this.next()
      return this.stats
    }

    if (leg.kind === 'drive') {
      const u = Math.min(1, this.t / this._driveT)
      this._driveAt(u)
      this.stats.progress = u
      if (u >= 1) this.next()
      return this.stats
    }

    this.stats.progress = 0
    return this.stats
  }

  // ---- verification ------------------------------------------------------
  // The route has to be a route, not a straight line through the blocks, and
  // it has to stay on the carriageway. Detour ratio catches the first; the
  // second is checked by sampling the polyline against the graph it came
  // from -- every sample should be within a lane of some drivable edge.
  verify() {
    const out = { ok: true, checks: [] }
    const say = (name, ok, d) => {
      out.checks.push({ name, ok, ...d })
      if (!ok) out.ok = false
    }
    for (const [key, r] of Object.entries(this.routes)) {
      if (!r) { say(`route ${key}`, false, { reason: 'unsolved' }); continue }
      const ratio = r.measured / Math.max(1, r.straight)
      say(`route ${key} is a road route`, ratio > 1.05 && ratio < 2.6, {
        straight_m: +r.straight.toFixed(1),
        driven_m: +r.measured.toFixed(1),
        detour_ratio: +ratio.toFixed(2),
        edges: r.edges, points: r.pts.length,
      })
      // sample every 25 m and find the nearest drivable centreline
      let worst = 0
      let n = 0
      for (let d = 0; d < r.measured; d += 25) {
        const p = this._pointAt(r, d)
        const e = this._nearestCentreline(p[0], p[1])
        worst = Math.max(worst, e)
        n++
      }
      say(`route ${key} stays on the road`, worst < 1.0, {
        samples: n, worst_offset_m: +worst.toFixed(2),
      })
    }
    const f45 = this.hq && this.hq.rooms && this.hq.rooms.floor45
    if (this.shenron && f45) {
      const g = this.shenron.position
      const d = this.hq.spec.anchor.dais
      const want = f45.local(d.x, d.y, d.z)
      say('Shenron stands on the dais', g.distanceTo(want) < 0.01, {
        offset_m: +g.distanceTo(want).toFixed(3),
        world_y: +g.y.toFixed(2),
      })
    }
    say('every leg is reachable',
      LEGS.every((l) => l.kind !== 'room' || !!this._room(l.room)), {
        legs: LEGS.length,
        rooms: LEGS.filter((l) => l.kind === 'room').map((l) => l.room),
        missing: LEGS.filter((l) => l.kind === 'room' && !this._room(l.room))
          .map((l) => l.room),
      })
    return out
  }

  _pointAt(r, want) {
    let acc = 0
    for (let i = 1; i < r.pts.length; i++) {
      const seg = Math.hypot(r.pts[i][0] - r.pts[i - 1][0],
        r.pts[i][1] - r.pts[i - 1][1])
      if (acc + seg >= want) {
        const t = seg > 1e-6 ? (want - acc) / seg : 0
        return [r.pts[i - 1][0] + (r.pts[i][0] - r.pts[i - 1][0]) * t,
          r.pts[i - 1][1] + (r.pts[i][1] - r.pts[i - 1][1]) * t]
      }
      acc += seg
    }
    return r.pts[r.pts.length - 1]
  }

  _nearestCentreline(x, y) {
    let best = Infinity
    for (const e of this.net.edges) {
      const p = e.pts
      for (let i = 1; i < p.length; i++) {
        const ax = p[i - 1][0]; const ay = p[i - 1][1]
        const vx = p[i][0] - ax; const vy = p[i][1] - ay
        const L2 = vx * vx + vy * vy
        const t = L2 <= 1e-9 ? 0
          : Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2))
        const d = Math.hypot(x - (ax + vx * t), y - (ay + vy * t))
        if (d < best) best = d
        if (best < 0.05) return best
      }
    }
    return best
  }
}

export { LEGS }
