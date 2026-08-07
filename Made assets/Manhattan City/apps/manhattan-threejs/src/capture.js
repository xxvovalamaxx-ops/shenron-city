// capture.js — put the camera at a real address, render, and save the frame.
//
// Dev only: the sink is a Vite middleware, so this does nothing in a build.
// It exists so claims about how the city looks can be checked against actual
// GPU output instead of taken on trust.
//
// Positions are given as latitude and longitude and projected here. Writing
// them as raw local metres is how the first pass ended up photographing the
// East River and calling it Harlem.

const LAT0 = 40.78
const LON0 = -73.968
const M_LAT = 110574.0
const M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180)

const EYE = 1.7

// name: [lat, lon, altitude above the street, yaw, pitch, mode]
const SHOTS = {
  // aerial
  midtown_air: [40.7570, -73.9855, 500, 0.9, -0.42, 'fly'],
  skyline_from_east: [40.7480, -73.9500, 380, -1.45, -0.12, 'fly'],
  downtown_air: [40.7100, -74.0100, 430, 0.4, -0.35, 'fly'],
  central_park_air: [40.7810, -73.9660, 320, 3.0, -0.28, 'fly'],

  // street level
  fifth_ave_34th: [40.7484, -73.9857, EYE, 0.35, 0.10, 'walk'],
  times_square: [40.7580, -73.9855, EYE, 0.30, 0.14, 'walk'],
  west_village: [40.7320, -74.0030, EYE, 1.05, 0.04, 'walk'],
  harlem_rowhouses: [40.8090, -73.9480, EYE, 0.35, 0.05, 'walk'],
  fidi_canyon: [40.7069, -74.0100, EYE, 0.9, 0.30, 'walk'],
  soho_castiron: [40.7240, -74.0010, EYE, 0.35, 0.08, 'walk'],
}

