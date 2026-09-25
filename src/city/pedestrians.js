// pedestrians.js — a crowd walking the surveyed sidewalk network.
//
// The lanes come from 48_build_walk.py, which offset the LION centrelines and
// then kept only the stretches that land inside the planimetric sidewalk
// survey. So nobody walks up the middle of the FDR, and nobody walks on water.
//
// This file is the simulation: who is where, walking, waiting at a kerb,
// standing on a corner, or running from a car that is coming too fast. The
// visuals live in world/life/crowd-renderer.ts: rigged CC0 bodies whose clips
// are baked into a bone texture and played back on instanced meshes, so every
// person here costs a matrix and three small vectors per frame.
//
// A pedestrian's look (outfit, clothes, skin, hair, height) is a pure
// function of their seed — world/life/crowd-variants.ts — and their gait is
// driven by how fast they are actually moving: someone stopped at a kerb stops
// moving their legs, because the walk clip's phase only advances with ground
// covered.

import { CrowdRenderer } from '../world/life/crowd-renderer'
import { CROWD_VARIANTS, crowdLook, packRGB, rand01 } from '../world/life/crowd-variants'
import {
  animRows, cycleRate, newAnimState, playClip, stepAnim,
} from '../world/life/crowd-anim'
import { rt } from '../gameplay/runtime'

const SIM_RADIUS = 240       // people are small; there is no point simulating
const DESPAWN = 300          // a crowd you cannot resolve
const CELL = 200
const MAX_PEDS = 900

const WALK_MIN = 1.05        // m/s — the measured Manhattan average is ~1.4
const WALK_MAX = 1.75
const RUN_MIN = 3.6
const RUN_MAX = 5.2

// Share of the population standing still — on a phone, talking, waiting for
// someone — rather than walking. Placed at corners and bus shelters.
const STANDING_SHARE = 0.13
// Chance a walker stops at the end of a block, as if for the light.
const KERB_STOP = 0.4

// A car is a threat above this speed (m/s, ~32 km/h), within this range.
const THREAT_SPEED = 9
const THREAT_RANGE = 16

function hash1(n) {
  const x = Math.sin(n * 91.7) * 43758.5453
  return x - Math.floor(x)
}

export class Crowd {
  constructor(scene, city, demand = null) {
    this.scene = scene
    this.demand = demand
    this.walkY = (city?.meta?.land_level_m ?? 12.0) + 0.20
    this.renderer = new CrowdRenderer(scene)
    this.lanes = []
    this.nodeLanes = new Map()
    this.grid = new Map()
    this.people = []
    this.enabled = true
    this.ready = false
    this.clock = 0
    this.stats = { lanes: 0, people: 0, simLanes: 0, standing: 0, fleeing: 0 }
    // World-space (x, z) of every simulated pedestrian, refreshed each frame.
    this._xz = new Float32Array(MAX_PEDS * 2 + 64)
    this._xzCount = 0
    this._threatLast = null
    this._rows = { a: 0, b: 0, w: 0 }
    this._inst = {
      x: 0, y: 0, z: 0, yaw: 0, scale: 1, variant: 0,
      rowA: 0, rowB: 0, w: 0, prop: false,
      pal0: [0, 0, 0, 0], pal1: [0, 0],
    }
  }

  async load(graphUrl = '/models/manhattan/streets/walk_graph.json') {
    const g = await fetch(graphUrl).then((r) => (r.ok ? r.json() : null))
    if (!g) { console.warn('[crowd] no walk graph'); return this }
    await this.renderer.load()
    this._buildLanes(g)
    this.stats.lanes = this.lanes.length
    this.ready = this.renderer.ready && this.lanes.length > 0
    return this
  }

