// pedestrians.js — a crowd walking the surveyed sidewalk network.
//
// The lanes come from 48_build_walk.py, which offset the LION centrelines and
// then kept only the stretches that land inside the planimetric sidewalk
// survey. So nobody walks up the middle of the FDR, and nobody walks on water.
//
// Two things here are worth knowing before reading the shader:
//
// Colour. One instance colour is not enough for a crowd — a hundred people
// whose shirt, trousers and face are all the same colour read as plastic. The
// bodies carry a channel selector in COLOR_0's alpha and the runtime supplies
// three per-instance colours:
//
//     a = 1.00  top      instanceColor
//     a = 0.66  bottom   aBottom
//     a = 0.33  skin     aSkin
//     a = 0.00  hair, shoes, bag — authored, untouched
//
// Gait. There is no skeleton and no animation clip. Each limb vertex carries
// its limb id and its pivot height in UV0 (see 54_props.py) and the vertex
// shader swings it about that pivot by a per-instance phase, which the CPU
// advances in proportion to how fast that person is actually walking. A
// pedestrian stopped at a kerb stops moving their legs, because the phase
// stops.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// The /tiles/ mount is cached for an hour, and these asset files carry no
// version in their URL the way the world tiles do. In dev that means a rebuilt
// glb silently does not arrive -- which is exactly how P2-021 burned an hour
// on a corrected export that "did nothing". Never cache them in dev.
const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

const SIM_RADIUS = 240       // people are small; there is no point simulating
const DESPAWN = 300          // a crowd you cannot resolve
const CELL = 200
const MAX_PEDS = 900

const WALK_MIN = 1.05        // m/s — the measured Manhattan average is ~1.4
const WALK_MAX = 1.75
const STEP_LEN = 0.72        // metres per half-stride, sets the gait frequency

const BODIES = [
  { name: 'PED_adult_a', key: 'adult_a', weight: 0.50 },
  { name: 'PED_adult_b', key: 'adult_b', weight: 0.43 },
  { name: 'PED_child', key: 'child', weight: 0.07 },
]

// Muted but not dark. A crowd built from a bright palette looks like a parade;
// a crowd built from the palette this started with -- everything between
// 0x1d and 0x5c -- came out as a row of silhouettes, because these hex values
// are sRGB and three converts them to linear, so 0x2a2c30 lands at 0.023.
// Roughly a quarter dark, a third mid, the rest light, which is what a midday
// pavement actually looks like.
const TOPS = [
  0x2b2e33, 0x1f2228, 0x39414b,                       // dark
  0x6e737a, 0x7f8890, 0x8b8175, 0x5d6f80, 0x7a6a5c,   // mid
  0x63707d, 0x8d7f72,
  0xb9bdc0, 0xc9cdd0, 0xd8d6cf, 0xa8b2b8, 0xc2b4a2,   // light
  0xe2e0da, 0xb0bcc4, 0xcbbfae,
  0x8a4a46, 0x3f5d78, 0x4c6b52,                       // the occasional colour
]
const BOTTOMS = [
  0x2c2f34, 0x232629, 0x3b3f46, 0x4d525a,             // black / charcoal
  0x3f5068, 0x4a5c74, 0x38455a,                       // denim
  0x6f6857, 0x87806c, 0x5a5346,                       // khaki
  0x74797f, 0x9a9ea2,                                 // grey
]
const SKINS = [
  0xf0cdb0, 0xe3b997, 0xd6a781, 0xc08e63, 0xa5714a, 0x835537, 0x5f3c26,
  0x452b1b,
]

const PATCH_VERT_HEAD = /* glsl */`
attribute vec2 aLimb;
attribute vec3 aBottom;
attribute vec3 aSkin;
attribute float aPhase;
uniform float uLegSwing;
uniform float uArmSwing;
uniform float uHip;
varying vec4 vPaint;
varying vec3 vBottom;
varying vec3 vSkin;
`

const PATCH_COLOR = /* glsl */`
vPaint = vec4(1.0);
#ifdef USE_COLOR_ALPHA
  vPaint = color;
#endif
vBottom = aBottom;
vSkin = aSkin;
`

