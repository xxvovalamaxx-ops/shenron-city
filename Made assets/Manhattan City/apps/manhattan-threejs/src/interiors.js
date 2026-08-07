// interiors.js — rooms placed inside real buildings.
//
// The three rooms 60_interiors.py authors are not a separate scene. Each one
// is anchored to an actual building from the registry, at that building's real
// position and a real floor height, and rotated so its glazed wall faces the
// street it fronts. Stand in the penthouse and the view out of the window is
// the city, streaming, with its own traffic in it.
//
// Anchors are chosen from the data rather than hard-coded:
//   lobby      a tall office tower, at street level
//   penthouse  a tall residential tower, one floor below its roof
//   bodega     a low mixed-use or retail building on an avenue
//
// Entry is an explicit action rather than walking through the facade. The
// building shells are solid collision geometry with no door openings cut into
// them, so a walk-in would mean either cutting 56,476 doorways or turning off
// collision at the wall — a marked threshold and a keypress is honest about
// what the geometry actually supports.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

// Every offset below is in the authored room frame: +x into the room, +y to
// the left, +z up. One convention, and place() applies the Blender -> glTF
// axis swap exactly once, so nothing downstream has to think about it.
const ANCHORS = [
  {
    key: 'lobby', mesh: 'INT_lobby', glass: 'GLAZE_lobby',
    label: 'Tower lobby',
    // a big office tower reasonably central, so the doorway is on a real
    // avenue rather than at the end of a pier
    pick: (b) => (b.height > 160 && b.height < 340 &&
      Math.abs(b.y - (-800)) < 2600 && Math.abs(b.x + 1600) < 2200),
    floor: () => 0.0,
    eye: [6.0, 0.0, 1.7],
    shot: { eye: [11.5, -6.0, 1.70], at: [1.5, 5.0, 1.70] },
  },
  {
    key: 'penthouse', mesh: 'INT_penthouse', glass: 'GLAZE_penthouse',
    label: 'Penthouse',
    pick: (b) => b.height > 190,
    // one floor below the roof, so the parapet is above the glass line
    floor: (b) => b.height - 7.5,
    eye: [5.0, 2.0, 1.7],
    shot: { eye: [9.5, -3.2, 1.65], at: [1.0, 4.6, 1.45] },
  },
  {
    key: 'bodega', mesh: 'INT_bodega', glass: 'GLAZE_bodega',
    label: 'Corner market',
    // A market belongs in a mixed-use or retail building, not in whatever low
    // block happens to be nearest -- the first pass put it in New 42nd Street
    // Studios, which is a theatre.
    pick: (b) => (b.height > 8 && b.height < 26 &&
      (b.archetype === 'mixed_use_avenue' ||
       b.archetype === 'retail_podium' ||
       b.archetype === 'cast_iron_loft') &&
      Math.abs(b.y - (-2200)) < 2200 && Math.abs(b.x + 2200) < 1800),
    floor: () => 0.0,
    eye: [5.0, 0.0, 1.7],
    shot: { eye: [9.2, 0.4, 1.65], at: [0.6, -1.8, 1.45] },
  },
]

const ENTER_RADIUS = 14
const LINK_RADIUS = 4.5

// Bright authored surfaces are the luminous ceiling panels. A room needs a
// dozen light sources to look lit and a dozen dynamic lights in a browser is
// not a budget anyone has, so brightness in the vertex colour becomes
// emission instead.
const PATCH_FRAG = /* glsl */`
{
  float lum = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  totalEmissiveRadiance += vColor.rgb * smoothstep(0.55, 0.92, lum) * 1.35;
}`

