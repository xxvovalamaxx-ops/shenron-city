// controls.js — pointer-lock first person with two modes.
//
//   fly    free 6-dof movement, no gravity, fast. For looking at the city.
//   walk   gravity, eye height, capsule-ish collision by raycast against the
//          loaded tile meshes. For being in the city.
//
// Walk collision is deliberately raycast-based rather than driven by a
// separate collision dataset: the tiles are already resident, so it needs no
// extra payload. It is accurate against building walls and the ground, and it
// costs 5 rays per frame.

import * as THREE from 'three'

const EYE = 1.7 // m, standing eye height
const WALK = 4.2 // m/s
const RUN = 11.0
const FLY = 90.0
const FLY_BOOST = 420.0
const GRAVITY = 22.0
const JUMP = 6.4
const RADIUS = 0.45 // m, body radius for wall probes
// How high a ledge can be walked onto, and — since Phase 3B — the hard cap on
// how far the ground snap may lift the camera in one frame. 0.65 rather than
// 0.55 because the HQ podium plinth the lobby doorway sits on measures 0.60 m
// above the pavement (12.60 vs 12.00) and a doorway you cannot step up to is
// not a doorway. Anything taller is a ledge to be blocked by, not climbed.
const STEP = 0.65

// The most the wall resolve may displace the camera in one frame.
const MAX_PUSH = 0.35

// Allocated once: _resolveWalls runs four of these every frame.
const PROBES = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
]
const _tmpBefore = new THREE.Vector3()
const _tmpPush = new THREE.Vector3()

export class Controls {
  constructor(camera, dom) {
    this.camera = camera
    this.dom = dom
    this.mode = 'fly'
    this.locked = false

    this.velocity = new THREE.Vector3()
    this.onGround = false
    this.yaw = 0
    this.pitch = 0

    this.keys = new Set()
    this.ray = new THREE.Raycaster()
    this.ray.far = 400
    this.colliders = []
    this._nrm = new THREE.Matrix3()

    this._bind()
  }

  setColliders(objs) { this.colliders = objs }

  // A predicate that drops hits the camera should pass through. Used for
  // buildings hidden in the shader because authored geometry stands on their
  // lot: their triangles are still in the tile mesh, so without this the
  // player walks into a building that is not there.
  setHitFilter(fn) { this.hitFilter = fn }

  _firstHit() {
    const hits = this.ray.intersectObjects(this.colliders, true)
    if (!this.hitFilter) return hits[0]
    for (const h of hits) if (!this.hitFilter(h)) return h
    return undefined
  }

