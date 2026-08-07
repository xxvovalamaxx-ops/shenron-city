// hq.js — the HQ tower, and the two rooms inside it.
//
// 62_hq.py authors the building and 63_hq_site.py chooses the lot. This puts
// them together: the tower at the origin and yaw the site file gives, the two
// rooms positioned off the tower's own matrix rather than off numbers typed
// in twice.
//
//   plaza  --E-->  HQ lobby  --E at the lift bank-->  Floor 45
//
// The registry building the footprint stands on is hidden, not left inside
// the tower. Which buildings those are is decided at build time, from the
// footprint at this exact yaw, so the runtime never has to guess: it hides
// the ids the site file lists and nothing else.
//
// A note on what this is. The tower is an original design. It is not a model
// of any real headquarters, it carries no company's mark, and the lot it
// stands on was picked because the registry knows nothing about it — no name,
// no address, and a height modelled from zoning rather than measured. That is
// one deliberate substitution in a frozen world of 56,476 buildings, and it
// is recorded rather than quietly made.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

// Room offsets are in the authored frame: +x into the room, +y left, +z up.
const LOBBY = {
  key: 'hq_lobby', mesh: 'INT_lobby', glass: 'GLAZE_lobby',
  label: 'HQ lobby',
  eye: [6.0, 0.0, 1.7],
  shot: { eye: [11.5, -6.0, 1.70], at: [1.5, 5.0, 1.70] },
  // The lift bank INT_lobby was authored with sits on the far right wall,
  // around x = 0.8 * depth, y = +0.3 * width. Stand there and Floor 45 is
  // one keypress away.
  links: [{ to: 'hq_floor45', label: 'Lift — Floor 45', at: [11.4, 5.6, 1.7] }],
}

const FLOOR45 = {
  key: 'hq_floor45', mesh: 'INT_floor45', glass: 'GLAZE_floor45',
  label: 'Floor 45 — Mission Control',
  eye: [8.0, 0.0, 1.7],
  // Back against the glass, looking the length of the room: the dais in the
  // foreground, the consoles behind it, the video wall at the far end.
  shot: { eye: [1.1, -7.6, 2.55], at: [17.5, 2.0, 2.70] },
  links: [{ to: 'hq_lobby', label: 'Lift — lobby', at: [2.2, -13.0, 1.7] }],
  // an operations floor is dim on purpose
  lamp: 0.85,
}

export class HQ {
  constructor(scene, city, interiors, facade) {
    this.scene = scene
    this.city = city
    this.interiors = interiors
    this.facade = facade
    this.groundY = city?.meta?.land_level_m ?? 12.0
    this.tower = null
    this.site = null
    this.rooms = {}
    this.stats = { placed: false, suppressed: 0, floor45_m: 0, site: null }
  }