// glTF's UV origin is the opposite corner from Blender's, so the exporter
// writes 1 - v. Decoding it as-is put every hip pivot at 3.08 m — above the
// top of the head — and the legs swung from the sky.
const PATCH_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
float swing = sin(aPhase);
if (aLimb.x > 0.1) {
  float pivot = (1.0 - aLimb.y) * 4.0;
  // contralateral: left leg swings with the right arm
  float sgn = (aLimb.x < 0.3 || aLimb.x > 0.7) ? 1.0 : -1.0;
  float amp = (aLimb.x < 0.5) ? uLegSwing : uArmSwing;
  float a = swing * amp * sgn;
  float dx = transformed.x;
  float dy = transformed.y - pivot;
  float c = cos(a);
  float s = sin(a);
  transformed.x = dx * c - dy * s;
  transformed.y = pivot + dx * s + dy * c;
}
// the pelvis drops as the legs splay, which is what stops a walk cycle
// looking like a figure gliding on rails
transformed.y -= uHip * (1.0 - cos(swing * uLegSwing));
`

const PATCH_FRAG_HEAD = /* glsl */`
varying vec4 vPaint;
varying vec3 vBottom;
varying vec3 vSkin;
`

// vColor is COLOR_0 already multiplied by instanceColor; the tinted parts are
// authored white so vColor is exactly the instance colour there.
const PATCH_FRAG_BODY = /* glsl */`
{
  vec3 col = vPaint.rgb;
  if (vPaint.a > 0.83)       col = vColor.rgb;
  else if (vPaint.a > 0.50)  col = vBottom;
  else if (vPaint.a > 0.16)  col = vSkin;
  diffuseColor.rgb = col;
  diffuseColor.a = 1.0;
}`

function bodyMaterial(hip, key) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true,
    color: 0xffffff })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLegSwing = { value: 0.62 }
    shader.uniforms.uArmSwing = { value: 0.42 }
    shader.uniforms.uHip = { value: hip * 0.5 }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PATCH_VERT_HEAD}`)
      .replace('#include <color_vertex>',
        `#include <color_vertex>\n${PATCH_COLOR}`)
      .replace('#include <begin_vertex>', PATCH_BEGIN)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PATCH_FRAG_HEAD}`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>\n${PATCH_FRAG_BODY}`)
  }
  m.customProgramCacheKey = () => `manhattan-ped-${key}`
  return m
}

function hash1(n) {
  const x = Math.sin(n * 91.7) * 43758.5453
  return x - Math.floor(x)
}

export class Crowd {
  constructor(scene, city, demand = null) {
    this.scene = scene
    this.demand = demand
    this.walkY = (city?.meta?.land_level_m ?? 12.0) + 0.20
    this.types = []
    this.lanes = []
    this.nodeLanes = new Map()
    this.grid = new Map()
    this.people = []
    this.enabled = true
    this.ready = false
    this.stats = { lanes: 0, people: 0, simLanes: 0 }
  }

  async load(graphUrl = '/streets/walk_graph.json',
             glbUrl = '/tiles/peds.glb') {
    const g = await fetch(graphUrl).then((r) => (r.ok ? r.json() : null))
    if (!g) { console.warn('[crowd] no walk graph'); return this }
    await this._loadBodies(glbUrl)
    this._buildLanes(g)
    this.stats.lanes = this.lanes.length
    this.ready = this.types.length > 0 && this.lanes.length > 0
    return this
  }