export function installCapture(ctx) {
  const { camera, renderer, scene, controls, city } = ctx
  const ground = city?.meta?.land_level_m ?? 12.0

  // A latitude and longitude typed from memory lands in the middle of a block
  // about as often as it lands on a street -- the first pass put the "5th and
  // 34th" camera inside the Empire State Building's block, looking at an empty
  // plane. Snapping to the street graph puts the camera on the carriageway and
  // aims it down the street, which is what the shot is supposed to show.
  let graph = null
  let walk = null
  fetch('/streets/street_graph.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((g) => { graph = g })
    .catch(() => {})
  fetch('/streets/walk_graph.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((g) => { walk = g })
    .catch(() => {})

  function nearestSegment(lines, xM, yM, radius) {
    let best = null
    let bd = radius * radius
    for (const e of lines) {
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i]
        const b = e.pts[i + 1]
        const cx = (a[0] + b[0]) * 0.5
        const cy = (a[1] + b[1]) * 0.5
        const d = (cx - xM) ** 2 + (cy - yM) ** 2
        if (d < bd) { bd = d; best = { a, b, cx, cy, e } }
      }
    }
    return best
  }

  // A street-level shot belongs on the pavement. Standing on the carriageway
  // centreline is where the viewer would be if they were a traffic cone, and
  // it also puts the camera inside whatever bus drives through -- two of the
  // first three shots were taken from inside a vehicle.
  function snapToWalk(xM, yM, radius = 140) {
    if (!walk) return null
    return nearestSegment(walk.lanes, xM, yM, radius)
  }

  function snapToStreet(xM, yM, radius = 120) {
    if (!graph) return null
    return nearestSegment(
      graph.edges.filter((e) => e.drivable && e.kind === 'street'),
      xM, yM, radius)
  }

  function place(spec) {
    const [lat, lon, alt, yaw, pitch, mode] = spec
    let xM = (lon - LON0) * M_LON
    let yM = (lat - LAT0) * M_LAT
    let useYaw = yaw

    if (mode === 'walk') {
      const seg = snapToWalk(xM, yM) || snapToStreet(xM, yM)
      if (seg) {
        xM = seg.cx
        yM = seg.cy
        // look along the pavement; world forward is (-sin yaw, 0, -cos yaw)
        // and world z = -y_m, so a segment (dx, dy) becomes (dx, -dy)
        useYaw = Math.atan2(-(seg.b[0] - seg.a[0]), seg.b[1] - seg.a[1])
      }
    }

    controls.mode = mode
    // the pavement sits a kerb above the carriageway, so eye height in walk
    // mode is measured from there, not from the road
    camera.position.set(xM, ground + alt + (mode === 'walk' ? 0.20 : 0), -yM)
    controls.yaw = useYaw
    controls.pitch = pitch
    // Controls.update() is what normally turns yaw/pitch into a quaternion,
    // and it runs from the render loop -- which is throttled to about 1 Hz in
    // a hidden tab. Apply the orientation here or every shot points wherever
    // the camera happened to be left.
    camera.quaternion.setFromEuler(
      new ctx.THREE.Euler(pitch, useYaw, 0, 'YXZ'))
    camera.updateMatrixWorld(true)
    ctx.applyClip(camera, mode)
  }

  // The render loop is what normally drives streaming, and it is throttled to
  // about 1 Hz in a hidden tab. Pump the streamers explicitly so a shot in
  // Harlem is not taken before Harlem's tiles have arrived.
  async function settle(timeoutMs = 20000) {
    const t0 = performance.now()
    for (;;) {
      let pending = 0
      for (const s of ctx.streamers || []) {
        const st = s.update(camera)
        pending += st.loading + st.queued
      }
      if (!pending || performance.now() - t0 > timeoutMs) return
      await new Promise((r) => setTimeout(r, 120))
    }
  }

  // The canvas is sized from innerWidth, and a pane that is not displayed
  // reports zero -- so every shot came back as `data:,` and landed as a 0-byte
  // PNG that still reported success. Capture pins its own resolution and puts
  // the viewport back afterwards, so evidence does not depend on anybody
  // looking at the window.
  const SHOT_W = 1280
  const SHOT_H = 720

  function withSize(fn) {
    const prev = renderer.getSize(new ctx.THREE.Vector2())
    const prevAspect = camera.aspect
    renderer.setSize(SHOT_W, SHOT_H, false)
    camera.aspect = SHOT_W / SHOT_H
    camera.updateProjectionMatrix()
    try {
      return fn()
    } finally {
      if (prev.x > 0 && prev.y > 0) renderer.setSize(prev.x, prev.y, false)
      camera.aspect = prevAspect || SHOT_W / SHOT_H
      camera.updateProjectionMatrix()
    }
  }

  async function shoot(name, spec) {
    place(spec)
    await settle()
    if (ctx.beforeShot) ctx.beforeShot()
    // two frames: the first primes any lazily compiled program
    const url = withSize(() => {
      renderer.render(scene, camera)
      renderer.render(scene, camera)
      const u = renderer.domElement.toDataURL('image/png')
      if (u.length < 1000) {
        console.warn('[capture] empty frame for', name, u.slice(0, 24))
      }
      return u
    })
    return fetch(`/__capture?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: url,
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }))
  }

  // Same shot, but aimed with two world points instead of a lat/lon and a
  // heading. Anything placed by its own matrix -- a room, the HQ -- knows
  // where its camera goes in world space and should not have to convert that
  // back into a bearing for the capture path to convert it forward again.
  async function shootFrom(name, eye, at, mode = 'walk') {
    controls.mode = mode
    camera.position.copy(eye)
    camera.lookAt(at)
    camera.updateMatrixWorld(true)
    const e = new ctx.THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    controls.yaw = e.y
    controls.pitch = e.x
    ctx.applyClip(camera, mode)
    await settle()
    if (ctx.beforeShot) ctx.beforeShot()
    const url = withSize(() => {
      // re-aim inside the pinned aspect: lookAt is unaffected, but anything
      // the beforeShot hook moved needs the second frame anyway
      camera.lookAt(at)
      renderer.render(scene, camera)
      renderer.render(scene, camera)
      const u = renderer.domElement.toDataURL('image/png')
      if (u.length < 1000) {
        console.warn('[capture] empty frame for', name, u.slice(0, 24))
      }
      return u
    })
    return fetch(`/__capture?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: url,
    }).then((r) => r.json()).catch((e2) => ({ ok: false, error: String(e2) }))
  }

  async function all(only = null) {
    const out = []
    for (const [name, spec] of Object.entries(SHOTS)) {
      if (only && !only.includes(name)) continue
      out.push(await shoot(name, spec))
    }
    return out
  }

  window.__capture = { shoot, shootFrom, all, place, settle, SHOTS }
  return { shoot, shootFrom, all }
}
