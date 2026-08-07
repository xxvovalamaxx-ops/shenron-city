// main.js — Manhattan Three.js runtime, v0.3.
//
// What this is: a streaming viewer of the Phase 1 world with building identity
// carried through to the browser, plus a live traffic simulation on the LION
// graph and a crowd on the surveyed sidewalks. What it is not, yet: a game.
// There are no interiors and one LOD. See docs/phase2/.

import * as THREE from 'three'
import { City } from './city.js'
import { TileStreamer } from './streamer.js'
import { Controls } from './controls.js'
import { FacadeMaterial } from './facade.js'
import { buildSky, applyClip } from './sky.js'
import { installCapture } from './capture.js'
import { Traffic } from './traffic.js'
import { StaticProps } from './props.js'
import { Crowd } from './pedestrians.js'
import { Demand } from './demand.js'
import { LodLayer } from './lod.js'
import { Weather } from './weather.js'
import { CityAudio, verify as verifyAudio } from './audio.js'
import { Interiors } from './interiors.js'
import { Doors } from './doors.js'
import { HQ } from './hq.js'
import { Corridor } from './corridor.js'
import { Subway } from './subway.js'

const $ = (id) => document.getElementById(id)
const fmt = (n) => Math.round(n).toLocaleString()

// Where the camera opens, in the local tangent plane. This was labelled
// "Times Square" and is not: (-1900, -600) is 40.7746 N, -73.9905 W, which is
// Lincoln Square, about 1.8 km up Broadway. Times Square is (-1476, -2433).
// The label mattered because performance numbers taken here were reported as
// Times Square figures, and Times Square is the denser view of the two.
const TIMES_SQUARE = { x: -1476, y: -2433 }
const START = { x: TIMES_SQUARE.x, y: TIMES_SQUARE.y, alt: 620 }