  _bind() {
    this.dom.addEventListener('click', () => {
      if (!this.locked) this.dom.requestPointerLock()
    })
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom
    })
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return
      this.yaw -= e.movementX * 0.0022
      this.pitch -= e.movementY * 0.0022
      const lim = Math.PI / 2 - 0.02
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch))
    })
    addEventListener('keydown', (e) => {
      this.keys.add(e.code)
      if (e.code === 'KeyF') this.toggleMode()
      if (e.code === 'Space') e.preventDefault()
    })
    addEventListener('keyup', (e) => this.keys.delete(e.code))
    addEventListener('blur', () => this.keys.clear())
  }

  toggleMode() {
    this.mode = this.mode === 'fly' ? 'walk' : 'fly'
    this.velocity.set(0, 0, 0)
    if (this.mode === 'walk') {
      // drop onto whatever is under the camera rather than teleporting to 0
      const g = this._groundBelow(this.camera.position)
      this.camera.position.y = (g === null ? 0 : g) + EYE + 2
    }
  }

  // The surface the camera stands on. The ray starts a metre above the eye so
  // a ledge in front of you can be stepped onto, which means it can also
  // return something *above* your head — and the caller snaps the camera to
  // whatever comes back. Anything higher than one step above the feet is a
  // ceiling, not a floor, so it is skipped and the search continues downward.
  //
  // Phase 3B is what exposed this: a door header and its lit ceiling panel sit
  // ~2.6 m up in the walk collider set, and walking out through the doorway
  // launched the camera onto the header — a measured 2.595 m vertical jump,
  // which is a teleport by any honest reading.
  _groundBelow(pos) {
    if (!this.colliders.length) return null
    this.ray.set(
      new THREE.Vector3(pos.x, pos.y + 1.0, pos.z),
      new THREE.Vector3(0, -1, 0),
    )
    this.ray.far = 600
    const ceiling = pos.y - EYE + STEP
    for (const h of this.ray.intersectObjects(this.colliders, true)) {
      if (this.hitFilter && this.hitFilter(h)) continue
      if (h.point.y > ceiling) continue
      return h.point.y
    }
    return null
  }

  // Push out of walls: probe along the four horizontal axes and push back out
  // of anything closer than RADIUS.
  //
  // The push goes along the *wall's* normal, not along the probe axis. That
  // distinction is not cosmetic: Manhattan's street grid is rotated about 29
  // degrees off the world axes, so almost no wall in the city is
  // axis-aligned, and pushing back along the probe direction moves the player
  // sideways along the wall as well as away from it. Where the wall leans the
  // wrong way that sideways component points *into* the building -- measured
  // at +0.48 m of forward motion per metre of push against the HQ podium,
  // which is how the player walked in through a solid facade.
  _resolveWalls(next) {
    if (!this.colliders.length) return next
    const before = _tmpBefore.copy(next)
    const origin = new THREE.Vector3(next.x, next.y - EYE + 1.0, next.z)
    this.ray.far = RADIUS + 0.35
    for (const d of PROBES) {
      this.ray.set(origin, d)
      const hit = this._firstHit()
      if (!hit || hit.distance >= RADIUS) continue
      const n = this._worldNormal(hit) || d.clone().negate()
      // the face may be wound away from the probe; we always want to move
      // back toward where the ray came from
      if (n.dot(d) > 0) n.negate()
      next.addScaledVector(n, RADIUS - hit.distance)
    }
    // Four probes each push up to RADIUS, and in a corner they compound: a
    // player squeezing through a doorway was displaced 0.98 m in a single
    // frame, which is a teleport however correct the collision response is.
    // Clamp it — a deeper overlap simply resolves over the next few frames.
    const push = _tmpPush.subVectors(next, before)
    const len = push.length()
    if (len > MAX_PUSH) {
      next.copy(before).addScaledVector(push, MAX_PUSH / len)
    }
    return next
  }

  // Horizontal component of the hit face's world-space normal.
  _worldNormal(hit) {
    if (!hit.face) return null
    const n = hit.face.normal.clone()
      .applyNormalMatrix(this._nrm.getNormalMatrix(hit.object.matrixWorld))
    n.y = 0
    if (n.lengthSq() < 1e-8) return null
    return n.normalize()
  }

  update(dt) {
    const c = this.camera
    const e = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')
    c.quaternion.setFromEuler(e)

    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(
      new THREE.Euler(0, this.yaw, 0, 'YXZ'),
    )
    const right = new THREE.Vector3(1, 0, 0).applyEuler(
      new THREE.Euler(0, this.yaw, 0, 'YXZ'),
    )

    const k = this.keys
    const wish = new THREE.Vector3()
    if (k.has('KeyW')) wish.add(fwd)
    if (k.has('KeyS')) wish.sub(fwd)
    if (k.has('KeyD')) wish.add(right)
    if (k.has('KeyA')) wish.sub(right)
    const boost = k.has('ShiftLeft') || k.has('ShiftRight')

    if (this.mode === 'fly') {
      if (k.has('Space')) wish.y += 1
      if (k.has('KeyC') || k.has('ControlLeft')) wish.y -= 1
      if (wish.lengthSq() > 0) wish.normalize()
      const speed = boost ? FLY_BOOST : FLY
      // pitch-follow so W flies where you look
      if (k.has('KeyW') || k.has('KeyS')) {
        const look = new THREE.Vector3(0, 0, -1).applyEuler(e)
        wish.y += look.y * (k.has('KeyS') ? -1 : 1)
      }
      c.position.addScaledVector(wish, speed * dt)
      this.velocity.set(0, 0, 0)
      this.onGround = false
      return
    }

    // ---- walk -------------------------------------------------------------
    if (wish.lengthSq() > 0) wish.normalize()
    const speed = boost ? RUN : WALK
    this.velocity.x = wish.x * speed
    this.velocity.z = wish.z * speed

    const ground = this._groundBelow(c.position)
    const floor = ground === null ? 0 : ground

    if (this.onGround && k.has('Space')) {
      this.velocity.y = JUMP
      this.onGround = false
    }
    this.velocity.y -= GRAVITY * dt

    const next = c.position.clone().addScaledVector(this.velocity, dt)
    this._resolveWalls(next)

    // stand on the floor under the *new* position, not the old one, so
    // stepping onto a stoop or kerb works
    const g2 = this._groundBelow(next)
    const target = (g2 === null ? floor : g2) + EYE
    if (next.y <= target + STEP) {
      next.y = target
      this.velocity.y = 0
      this.onGround = true
    } else {
      this.onGround = false
    }

    c.position.copy(next)
  }
}