  _buildLanes(g) {
    for (const l of g.lanes) {
      if (!l.pts || l.pts.length < 2) continue
      const cum = [0]
      for (let i = 1; i < l.pts.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0],
          l.pts[i][1] - l.pts[i - 1][1]))
      }
      const id = this.lanes.length
      // wl/wr are per-vertex free half-widths in decimetres, measured off the
      // sidewalk survey by 48_build_walk.py. They are the reason a walker can
      // spread across a wide pavement without being pushed into a wall on a
      // narrow one.
      this.lanes.push({ id, a: l.a, b: l.b, pts: l.pts, cum,
        len: cum[cum.length - 1], w: l.w || 3.0, name: l.nm || '',
        wl: l.wl || null, wr: l.wr || null })
      for (const n of [l.a, l.b]) {
        if (n == null) continue
        if (!this.nodeLanes.has(n)) this.nodeLanes.set(n, [])
        this.nodeLanes.get(n).push(id)
      }
      const seen = new Set()
      for (const p of l.pts) {
        const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`
        if (seen.has(k)) continue
        seen.add(k)
        if (!this.grid.has(k)) this.grid.set(k, [])
        this.grid.get(k).push(id)
      }
    }
  }

  lanesNear(xM, yM, radius) {
    const r = Math.ceil(radius / CELL)
    const cx = Math.floor(xM / CELL)
    const cy = Math.floor(yM / CELL)
    const out = []
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const list = this.grid.get(`${cx + dx},${cy + dy}`)
        if (list) out.push(...list)
      }
    }
    return out
  }

  /**
   * Read-only view of where the crowd is: `xz` holds `count` world-space
   * (x, z) pairs. For the vehicle sim or anything else that needs to know
   * where people are without owning them. Valid until the next update.
   */
  positions() {
    return { count: this._xzCount, xz: this._xz }
  }

  _person(seed, laneId) {
    const look = crowdLook(seed)
    const variant = CROWD_VARIANTS[look.variant]
    return {
      seed,
      lane: laneId,
      s: 0,
      dir: 1,
      lat: 0,
      latTarget: 0,
      v: WALK_MIN + rand01(seed, 21) * (WALK_MAX - WALK_MIN),
      look,
      gender: variant.gender,
      pal0: [packRGB(look.skin), packRGB(look.hair), packRGB(look.top), packRGB(look.bottom)],
      pal1: [packRGB(look.shoes), packRGB(look.accent)],
      mode: 'walk',
      timer: 0,
      anim: newAnimState('Walk', rand01(seed, 22)),
      prop: false,
      // standing people have a fixed spot
      px: 0, py: 0, yaw: 0,
      alive: true,
    }
  }

  _spawnWalker(laneId, seed) {
    const lane = this.lanes[laneId]
    const p = this._person(seed, laneId)
    p.dir = hash1(seed * 7.7) < 0.5 ? 1 : -1
    p.s = hash1(seed * 13.9) * lane.len
    // `lat` is a fraction of the free width on the walker's own side, not a
    // distance: the actual metres are looked up per vertex at render time.
    // Signed in the lane's forward frame, so keeping right means positive
    // going forward and negative coming back, and the two streams pass each
    // other instead of stacking into one file.
    p.lat = p.dir * (0.22 + hash1(seed * 5.3) * 0.78)
    p.latTarget = p.lat
    return p
  }

  // People who are not going anywhere: on a corner, by a bus shelter, often
  // in twos and threes facing each other.
  _spawnStanding(laneId, seed, out) {
    const lane = this.lanes[laneId]
    if (lane.len < 6) return
    const atEnd = rand01(seed, 31) < 0.5
    const s = atEnd ? lane.len - 1.5 - rand01(seed, 32) * 4 : 1.5 + rand01(seed, 32) * 4
    const [x, y, head, seg] = this._pointAt(lane, s)
    // stand toward the building line, out of the walking stream
    const side = rand01(seed, 33) < 0.5 ? 1 : -1
    const off = side * (0.55 + rand01(seed, 34) * 0.4) * this._widthAt(lane, seg, side > 0)
    const cx = x + Math.sin(head) * off
    const cy = y - Math.cos(head) * off
    const group = rand01(seed, 35) < 0.45 ? 2 + (rand01(seed, 36) < 0.3 ? 1 : 0) : 1
    for (let k = 0; k < group; k++) {
      const p = this._person(seed * 7 + k * 131 + 1, laneId)
      p.mode = 'stand'
      p.s = s
      p.lat = off
      let px = cx
      let py = cy
      let yaw
      if (group > 1) {
        // around a small circle, everyone facing its centre
        const a = (k / group) * Math.PI * 2 + rand01(seed, 37) * 6.28
        const r = 0.45 + 0.1 * group
        px += Math.cos(a) * r
        py += Math.sin(a) * r
        yaw = Math.atan2(cy - py, cx - px)
        p.anim = newAnimState(rand01(seed, 40 + k) < 0.2 ? 'Wave' : 'Idle_Neutral', rand01(seed, 50 + k))
      } else {
        // alone: facing the street, or head down in a phone
        yaw = head + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rand01(seed, 38) - 0.5) * 1.2
        const phone = rand01(seed, 39) < 0.55
        p.anim = newAnimState(phone ? 'Phone' : 'Idle', rand01(seed, 50))
        p.prop = phone
      }
      p.px = px
      p.py = py
      p.yaw = yaw
      p.timer = 4 + rand01(seed, 60 + k) * 10
      out.push(p)
    }
  }

  _routeFrom(lane, dir, seed) {
    const node = dir === 1 ? lane.b : lane.a
    const out = this.nodeLanes.get(node)
    if (!out || !out.length) return null
    // Prefer carrying straight on rather than pivoting back down the same
    // pavement, but a corner is a perfectly normal thing for a person to turn.
    const cands = out.filter((id) => id !== lane.id)
    const pickFrom = cands.length ? cands : out
    const id = pickFrom[(hash1(seed + this.clock) * pickFrom.length) | 0] ??
      pickFrom[0]
    const next = this.lanes[id]
    // enter from whichever end joins this node
    return { lane: id, dir: next.a === node ? 1 : -1 }
  }

  // The player's car, when it is being driven fast enough to scare people.
  _threat(dt) {
    const pos = rt.player.pos
    const last = this._threatLast
    this._threatLast = { x: pos.x, y: pos.y, z: pos.z }
    if (!last || dt <= 0 || rt.player.flying) return null
    const vx = (pos.x - last.x) / dt
    const vz = (pos.z - last.z) / dt
    const speed = Math.hypot(vx, vz)
    // a teleport (respawn, capture pose) is not a car
    if (speed < THREAT_SPEED || speed > 120) return null
    if (Math.abs(pos.y - this.walkY) > 6) return null
    return { x: pos.x, z: pos.z, vx: vx / speed, vz: vz / speed, speed }
  }

  _scare(p, lane, threat, wx, wz) {
    const rx = wx - threat.x
    const rz = wz - threat.z
    const d = Math.hypot(rx, rz)
    if (d > THREAT_RANGE) return
    const ahead = rx * threat.vx + rz * threat.vz
    const across = Math.abs(rx * threat.vz - rz * threat.vx)
    if (ahead < -3 || (across > 7 && d > 6)) return
    // run along the pavement away from the car, and toward the building line
    const [, , head, seg] = this._pointAt(lane, Math.min(Math.max(p.s, 0), lane.len))
    const fx = Math.cos(head)
    const fz = -Math.sin(head)
    p.dir = rx * fx + rz * fz >= 0 ? 1 : -1
    const rightX = Math.sin(head)
    const rightZ = Math.cos(head)
    const side = rx * rightX + rz * rightZ >= 0 ? 1 : -1
    if (p.mode === 'stand') {
      // leave the spot: become a walker on the same lane, where they stood
      const w = this._widthAt(lane, seg, p.lat >= 0) || 1
      p.lat = Math.max(-1, Math.min(1, p.lat / w))
    }
    p.latTarget = side * 0.95
    p.mode = 'flee'
    p.prop = false
    p.timer = 2.5 + rand01(p.seed, 70) * 2
    p.runV = RUN_MIN + rand01(p.seed, 71) * (RUN_MAX - RUN_MIN)
    playClip(p.anim, 'Run', rand01(p.seed, 72))
  }

  // Dev inspection: `?crowdLineup=<clip>` stands one of every outfit in a row
  // four metres in front of the camera, playing that clip in place.
  _lineup(camera, clip, from) {
    const fx = -Math.sin(camera.rotation.y)
    const fz = -Math.cos(camera.rotation.y)
    const dir = new camera.position.constructor()
    camera.getWorldDirection(dir)
    const len = Math.hypot(dir.x, dir.z) || 1
    const ux = dir.x / len || fx
    const uz = dir.z / len || fz
    const n = Math.min(7, CROWD_VARIANTS.length - from)
    this.people = []
    for (let k = 0; k < n; k++) {
      const i = from + k
      let seed = 1
      while (crowdLook(seed).variant !== i) seed++
      const p = this._person(seed, 0)
      const across = (k - (n - 1) / 2) * 0.72
      const wx = camera.position.x + ux * 4.5 - uz * across
      const wz = camera.position.z + uz * 4.5 + ux * across
      p.mode = 'stand'
      p.px = wx
      p.py = -wz
      // face the camera
      p.yaw = Math.atan2(uz, -ux)
      p.anim = newAnimState(clip, i / n)
      p.prop = clip === 'Phone'
      p.timer = 1e9
      this.people.push(p)
    }
  }

  update(dt, camera) {
    if (!this.enabled || !this.ready) return
    dt = Math.min(dt, 0.1)
    this.clock = (this.clock || 0) + dt

    if (import.meta.env?.DEV && typeof location !== 'undefined') {
      const q = new URLSearchParams(location.search)
      const clip = q.get('crowdLineup')
      if (clip) {
        if (!this._lined) {
          this._lined = true
          this._lineup(camera, clip, Number(q.get('lineupFrom') || 0))
        }
        for (const p of this.people) stepAnim(p.anim, Math.max(dt, 1 / 60), this._idleRate(p))
        this._render(camera)
        return
      }
    }

    const camX = camera.position.x
    const camY = -camera.position.z
    const inScope = this.lanesNear(camX, camY, SIM_RADIUS)
    this.stats.simLanes = inScope.length

    const keep = []
    for (const p of this.people) {
      let ax
      let ay
      if (p.mode === 'stand') {
        ax = p.px
        ay = p.py
      } else {
        const lane = this.lanes[p.lane]
        const at = this._pointAt(lane, Math.min(Math.max(p.s, 0), lane.len))
        ax = at[0]
        ay = at[1]
      }
      if (Math.hypot(ax - camX, ay - camY) > DESPAWN) continue
      keep.push(p)
    }
    this.people = keep

    // Density comes from what is built here, not from how much pavement is in
    // view. Scoping by pavement is a measure of street layout: it made a SoHo
    // side street busier than Times Square, because SoHo has more small
    // streets per hectare than Midtown has.
    const here = this.demand?.ready
      ? this.demand.pedSmooth(camX, camY) : 0.45
    this.stats.demand = +here.toFixed(3)
    const want = Math.min(MAX_PEDS,
      Math.round(inScope.length * 0.30 * (0.25 + 3.2 * here)))
    if (this.people.length < want && inScope.length) {
      // Same lesson as the traffic: a uniform pick over a disc puts almost
      // everyone in the far ring, because area grows with r squared.
      const withDist = inScope.map((id) => {
        const lane = this.lanes[id]
        const p = lane.pts[(lane.pts.length / 2) | 0]
        return { id, d: Math.hypot(p[0] - camX, p[1] - camY) }
      }).sort((a, b) => a.d - b.d)

      let standing = 0
      for (const p of this.people) if (p.mode === 'stand') standing++

      let guard = 0
      while (this.people.length < want && guard++ < 500) {
        const ix = Math.min(withDist.length - 1,
          (Math.random() ** 2 * withDist.length) | 0)
        const lane = this.lanes[withDist[ix].id]
        if (!lane || lane.len < 4) continue
        // Within the scope, prefer the blocks that actually generate footfall,
        // so the Macy's frontage fills before the service street behind it.
        if (this.demand?.ready) {
          const mid = lane.pts[(lane.pts.length / 2) | 0]
          if (Math.random() >
              0.20 + 0.80 * this.demand.pedSmooth(mid[0], mid[1])) continue
        }
        const seed = (Math.random() * 1e6) | 0
        if (standing < want * STANDING_SHARE) {
          const group = []
          this._spawnStanding(lane.id, seed, group)
          for (const p of group) {
            const d = Math.hypot(p.px - camX, p.py - camY)
            if (d > SIM_RADIUS || d < 4) continue
            this.people.push(p)
            standing++
          }
          continue
        }
        const p = this._spawnWalker(lane.id, seed)
        const at = this._pointAt(lane, p.s)
        const d = Math.hypot(at[0] - camX, at[1] - camY)
        if (d > SIM_RADIUS || d < 4) continue
        this.people.push(p)
      }
    }

    const threat = dt > 0 ? this._threat(dt) : null
    let standingNow = 0
    let fleeing = 0
    for (const p of this.people) {
      const lane = this.lanes[p.lane]
      if (threat && p.mode !== 'flee') {
        const wx = p.mode === 'stand' ? p.px : this._pointAt(lane, Math.min(Math.max(p.s, 0), lane.len))[0]
        const wy = p.mode === 'stand' ? p.py : this._pointAt(lane, Math.min(Math.max(p.s, 0), lane.len))[1]
        this._scare(p, lane, threat, wx, -wy)
      }
      if (p.mode === 'stand') {
        standingNow++
        p.timer -= dt
        if (p.timer <= 0 && p.anim.clip !== 'Phone') {
          // conversation: an occasional gesture between long listens
          const r = rand01(p.seed, (this.clock * 10) | 0)
          playClip(p.anim, r < 0.25 ? 'Wave' : r < 0.4 ? 'Interact' : 'Idle_Neutral')
          p.timer = 3 + r * 7
        }
        stepAnim(p.anim, dt, this._idleRate(p))
        continue
      }
      if (p.mode === 'wait') {
        p.timer -= dt
        stepAnim(p.anim, dt, this._idleRate(p))
        if (p.timer > 0) continue
        p.mode = 'walk'
        p.prop = false
        playClip(p.anim, 'Walk', rand01(p.seed, 23))
        this._advanceLane(p, lane)
        continue
      }
      const running = p.mode === 'flee'
      if (running) {
        fleeing++
        p.timer -= dt
        if (p.timer <= 0) {
          p.mode = 'walk'
          playClip(p.anim, 'Walk', rand01(p.seed, 24))
        }
      }
      const v = running ? p.runV : p.v
      p.s += v * p.dir * dt
      // drift toward the wanted side of the pavement, a stride at a time
      p.lat += (p.latTarget - p.lat) * Math.min(1, dt * (running ? 3 : 0.8))
      const clip = running ? 'Run' : 'Walk'
      stepAnim(p.anim, dt, cycleRate(v,
        this.renderer.cycleMetres(p.gender, clip), p.look.scale))
      if (p.s > lane.len || p.s < 0) {
        if (!running && rand01(p.seed, (this.clock * 3) | 0) < KERB_STOP) {
          // wait at the kerb for the light, facing the crossing
          p.s = Math.min(lane.len, Math.max(0, p.s))
          p.mode = 'wait'
          p.timer = 2 + rand01(p.seed, (this.clock * 7) | 0) * 7
          const phone = rand01(p.seed, 25) < 0.2
          p.prop = phone
          playClip(p.anim, phone ? 'Phone' : 'Idle')
          continue
        }
        this._advanceLane(p, lane)
      }
    }
    this.stats.people = this.people.length
    this.stats.standing = standingNow
    this.stats.fleeing = fleeing
    this._render(camera)
  }

  _idleRate(p) {
    const layout = this.renderer.layout(p.gender)
    const c = layout?.clips[p.anim.clip]
    return c ? 1 / Math.max(0.3, c.duration) : 0.5
  }

  _advanceLane(p, lane) {
    const nxt = this._routeFrom(lane, p.dir, (Math.random() * 1e6) | 0)
    if (!nxt) {
      // a dead end: turn round rather than walk off the pavement
      p.dir = -p.dir
      p.s = Math.min(lane.len, Math.max(0, p.s))
      return
    }
    const nl = this.lanes[nxt.lane]
    p.lane = nxt.lane
    p.dir = nxt.dir
    p.s = nxt.dir === 1 ? 0 : nl.len
    // keep to the right in the new lane's frame
    p.latTarget = p.dir * Math.abs(p.latTarget)
    p.lat = p.dir * Math.abs(p.lat)
  }

  _pointAt(lane, s) {
    const cum = lane.cum
    let i = 1
    while (i < cum.length - 1 && cum[i] < s) i++
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
    const a = lane.pts[i - 1]
    const b = lane.pts[i]
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
      Math.atan2(b[1] - a[1], b[0] - a[0]), i]
  }

  // Free width in metres at segment `i`, on the given side of the lane's
  // forward direction. The tighter of the two bounding vertices, so a walker
  // is never wider than the narrowest point they are between.
  _widthAt(lane, i, right) {
    const arr = right ? lane.wr : lane.wl
    if (!arr || !arr.length) return 0.45
    const a = arr[Math.max(0, i - 1)] ?? 0
    const b = arr[Math.min(arr.length - 1, i)] ?? 0
    return Math.min(a, b) * 0.1
  }

  _render(camera) {
    const r = this.renderer
    r.begin(camera)
    const inst = this._inst
    const rows = this._rows
    let n = 0
    for (const p of this.people) {
      const layout = r.layout(p.gender)
      if (!layout) continue
      let wx
      let wy
      let yaw
      if (p.mode === 'stand') {
        wx = p.px
        wy = p.py
        // bodies face +Z at yaw 0; a heading h in the (x, y_m) plane is
        // world direction (cos h, -sin h), which is yaw h + pi/2
        yaw = p.yaw + Math.PI / 2
      } else {
        const lane = this.lanes[p.lane]
        const [x, y, head, seg] = this._pointAt(lane,
          Math.min(Math.max(p.s, 0), lane.len))
        // Offset in the lane's own frame: right of forward is (sin h, -cos h).
        // Scaling by the surveyed free width is what keeps the crowd off the
        // carriageway on a narrow block and spread out on a wide one.
        const off = p.lat * this._widthAt(lane, seg, p.lat >= 0)
        wx = x + Math.sin(head) * off
        wy = y - Math.cos(head) * off
        yaw = (p.dir === 1 ? head : head + Math.PI) + Math.PI / 2
      }
      if (n < MAX_PEDS + 32) {
        this._xz[n * 2] = wx
        this._xz[n * 2 + 1] = -wy
        n++
      }
      animRows(p.anim, layout.clips, rows)
      inst.x = wx
      inst.y = this.walkY
      inst.z = -wy
      inst.yaw = yaw
      inst.scale = p.look.scale
      inst.variant = p.look.variant
      inst.rowA = rows.a
      inst.rowB = rows.b
      inst.w = rows.w
      inst.prop = p.prop && p.anim.clip === 'Phone'
      inst.pal0 = p.pal0
      inst.pal1 = p.pal1
      r.add(inst)
    }
    this._xzCount = n
    r.end()
  }

  dispose() {
    this.renderer.dispose()
  }
}