async function boot() {
  const canvas = $('view')
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)

  const scene = new THREE.Scene()
  const lights = buildSky(scene, renderer)

  const camera = new THREE.PerspectiveCamera(
    62, innerWidth / innerHeight, 12, 45000,
  )
  camera.position.set(START.x, START.alt, -START.y)

  const setBoot = (msg, frac) => {
    $('boot-sub').textContent = msg
    if (frac != null) $('boot-bar').style.width = `${Math.round(frac * 100)}%`
  }

  // ---- data --------------------------------------------------------------
  let city
  try {
    city = await City.load((what, frac) => setBoot(`loading ${what}…`, frac))
  } catch (err) {
    setBoot(`data load failed: ${err.message}`, 1)
    console.error(err)
    return
  }
  console.info('[city]', city.count, 'buildings,',
    city.meta.archetypes.length, 'archetypes,',
    city.meta.districts.length, 'districts')

  // ---- tiles -------------------------------------------------------------
  const facade = new FacadeMaterial(city)
  const streamer = new TileStreamer(scene, city.meta, facade.material)
  // Sidewalks, kerbs and road paint. Separate tile set, much tighter radius.
  const streets = new TileStreamer(scene, city.meta, null, 'streets')
  // Far tiers first: a tile that is about to be covered by L2 should never
  // briefly render at full detail on the way in.
  const lod = new LodLayer(scene)
  await lod.load()
  console.info('[lod]', lod.tiles.size, 'tiles have far tiers')

  setBoot(`streaming ${streamer.tileCount} tiles…`, 0.5)
  await streamer.preload(camera, (frac, file) => {
    setBoot(`streaming ${file}`, 0.5 + frac * 0.45)
  })
  await streets.preload(camera, (frac, file) => {
    setBoot(`streets ${file}`, 0.95 + frac * 0.05)
  })

  // ---- street life -------------------------------------------------------
  setBoot('placing street furniture…', 0.95)
  const props = new StaticProps(scene, city)
  await props.load()
  props.update(camera, true)
  console.info('[props]', props.stats.total, 'placed,',
    props.stats.types, 'types')

  // How busy each block is, from PLUTO floor space and the DOT volume counts.
  // Loaded before the sims because both weight their spawns by it.
  setBoot('reading the demand field…', 0.97)
  const demand = new Demand()
  await demand.load()
  console.info('[demand]', demand.ready ? 'loaded' : 'missing')

  setBoot('starting traffic…', 0.98)
  const traffic = new Traffic(scene, city, demand)
  await traffic.load()
  console.info('[traffic]', traffic.stats.lanes, 'lanes')

  setBoot('setting the weather…', 0.985)
  const weather = new Weather(scene, renderer, lights, city)
  await weather.load()
  // the streamers own the road and pavement materials a wet street darkens
  weather.bindSurfaces(streamer, streets)
  console.info('[weather]', weather.ready ? 'ready' : 'missing')

  setBoot('filling the pavements…', 0.99)
  const crowd = new Crowd(scene, city, demand)
  await crowd.load()
  console.info('[crowd]', crowd.stats.lanes, 'walk lanes')

  // ---- interiors ---------------------------------------------------------
  setBoot('furnishing the interiors…', 0.995)
  const interiors = new Interiors(scene, city)
  await interiors.load()
  console.info('[interiors]', interiors.stats.rooms, 'rooms placed')

  // ---- HQ ----------------------------------------------------------------
  // The tower and its two rooms. Registers with interiors, so it shares the
  // one indoor lamp, the one emissive patch and the one enter/exit path.
  setBoot('raising the HQ…', 0.997)
  const hq = new HQ(scene, city, interiors, facade)
  await hq.load()
  interiors.linkRooms()

  // ---- subway ------------------------------------------------------------
  // Kiosks, and the footfall the demand field has been missing.
  const subway = new Subway(scene, city)
  await subway.load()
  demand.setSubway(subway)

  // ---- hero corridor -----------------------------------------------------
  setBoot('routing the corridor…', 0.999)
  const corridor = new Corridor(scene, city, interiors, hq, streamer)
  await corridor.load()

  // ---- doors (Phase 3B) ---------------------------------------------------
  // Real doorways in the corridor buildings, walk-in interiors and the
  // physical lift rides. Data-driven off data/doors/doors.json.
  setBoot('cutting the doorways…', 0.9995)
  const doors = new Doors(scene, city, interiors, hq, corridor, streamer)
  await doors.load()

  // ---- audio -------------------------------------------------------------
  // Entirely synthesised; there is no audio file in this project. A browser
  // will not start an AudioContext without a gesture, so this waits for one.
  const audio = new CityAudio()
  doors.setAudio(audio)
  const startAudio = () => {
    audio.start()
    $('h-audio').textContent = audio.stats.running ? 'on' : 'unavailable'
  }
  addEventListener('pointerdown', startAudio, { once: true })
  addEventListener('keydown', startAudio, { once: true })

  // ---- controls ----------------------------------------------------------
  const controls = new Controls(camera, canvas)
  doors.bind(camera, controls)
  // Suppression is a shader trick: the hidden building's triangles are still
  // in the tile mesh, so the walk collider has to be told to pass through
  // them or the player bumps into a building that is not there.
  controls.setHitFilter((h) => facade.hitSuppressed(h))
  controls.yaw = Math.PI * 0.15
  controls.pitch = -0.35
  applyClip(camera, controls.mode)

  let lastMode = controls.mode
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()

  // Click picks a building, but only a click that was not a drag-to-look.
  let downAt = 0
  let downPos = [0, 0]
  canvas.addEventListener('pointerdown', (e) => {
    downAt = performance.now()
    downPos = [e.clientX, e.clientY]
  })
  canvas.addEventListener('pointerup', (e) => {
    const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1])
    if (performance.now() - downAt > 400 || moved > 6) return
    pick(e.clientX, e.clientY)
  })

  function pick(sx, sy) {
    if (controls.locked) {
      ndc.set(0, 0) // pointer is locked to the centre of the screen
    } else {
      ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1)
    }
    ray.setFromCamera(ndc, camera)
    ray.far = 6000
    // skip past anything suppressed, or clicking the HQ reports the building
    // that used to be on its lot
    const hit = ray.intersectObjects(streamer.pickables(), true)
      .find((h) => !facade.hitSuppressed(h))
    if (!hit || !hit.face) { $('pick').hidden = true; return }
    const attr = hit.object.geometry.attributes._bid ||
                 hit.object.geometry.attributes._BID
    if (!attr) { $('pick').hidden = true; return }
    const b = city.get(Math.round(attr.getX(hit.face.a)))
    if (!b) { $('pick').hidden = true; return }

    $('pick').hidden = false
    $('p-name').textContent = b.name || b.address || `building ${b.id}`
    $('p-id').textContent = b.id
    $('p-addr').textContent = b.address || '–'
    $('p-dist').textContent = b.district || '–'
    $('p-arch').textContent = b.archetype.replace(/_/g, ' ')
    $('p-h').textContent = `${b.height.toFixed(1)} m`
    $('p-yr').textContent = b.year || '–'
    $('p-fl').textContent = b.floors || '–'
    $('p-conf').textContent = b.confidence
  }

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyH') {
      $('help').hidden = !$('help').hidden
      // #credit is deliberately not in here. ODbL attribution that a
      // keystroke removes is attribution the reader cannot rely on finding.
    }
    if (e.code === 'KeyL') {
      $('credits').hidden = !$('credits').hidden
    }
    if (e.code === 'Escape' && !$('credits').hidden) {
      $('credits').hidden = true
    }
    if (e.code === 'KeyE') {
      const act = interiors.action()
      if (!act) return
      if (act.kind === 'link') {
        // Phase 3B: a lift link is a ride in the corridor's own cab, not a
        // teleport. Falls back to the old jump only if the cab is missing.
        if (!doors.rideLift(act.link, camera, controls)) {
          interiors.enter(act.room)
          camera.position.copy(act.room.eyeWorld)
          camera.lookAt(act.room.lookAt)
          const eu = new THREE.Euler().setFromQuaternion(
            camera.quaternion, 'YXZ')
          controls.yaw = eu.y
          controls.pitch = eu.x
        }
        controls.mode = 'walk'
        applyClip(camera, 'walk')
      } else if (act.kind === 'exit') {
        const room = interiors.exit()
        // step back out to the doorway rather than into the wall
        if (room) camera.position.copy(room.door)
        applyClip(camera, controls.mode)
      } else {
        // enter a room from the street (only rooms without a physical
        // doorway still answer here -- see interiors.action)
        const room = act.room
        interiors.enter(room)
        camera.position.copy(room.eyeWorld)
        camera.lookAt(room.lookAt)
        // keep the mouse-look in step with where the camera was just put
        const eu = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
        controls.yaw = eu.y
        controls.pitch = eu.x
        controls.mode = 'walk'
        applyClip(camera, 'walk')
      }
    }
    if (e.code === 'KeyM') {
      audio.setMuted(audio.enabled)
      $('h-audio').textContent = audio.stats.running ? 'on' : 'muted'
    }
    // C starts the hero corridor; C again while it runs advances a leg you
    // are standing in, and Escape leaves it. The door system suspends while
    // the corridor owns the camera, or its triggers would fight the script.
    if (e.code === 'KeyC' && !controls.keys.has('ShiftLeft')) {
      if (!corridor.active) { doors.active = false; corridor.start(camera, controls) }
      else corridor.next()
    }
    if (e.code === 'Escape' && corridor.active) {
      corridor.stop()
      doors.active = true
    }
  })

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  // ---- hud ---------------------------------------------------------------
  $('boot').classList.add('gone')
  setTimeout(() => { $('boot').hidden = true }, 600)
  $('hud').hidden = false
  $('help').hidden = false
  $('credit').hidden = false
  $('credit-more').addEventListener('click', (ev) => {
    ev.preventDefault()
    $('credits').hidden = !$('credits').hidden
  })
  $('credits-close').addEventListener('click', () => {
    $('credits').hidden = true
  })

  let frames = 0
  let fpsClock = performance.now()
  let whereClock = 0
  const clock = new THREE.Clock()

  function loop() {
    requestAnimationFrame(loop)
    const dt = Math.min(clock.getDelta(), 0.1)
    // Headless QA (scripts/qa/doorcheck-run.mjs) freezes the loop and steps
    // controls/doors with a fixed dt so a walk test is deterministic.
    if (window.__qaFreeze) return

    if (controls.mode !== lastMode) {
      applyClip(camera, controls.mode)
      lastMode = controls.mode
      $('h-mode').textContent = controls.mode
    }
    // Walk collision tests against the street layer too, so the camera
    // stands on the pavement and steps up the kerb instead of clipping it.
    // Door assemblies (frames, leaves, thresholds) join the set near a
    // doorway or while the player is inside a door room.
    controls.setColliders(interiors.inside
      ? [...interiors.colliders(), ...doors.pickables()]
      : [...streamer.pickables(), ...streets.pickables(),
        ...doors.pickables(),
        ...(hq.tower ? [hq.tower.children[0]] : [])])
    controls.update(dt)

    const st = streamer.update(camera)
    const sst = streets.update(camera)
    lod.update(camera, streamer)
    props.update(camera)
    subway.update(camera)
    traffic.update(dt, camera)
    crowd.update(dt, camera)
    weather.update(dt, camera)
    interiors.update(camera)
    corridor.update(dt)
    doors.update(dt, camera)
    audio.update(dt, {
      camera, traffic, crowd, weather, controls, interiors, doors,
    })
    renderer.render(scene, camera)

    frames++
    const now = performance.now()
    if (now - fpsClock >= 500) {
      const fps = (frames * 1000) / (now - fpsClock)
      frames = 0
      fpsClock = now
      $('h-fps').textContent = fps.toFixed(0)
      $('h-tris').textContent = fmt(renderer.info.render.triangles)
      $('h-draws').textContent = renderer.info.render.calls
      $('h-tiles').textContent =
        `${st.resident}/${streamer.tileCount}` +
        (st.loading ? ` +${st.loading}` : '') +
        `  st ${sst.resident}/${streets.tileCount}`
      $('h-lod').textContent =
        `${lod.stats.full} full · ${lod.stats.L2} L2 · ` +
        `${lod.stats.L3} L3 · ${lod.stats.L4} L4`
      $('h-alt').textContent = `${camera.position.y.toFixed(0)} m`
      $('h-cars').textContent =
        `${traffic.stats.vehicles} / ${traffic.stats.simLanes} lanes`
      $('h-peds').textContent =
        `${crowd.stats.people}  (busy ${(crowd.stats.demand ?? 0).toFixed(2)})`
      $('h-props').textContent = `${fmt(props.stats.drawn)}`
      $('h-room').textContent = corridor.active
        ? `${corridor.stats.title}` +
          (corridor.stats.progress > 0
            ? ` ${Math.round(corridor.stats.progress * 100)}%`
            : '') +
          (corridor.stats.hint ? ` — ${corridor.stats.hint}` : '')
        : interiors.prompt()
      const wh = weather.stats
      $('h-sky').textContent =
        `${String(Math.floor(wh.hour)).padStart(2, '0')}:` +
        `${String(Math.floor((wh.hour % 1) * 60)).padStart(2, '0')}` +
        `  cloud ${weather.cover.toFixed(2)}  rain ${weather.rain.toFixed(2)}`
    }
    if (now - whereClock >= 900) {
      whereClock = now
      const i = city.nearest(camera.position.x, camera.position.z, 900)
      $('h-where').textContent = i >= 0 ? city.district(i) : 'off-island'
    }
  }
  loop()

  // handy for console poking and for the smoke test
  window.__manhattan = {
    scene, camera, renderer, city, streamer, streets, controls, facade,
    traffic, props, crowd, demand, lod, weather, audio, verifyAudio,
    interiors, hq, corridor, subway, doors,
    THREE,
    // what is directly under a world position, and at what height -- the
    // fastest way to answer "why can I not see the pavement"
    probe(x, z, from = 200) {
      const r = new THREE.Raycaster(
        new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0), 0, 400)
      r.firstHitOnly = false
      const objs = [...streamer.pickables(), ...streets.pickables()]
      return r.intersectObjects(objs, true).map((h) => ({
        name: h.object.name,
        y: +h.point.y.toFixed(3),
        material: h.object.material?.name || h.object.material?.type,
      }))
    },
  }
  if (import.meta.env.DEV) {
    installCapture({
      scene, camera, renderer, controls, city, applyClip, THREE,
      streamers: [streamer, streets],
      traffic,
      // A shot taken the instant the camera lands shows an empty street: the
      // sims fill from nothing and the walk cycle has not started. Run them
      // forward a few seconds of simulated time first.
      beforeShot() {
        props.update(camera, true)
        for (let i = 0; i < 90; i++) {
          traffic.update(1 / 30, camera)
          crowd.update(1 / 30, camera)
          // Rain follows the camera, so a shot taken without stepping the
          // weather renders the drops around wherever the camera used to be.
          weather.update(1 / 30, camera)
        }
      },
    })
  }
}

boot()