  async load(url = '/tiles/hq.glb', siteUrl = '/hq/hq_site.json',
    specUrl = '/hq/hq_spec.json') {
    const [gltf, site, spec] = await Promise.all([
      new GLTFLoader().loadAsync(url + bust()).catch(() => null),
      fetch(siteUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(specUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
    if (!gltf || !site || !spec) {
      console.warn('[hq] missing', !gltf && 'hq.glb', !site && 'hq_site.json',
        !spec && 'hq_spec.json')
      return this
    }
    this.site = site
    this.spec = spec

    // The tower and Floor 45 come out of hq.glb; the lobby is the one
    // interiors.glb already authored, stood up a second time in the podium.
    // Reusing it is the point of authoring it as a room rather than as part
    // of a building.
    const src = new Map(this.interiors.src || [])
    gltf.scene.traverse((o) => { if (o.isMesh) src.set(o.name, o) })

    // ---- the tower -------------------------------------------------------
    const body = src.get('HQ_tower')
    if (!body) { console.warn('[hq] no HQ_tower in glb'); return this }
    const group = new THREE.Group()
    group.name = 'HQ'
    const mesh = new THREE.Mesh(body.geometry, this.interiors.material)
    mesh.name = 'HQ_tower'
    group.add(mesh)
    const glaze = src.get('GLAZE_hq')
    if (glaze) {
      const gm = new THREE.Mesh(glaze.geometry, this.interiors.glassMaterial)
      gm.name = 'GLAZE_hq'
      gm.userData.glaze = true
      group.add(gm)
    }
    // The site file is in build coordinates (x east, y north); the world puts
    // north at -z.
    group.position.set(site.origin[0], this.groundY, -site.origin[1])
    group.rotation.set(0, site.yaw, 0)
    this.scene.add(group)
    group.updateMatrixWorld(true)
    this.tower = group

    // Blender (x, y, z) -> mesh (x, z, -y), applied once, here.
    const local = (bx, by, bz) =>
      group.localToWorld(new THREE.Vector3(bx, bz, -by))
    this.local = local

    // ---- the rooms, positioned off the tower -----------------------------
    const a = spec.anchor.floor45
    const f45 = this.interiors.place(FLOOR45, src, local(a.x, a.y, a.z),
      site.yaw, { atStreet: false })

    // The lobby sits behind the podium's glazed entrance recess, at the
    // ground floor. Its own origin is its street wall, which is where the
    // podium glass is.
    const d = spec.anchor.lobby_door
    const lobby = this.interiors.place(LOBBY, src,
      local(d.x + 0.6, d.y, d.z), site.yaw, { atStreet: true })
    if (lobby) {
      // the doorway the player walks up to is out on the plaza, not inside
      lobby.door.copy(local(d.x - 5.0, d.y, 1.7))
      lobby.door.y = this.groundY + 1.7
    }
    this.rooms = { lobby, floor45: f45 }
    this.interiors.linkRooms()

    // ---- hide what the footprint stands on -------------------------------
    const n = this.facade
      ? this.facade.suppress(site.suppress || [])
      : 0

    this.stats = {
      placed: true,
      suppressed: n,
      floor45_m: this.groundY + a.z,
      roof_m: this.groundY + spec.tower.roof_m,
      site: site.site.name || site.site.addr || `bid ${site.site.bid}`,
      bid: site.site.bid,
      rooms: [lobby && lobby.key, f45 && f45.key].filter(Boolean),
    }
    console.info('[hq] placed on bid', site.site.bid,
      `— floor 45 at ${this.stats.floor45_m.toFixed(1)} m,`,
      n, 'registry building(s) hidden')
    return this
  }

  // Where the hero corridor ends: the dais on Floor 45, in world space.
  daisWorld() {
    const f = this.rooms.floor45
    if (!f || !this.spec) return null
    const d = this.spec.anchor.dais
    return f.local(d.x, d.y, d.z)
  }

  // ---- verification ------------------------------------------------------
  // Three things worth proving rather than eyeballing.
  //
  // 1. Floor 45 is actually inside the shaft. Transform the room's eight
  //    bounding-box corners into the tower's own local frame and compare
  //    against the shaft the authoring script reported. A screenshot from
  //    inside a room that is floating next to the building looks identical
  //    to one from inside a room that is in it.
  // 2. It is at the height the floor schedule says, not near it.
  // 3. The registry building under the footprint is gone *on the GPU*. That
  //    one cannot be raycast: suppression collapses vertices in the vertex
  //    shader, so the CPU geometry is untouched and a raycast still hits it.
  //    Render the site twice, once suppressed and once not, and count the
  //    pixels that changed. Identical frames mean it never worked.
  verify(renderer, scene, camera) {
    const out = { ok: true, checks: [] }
    const say = (name, ok, detail) => {
      out.checks.push({ name, ok, ...detail })
      if (!ok) out.ok = false
    }
    if (!this.tower || !this.rooms.floor45) {
      say('placed', false, { reason: 'no tower or no floor 45' })
      return out
    }

    // ---- 1. containment --------------------------------------------------
    const room = this.rooms.floor45
    room.group.updateMatrixWorld(true)
    const geo = room.group.children[0].geometry
    geo.computeBoundingBox()
    const bb = geo.boundingBox
    const inv = new THREE.Matrix4().copy(this.tower.matrixWorld).invert()
    const p = new THREE.Vector3()
    let minX = Infinity; let maxX = -Infinity
    let minY = Infinity; let maxY = -Infinity
    let minZ = Infinity; let maxZ = -Infinity
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z)
      room.group.localToWorld(p)
      p.applyMatrix4(inv)
      // tower mesh space is (x, z, -y) of the authored frame; undo it
      const ax = p.x; const ay = -p.z; const az = p.y
      minX = Math.min(minX, ax); maxX = Math.max(maxX, ax)
      minY = Math.min(minY, ay); maxY = Math.max(maxY, ay)
      minZ = Math.min(minZ, az); maxZ = Math.max(maxZ, az)
    }
    const t = this.spec.tower
    const c = this.spec.clearance
    const sx0 = t.lot_depth_m - 46.0 + 15.0   // SHAFT2.x0, from lot geometry
    const sx1 = sx0 + c.shaft_depth_m
    const sw = c.shaft_width_m * 0.5
    const inside = minX >= sx0 - 0.01 && maxX <= sx1 + 0.01 &&
      minY >= -sw - 0.01 && maxY <= sw + 0.01
    say('room inside shaft', inside, {
      room_x: [+minX.toFixed(2), +maxX.toFixed(2)],
      shaft_x: [+sx0.toFixed(2), +sx1.toFixed(2)],
      room_y: [+minY.toFixed(2), +maxY.toFixed(2)],
      shaft_y: [+(-sw).toFixed(2), +sw.toFixed(2)],
      margin_m: +Math.min(minX - sx0, sx1 - maxX, minY + sw, sw - maxY)
        .toFixed(2),
    })

    // ---- 2. the floor schedule ------------------------------------------
    const want = t.ground_floor_m + (this.spec.anchor.floor45.floor - 2) *
      t.typical_floor_m
    const got = minZ
    say('floor 45 height', Math.abs(got - want) < 0.02, {
      expected_m: +want.toFixed(2), measured_m: +got.toFixed(2),
      world_m: +(this.groundY + got).toFixed(2),
      schedule: `${t.ground_floor_m} + ${this.spec.anchor.floor45.floor - 2}` +
        ` x ${t.typical_floor_m}`,
    })

    // ---- 3. suppression, on the GPU --------------------------------------
    if (renderer && scene && camera && this.facade) {
      const keep = {
        pos: camera.position.clone(), quat: camera.quaternion.clone(),
        near: camera.near, far: camera.far, tower: this.tower.visible,
      }
      // look at the lot from across the block, with the tower out of the way
      const eye = this.local(-210.0, -60.0, 120.0)
      camera.position.copy(eye)
      camera.near = 1
      camera.far = 4000
      camera.updateProjectionMatrix()
      camera.lookAt(this.local(23.0, 0.0, 50.0))
      this.tower.visible = false

      const gl = renderer.getContext()
      const w = renderer.domElement.width
      const h = renderer.domElement.height
      const read = () => {
        renderer.render(scene, camera)
        const buf = new Uint8Array(w * h * 4)
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
        return buf
      }
      const withHidden = read()
      this.facade.unsuppress()
      const withShown = read()
      this.facade.suppress(this.site.suppress || [])

      let diff = 0
      for (let i = 0; i < withHidden.length; i += 4) {
        if (Math.abs(withHidden[i] - withShown[i]) > 6 ||
            Math.abs(withHidden[i + 1] - withShown[i + 1]) > 6 ||
            Math.abs(withHidden[i + 2] - withShown[i + 2]) > 6) diff++
      }
      camera.position.copy(keep.pos)
      camera.quaternion.copy(keep.quat)
      camera.near = keep.near
      camera.far = keep.far
      camera.updateProjectionMatrix()
      this.tower.visible = keep.tower

      say('suppression changes the frame', diff > 2000, {
        pixels_changed: diff,
        of: w * h,
        percent: +((diff * 100) / (w * h)).toFixed(2),
        suppressed_bids: (this.site.suppress || []).length,
      })
    }
    return out
  }

  // A camera position outside, far enough back that the whole tower fits.
  exteriorShot() {
    if (!this.tower || !this.spec) return null
    const t = this.spec.tower
    return {
      eye: this.local(-135.0, -80.0, 46.0),
      at: this.local(t.lot_depth_m * 0.5, 0.0, t.roof_m * 0.42),
    }
  }
}