  async _loadBodies(url) {
    const gltf = await new GLTFLoader().loadAsync(url + bust())
    const src = new Map()
    gltf.scene.traverse((o) => { if (o.isMesh) src.set(o.name, o) })

    for (const spec of BODIES) {
      const mesh = src.get(spec.name)
      if (!mesh) { console.warn('[crowd] missing', spec.name); continue }
      const geo = mesh.geometry

      // Three only declares `uv` in the shader when a map is bound, so the
      // limb rig moves to a name we own and can declare ourselves.
      if (geo.attributes.uv && !geo.attributes.aLimb) {
        geo.setAttribute('aLimb', geo.attributes.uv)
        geo.deleteAttribute('uv')
      }
      const hip = this._hipFrom(geo)

      const cap = Math.max(24, Math.round(MAX_PEDS * spec.weight * 1.5))
      const im = new THREE.InstancedMesh(geo, bodyMaterial(hip, spec.key), cap)
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      im.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(cap * 3).fill(0.5), 3)
      const attr = (n) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n),
          n)
        a.setUsage(THREE.DynamicDrawUsage)
        return a
      }
      const bottom = attr(3)
      const skin = attr(3)
      const phase = attr(1)
      geo.setAttribute('aBottom', bottom)
      geo.setAttribute('aSkin', skin)
      geo.setAttribute('aPhase', phase)
      im.count = 0
      im.frustumCulled = false
      im.name = `CROWD_${spec.key}`
      this.scene.add(im)
      this.types.push({ ...spec, mesh: im, capacity: cap, hip,
        bottom, skin, phase })
    }
  }

  // The hip is the lowest limb pivot in the mesh. Reading it off the geometry
  // keeps the pelvis drop correct for the child without a second table to
  // keep in sync with the Blender script.
  _hipFrom(geo) {
    const a = geo.attributes.aLimb
    if (!a) return 0.9
    let lo = Infinity
    for (let i = 0; i < a.count; i++) {
      if (a.getX(i) < 0.1) continue
      lo = Math.min(lo, (1 - a.getY(i)) * 4)
    }
    return Number.isFinite(lo) ? lo : 0.9
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

  _pick(rand) {
    let r = rand
    for (const t of this.types) {
      r -= t.weight
      if (r <= 0) return t
    }
    return this.types[0]
  }

  _spawn(laneId, seed) {
    const lane = this.lanes[laneId]
    const type = this._pick(hash1(seed * 3.1))
    if (!type) return null
    const dir = hash1(seed * 7.7) < 0.5 ? 1 : -1
    // `lat` is a fraction of the free width on the walker's own side, not a
    // distance: the actual metres are looked up per vertex at render time.
    // Signed in the lane's forward frame, so keeping right means positive
    // going forward and negative coming back, and the two streams pass each
    // other instead of stacking into one file.
    return {
      lane: laneId,
      s: hash1(seed * 13.9) * lane.len,
      dir,
      lat: dir * (0.22 + hash1(seed * 5.3) * 0.78),
      v: WALK_MIN + hash1(seed * 2.9) * (WALK_MAX - WALK_MIN),
      phase: hash1(seed * 17.1) * Math.PI * 2,
      type,
      top: TOPS[(seed * 3) % TOPS.length | 0],
      bottom: BOTTOMS[(seed * 5) % BOTTOMS.length | 0],
      skin: SKINS[(seed * 11) % SKINS.length | 0],
      alive: true,
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

  update(dt, camera) {
    if (!this.enabled || !this.ready) return
    dt = Math.min(dt, 0.1)
    this.clock = (this.clock || 0) + dt

    const camX = camera.position.x
    const camY = -camera.position.z
    const inScope = this.lanesNear(camX, camY, SIM_RADIUS)
    this.stats.simLanes = inScope.length

    const keep = []
    for (const p of this.people) {
      const lane = this.lanes[p.lane]
      const at = this._pointAt(lane, Math.min(Math.max(p.s, 0), lane.len))
      if (Math.hypot(at[0] - camX, at[1] - camY) > DESPAWN) continue
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
        const p = this._spawn(lane.id, (Math.random() * 1e6) | 0)
        if (!p) continue
        const at = this._pointAt(lane, p.s)
        const d = Math.hypot(at[0] - camX, at[1] - camY)
        if (d > SIM_RADIUS || d < 4) continue
        this.people.push(p)
      }
    }

    for (const p of this.people) {
      const lane = this.lanes[p.lane]
      p.s += p.v * p.dir * dt
      // one full sin cycle is two steps
      p.phase += (p.v / STEP_LEN) * dt * Math.PI
      if (p.s > lane.len || p.s < 0) {
        const nxt = this._routeFrom(lane, p.dir, (Math.random() * 1e6) | 0)
        if (!nxt) {
          // a dead end: turn round rather than walk off the pavement
          p.dir = -p.dir
          p.s = Math.min(lane.len, Math.max(0, p.s))
          continue
        }
        const nl = this.lanes[nxt.lane]
        p.lane = nxt.lane
        p.dir = nxt.dir
        p.s = nxt.dir === 1 ? 0 : nl.len
      }
    }
    this.stats.people = this.people.length
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

  _render() {
    const dummy = new THREE.Object3D()
    const col = new THREE.Color()
    for (const t of this.types) t.mesh.count = 0

    for (const p of this.people) {
      const t = p.type
      const mesh = t.mesh
      if (mesh.count >= t.capacity) continue
      const lane = this.lanes[p.lane]
      const [x, y, head, seg] = this._pointAt(lane,
        Math.min(Math.max(p.s, 0), lane.len))
      // Offset in the lane's own frame: right of forward is (sin h, -cos h).
      // Scaling by the surveyed free width is what keeps the crowd off the
      // carriageway on a narrow block and spread out on a wide one.
      const off = p.lat * this._widthAt(lane, seg, p.lat >= 0)
      const ox = Math.sin(head) * off
      const oy = -Math.cos(head) * off
      const h = p.dir === 1 ? head : head + Math.PI
      dummy.position.set(x + ox, this.walkY, -(y + oy))
      dummy.rotation.set(0, h, 0)
      dummy.updateMatrix()

      const i = mesh.count++
      mesh.setMatrixAt(i, dummy.matrix)
      col.setHex(p.top)
      mesh.setColorAt(i, col)
      col.setHex(p.bottom)
      t.bottom.setXYZ(i, col.r, col.g, col.b)
      col.setHex(p.skin)
      t.skin.setXYZ(i, col.r, col.g, col.b)
      t.phase.setX(i, p.phase)
    }

    for (const t of this.types) {
      t.mesh.instanceMatrix.needsUpdate = true
      if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true
      t.bottom.needsUpdate = true
      t.skin.needsUpdate = true
      t.phase.needsUpdate = true
    }
  }
}