function roomMaterial() {
  const m = new THREE.MeshLambertMaterial({
    vertexColors: true, color: 0xffffff,
  })
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n${PATCH_FRAG}`)
  }
  m.customProgramCacheKey = () => 'manhattan-interior-v1'
  return m
}

export class Interiors {
  constructor(scene, city) {
    this.scene = scene
    this.city = city
    this.groundY = city?.meta?.land_level_m ?? 12.0
    this.rooms = []
    this.inside = null
    this.near = null
    this.link = null
    this.ready = false
    this.material = roomMaterial()
    this.glassMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true, color: 0xffffff, transparent: true,
      opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
    })
    // One light that only exists while the player is indoors. Interiors are
    // otherwise lit by a sun that is outside the building.
    // Sky colour lights up-facing surfaces and ground colour down-facing
    // ones, so a dark ground colour left every ceiling in the build black.
    this.lamp = new THREE.HemisphereLight(0xfff0dc, 0xb9a894, 0.0)
    this.scene.add(this.lamp)
    this.stats = { rooms: 0, inside: null, near: null, link: null }
  }

  async load(url = '/tiles/interiors.glb', graphUrl = '/streets/street_graph.json') {
    const [gltf, graph] = await Promise.all([
      new GLTFLoader().loadAsync(url + bust()).catch(() => null),
      fetch(graphUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    if (!gltf) { console.warn('[interiors] no interiors.glb'); return this }
    const src = new Map()
    gltf.scene.traverse((o) => { if (o.isMesh) src.set(o.name, o) })
    // kept so other placers can reuse an authored room -- the HQ stands a
    // second instance of INT_lobby in its podium
    this.src = src

    for (const spec of ANCHORS) {
      if (!src.has(spec.mesh)) continue
      const b = this._pickBuilding(spec)
      if (!b) { console.warn('[interiors] no building for', spec.key); continue }
      const floor = spec.floor(b)
      // Room-local +x points into the building; yaw is measured so that
      // direction is away from the street the building fronts.
      this.place(spec, src,
        new THREE.Vector3(b.x, this.groundY + floor, -b.y),
        this._streetFacing(graph, b.x, b.y),
        { building: b, atStreet: floor < 1.0 })
    }
    this.ready = this.rooms.length > 0
    this.stats.rooms = this.rooms.length
    return this
  }

  // Drop one authored room into the world at a world position and a yaw, and
  // register it. Everything that owns a room goes through here -- the anchored
  // ones above and the HQ's two, which are positioned off the tower rather
  // than off the registry.
  place(spec, src, position, yaw, extra = {}) {
    const body = src.get(spec.mesh)
    if (!body) return null

    const group = new THREE.Group()
    group.name = `INTERIOR_${spec.key}`
    // The geometry is cloned per instance: two rooms may reuse the same
    // authored mesh (the tower lobby and the HQ lobby both use INT_lobby),
    // and Phase 3B punches a doorway through each room's glazed wall -- a
    // shared BufferGeometry would carry one room's cut into the other.
    const mesh = new THREE.Mesh(body.geometry.clone(), this.material)
    mesh.name = spec.mesh
    group.add(mesh)
    const g = src.get(spec.glass)
    if (g) {
      const gm = new THREE.Mesh(g.geometry.clone(), this.glassMaterial)
      gm.name = spec.glass
      gm.userData.glaze = true
      group.add(gm)
    }
    group.position.copy(position)
    group.rotation.set(0, yaw, 0)
    group.visible = false
    this.scene.add(group)
    group.updateMatrixWorld(true)

    // Rooms are authored Blender-side as (+x into the room, +y left, +z up),
    // and the exporter maps that to mesh space as (x, z, -y). Going through
    // the group's own matrix keeps that conversion in one place -- deriving
    // the offsets from the yaw by hand put the first penthouse camera outside
    // the building looking away from it.
    const local = (bx, by, bz) =>
      group.localToWorld(new THREE.Vector3(bx, bz, -by))

    const eye = spec.eye
    const eyeWorld = local(eye[0], eye[1], eye[2])
    // look back at the glazed wall, which is the whole point of the room
    const lookAt = local(-2.0, eye[1] * 0.5, eye[2] * 0.92)
    // the doorway sits on the room origin, pushed just outside the glass
    const door = spec.door ? local(...spec.door) : local(-3.0, 0, 1.7)
    if (extra.atStreet !== false) door.y = this.groundY + 1.7

    const shot = spec.shot ? {
      eye: local(...spec.shot.eye),
      at: local(...spec.shot.at),
    } : { eye: eyeWorld, at: lookAt }

    // A link is a threshold inside one room that leads to another -- the lift
    // bank in the HQ lobby is one. Resolved by key after every room is placed,
    // because the target may not exist yet. The spec offsets are kept so a
    // rebase (doors.js rotates a room to a clear frontage) can recompute them.
    const links = (spec.links || []).map((l) => ({
      to: l.to, label: l.label, at: local(...l.at), room: null,
    }))
    const linkSpecs = (spec.links || []).map((l) => l.at)

    const rec = {
      ...spec, group, yaw, eyeWorld, lookAt, door, shot, local, links,
      linkSpecs,
      atStreet: extra.atStreet !== false, building: extra.building || null,
    }
    this.rooms.push(rec)
    this.stats.rooms = this.rooms.length
    this.ready = true
    return rec
  }

  // Recompute a room's world-derived placement fields from its current group
  // matrix. doors.js rotates a room to face a clear frontage when the
  // street-facing wall it was anchored on turns out to be concealed by an
  // adjacent footprint; every camera position that was computed from the old
  // matrix has to follow the room.
  rebase(room) {
    if (!room) return false
    const local = room.local
    room.eyeWorld = local(room.eye[0], room.eye[1], room.eye[2])
    room.lookAt = local(-2.0, room.eye[1] * 0.5, room.eye[2] * 0.92)
    if (room.spec && room.spec.door) {
      room.door = local(...room.spec.door)
    } else {
      room.door = local(-3.0, 0, 1.7)
    }
    if (room.atStreet !== false) room.door.y = this.groundY + 1.7
    room.shot = room.spec && room.spec.shot
      ? { eye: local(...room.spec.shot.eye), at: local(...room.spec.shot.at) }
      : { eye: room.eyeWorld, at: room.lookAt }
    for (let i = 0; i < (room.links || []).length; i++) {
      if (room.linkSpecs && room.linkSpecs[i]) {
        room.links[i].at = local(...room.linkSpecs[i])
      }
    }
    return true
  }

  // Resolve link targets once everything is placed.
  linkRooms() {
    const byKey = new Map(this.rooms.map((r) => [r.key, r]))
    let n = 0
    for (const r of this.rooms) {
      for (const l of r.links || []) {
        l.room = byKey.get(l.to) || null
        if (l.room) n++
        else console.warn('[interiors] dangling link', r.key, '->', l.to)
      }
    }
    return n
  }

  _pickBuilding(spec) {
    // Tallest candidate that passes the spec's own test, so the penthouse is
    // a penthouse and not a fifth floor. Raw accessors rather than get(),
    // which allocates a record per building and would cost three passes over
    // 56,476 of them at boot.
    const c = this.city
    let best = -1
    let bestH = -1
    const probe = { x: 0, y: 0, height: 0, archetype: '' }
    for (let i = 0; i < c.count; i++) {
      if (c.isContext(i)) continue
      const h = c.height(i)
      if (h <= bestH) continue
      probe.x = c.x(i)
      probe.y = c.y(i)
      probe.height = h
      probe.archetype = c.archetype(i)
      if (!spec.pick(probe)) continue
      best = i
      bestH = h
    }
    return best >= 0 ? c.get(best) : null
  }

  // Yaw such that room-local +x points away from the nearest street.
  _streetFacing(graph, x, y) {
    if (!graph) return 0
    let best = null
    let bd = 200 * 200
    for (const e of graph.edges) {
      if (!e.drivable) continue
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i]
        const c = e.pts[i + 1]
        const mx = (a[0] + c[0]) * 0.5
        const my = (a[1] + c[1]) * 0.5
        const d = (mx - x) ** 2 + (my - y) ** 2
        if (d < bd) { bd = d; best = [mx, my] }
      }
    }
    if (!best) return 0
    // direction from the street toward the building, in world terms
    const dx = x - best[0]
    const dz = -(y - best[1])
    return Math.atan2(-dz, dx)
  }

  enter(room) {
    if (!room) return false
    if (this.inside && this.inside !== room) this.inside.group.visible = false
    this.inside = room
    room.group.visible = true
    // Not every room is lit the same. A lobby is bright by design; an
    // operations floor is deliberately dim so its screens read, and lighting
    // it like an office is what made Floor 45 look like a call centre.
    this.lamp.intensity = room.lamp ?? 1.9
    this.stats.inside = room.key
    this.link = null
    this.stats.link = null
    return true
  }

  // Phase 3B: the same state flip, but walked through a real doorway -- the
  // caller (doors.js) has already moved the camera through the opening, so
  // nothing is repositioned here. enter()/exit() stay for the scripted
  // corridor legs, which own their camera explicitly.
  enterPhysical(room) {
    this.stats.physical = true
    return this.enter(room)
  }

  exit() {
    if (!this.inside) return false
    const room = this.inside
    room.group.visible = false
    this.inside = null
    this.link = null
    this.lamp.intensity = 0.0
    this.stats.inside = null
    this.stats.link = null
    return room
  }

  exitPhysical() {
    this.stats.physical = true
    return this.exit()
  }

  // Where the player can go from where they are standing: the nearest street
  // doorway when outside, the nearest threshold to another room when inside.
  update(camera) {
    if (!this.ready) return this.stats
    const px = camera.position.x
    const pz = camera.position.z
    const py = camera.position.y

    if (this.inside) {
      this.near = null
      this.stats.near = null
      let link = null
      let bd = LINK_RADIUS * LINK_RADIUS
      for (const l of this.inside.links || []) {
        if (!l.room) continue
        const d = (l.at.x - px) ** 2 + (l.at.z - pz) ** 2
        if (d < bd) { bd = d; link = l }
      }
      this.link = link
      this.stats.link = link ? link.to : null
      return this.stats
    }

    let near = null
    let bd = ENTER_RADIUS * ENTER_RADIUS
    for (const r of this.rooms) {
      if (!r.atStreet) continue
      // A doorway 180 m up is not reachable from the pavement below it, and
      // without a height test the HQ lobby's door and Floor 45's would both
      // answer to the same patch of kerb.
      if (Math.abs(r.door.y - py) > 6.0) continue
      const d = (r.door.x - px) ** 2 + (r.door.z - pz) ** 2
      if (d < bd) { bd = d; near = r }
    }
    this.near = near
    this.stats.near = near ? near.key : null
    return this.stats
  }

  // What pressing the action key should do from here, if anything. Rooms
  // with a physical doorway (Phase 3B) never answer enter/exit here: walking
  // through the real opening replaces the keypress, and answering would make
  // the key a teleport standing next to a real door.
  action() {
    if (this.link) return { kind: 'link', room: this.link.room, link: this.link }
    if (this.inside) {
      if (this.inside.doorway) return null
      return { kind: 'exit', room: this.inside }
    }
    if (this.near) {
      if (this.near.doorway) return null
      return { kind: 'enter', room: this.near }
    }
    return null
  }

  prompt() {
    if (this.link) return `press E — ${this.link.label}`
    if (this.inside) {
      if (this.inside.doorway) return `inside ${this.inside.label}`
      return `inside ${this.inside.label} — press E to leave`
    }
    if (this.near) {
      if (this.near.doorway) return `press E — ${this.near.label}`
      return `press E — ${this.near.label}`
    }
    return '–'
  }

  // Meshes the camera should collide with indoors: the shell, never the glass.
  colliders() {
    if (!this.inside) return []
    return this.inside.group.children.filter((o) => !o.userData.glaze)
  }
}
