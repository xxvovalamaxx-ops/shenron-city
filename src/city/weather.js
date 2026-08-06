// weather.js — time of day, cloud cover and rain.
//
// Everything here is generated: the sun is computed from a clock, the sky and
// fog colours are interpolated from a small keyframe table, and the clouds are
// the low-poly meshes 58_weather.py authored in Blender. No purchased HDRI, no
// sky photograph — see docs/phase2/LICENSING.md, rules 2 and 3.
//
// The three things that actually sell weather in a city, in order:
//   1. where the sun is, because it decides which side of every avenue is lit
//   2. what colour the haze is, because at 26 km fog is most of the picture
//   3. whether the road is wet, because a wet road doubles the light in frame

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// The /models/manhattan/ mount is cached for an hour, and these asset files carry no
// version in their URL the way the world tiles do. In dev that means a rebuilt
// glb silently does not arrive -- which is exactly how P2-021 burned an hour
// on a corrected export that "did nothing". Never cache them in dev.
const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

const CLOUD_MESHES = ['CLOUD_puff_a', 'CLOUD_puff_b', 'CLOUD_puff_c']
const CLOUD_BASE_Y = 900        // metres above sea level
const CLOUD_SPREAD = 14000      // radius of the cloud field
const MAX_CLOUDS = 220

const RAIN_BOX = 46             // half-extent of the rain volume, metres
const RAIN_TOP = 34
const MAX_DROPS = 3000
const MAX_SPLASH = 260
const FALL_SPEED = 22           // m/s, near enough terminal velocity

// Sun colour and sky by hour. Manhattan's grid runs 29 degrees off true north,
// which is why the light comes down the numbered streets twice a year and why
// azimuth matters as much as elevation here.
const KEYS = [
  // hour, elevation, azimuth, sunColour, sunI, skyTop, haze, hemiI, exposure
  [0.0, -18, 20, 0x1b2740, 0.05, 0x070b16, 0x11182a, 0.30, 0.85],
  [5.0, -6, 62, 0x40364a, 0.20, 0x1a2440, 0x2c3550, 0.55, 0.95],
  [6.5, 6, 72, 0xff9c5c, 1.30, 0x4d6288, 0xc09a86, 0.95, 1.05],
  [9.0, 34, 108, 0xffe0b8, 2.40, 0x7ba4d4, 0xb4cbe2, 1.35, 1.05],
  [13.0, 62, 180, 0xfff6e8, 2.90, 0x8fb6dd, 0xb9cfe4, 1.55, 1.05],
  [17.0, 30, 250, 0xfff2dc, 2.60, 0x86aed8, 0xbccbdc, 1.45, 1.05],
  [19.0, 5, 282, 0xff8a4a, 1.15, 0x5a6f9a, 0xcf9a78, 0.95, 1.08],
  [20.5, -8, 292, 0x3a3550, 0.18, 0x222c4c, 0x39405c, 0.55, 0.98],
  [24.0, -18, 20, 0x1b2740, 0.05, 0x070b16, 0x11182a, 0.30, 0.85],
]

function lerpHex(a, b, t) {
  const ca = new THREE.Color(a)
  return ca.lerp(new THREE.Color(b), t)
}

function sampleKeys(hour) {
  let i = 0
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= hour) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const t = Math.max(0, Math.min(1, (hour - a[0]) / (b[0] - a[0])))
  const n = (k) => a[k] + (b[k] - a[k]) * t
  return {
    elevation: n(1), azimuth: n(2),
    sunColor: lerpHex(a[3], b[3], t), sunI: n(4),
    skyTop: lerpHex(a[5], b[5], t), haze: lerpHex(a[6], b[6], t),
    hemiI: n(7), exposure: n(8),
  }
}

export class Weather {
  constructor(scene, renderer, lights, city) {
    this.scene = scene
    this.renderer = renderer
    this.lights = lights          // { sun, hemi, fill } from buildSky
    this.groundY = city?.meta?.land_level_m ?? 12.0

    this.hour = 17.0              // late afternoon, matching the old fixed sun
    this.timeScale = 0            // hours per second; 0 = frozen
    this.cover = 0.35             // 0..1 cloud cover
    this.rain = 0.0               // 0..1 rain intensity
    this.wind = new THREE.Vector2(3.2, -1.1)   // m/s in local metres

    this.clouds = []
    this.drops = null
    this.splashes = null
    this.dropState = null
    this.splashState = null
    this.clock = 0
    this.ready = false
    this.stats = { hour: 17, clouds: 0, drops: 0, wet: 0 }
  }

  async load(url = '/models/manhattan/weather.glb') {
    const gltf = await new GLTFLoader().loadAsync(url + bust())
      .catch(() => null)
    if (!gltf) { console.warn('[weather] no weather.glb'); return this }
    const src = new Map()
    gltf.scene.traverse((o) => { if (o.isMesh) src.set(o.name, o) })

    // Clouds are lit only by ambient: a directional light on a 300 m lump of
    // low-poly geometry gives it a hard terminator, which reads as a rock.
    const cloudMat = new THREE.MeshBasicMaterial({
      vertexColors: true, color: 0xffffff, fog: false,
      transparent: true, opacity: 0.92, depthWrite: false,
    })
    for (const name of CLOUD_MESHES) {
      const m = src.get(name)
      if (!m) continue
      const im = new THREE.InstancedMesh(m.geometry, cloudMat,
        Math.ceil(MAX_CLOUDS / CLOUD_MESHES.length))
      im.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(im.count * 3).fill(1), 3)
      im.frustumCulled = false
      im.renderOrder = -10
      im.name = `WEATHER_${name}`
      im.count = 0
      this.clouds.push(im)
      this.scene.add(im)
    }

    const rainMat = new THREE.MeshBasicMaterial({
      vertexColors: true, color: 0xffffff, transparent: true,
      opacity: 0.45, depthWrite: false, fog: false,
      side: THREE.DoubleSide,
    })
    const streak = src.get('RAIN_streak')
    if (streak) {
      this.drops = new THREE.InstancedMesh(streak.geometry, rainMat, MAX_DROPS)
      this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.drops.frustumCulled = false
      this.drops.name = 'WEATHER_rain'
      this.drops.count = 0
      this.scene.add(this.drops)
      this.dropState = new Float32Array(MAX_DROPS * 3)   // x, y, z offsets
      for (let i = 0; i < MAX_DROPS; i++) {
        this.dropState[i * 3] = (Math.random() * 2 - 1) * RAIN_BOX
        this.dropState[i * 3 + 1] = Math.random() * RAIN_TOP
        this.dropState[i * 3 + 2] = (Math.random() * 2 - 1) * RAIN_BOX
      }
    }
    const splash = src.get('RAIN_splash')
    if (splash) {
      this.splashes = new THREE.InstancedMesh(splash.geometry, rainMat,
        MAX_SPLASH)
      this.splashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.splashes.frustumCulled = false
      this.splashes.name = 'WEATHER_splash'
      this.splashes.count = 0
      this.scene.add(this.splashes)
      this.splashState = new Float32Array(MAX_SPLASH * 3) // x, z, age
      for (let i = 0; i < MAX_SPLASH; i++) this.splashState[i * 3 + 2] = 99
    }
    this.umbrellaGeometry = src.get('PROP_umbrella')?.geometry || null

    this._seedClouds()
    this.ready = true
    this.apply()
    return this
  }

  _seedClouds() {
    // Deterministic layout, so the sky does not rearrange on every reload.
    this.cloudField = []
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const a = (i * 2.399963) % (Math.PI * 2)      // golden angle
      const r = CLOUD_SPREAD * Math.sqrt((i + 0.5) / MAX_CLOUDS)
      this.cloudField.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        y: CLOUD_BASE_Y + ((i * 137) % 420),
        s: 0.7 + ((i * 61) % 100) / 100 * 1.8,
        rot: ((i * 97) % 628) / 100,
        mesh: i % this.clouds.length,
        // each cloud has its own threshold, so raising cover fills the sky in
        // a stable order instead of popping every cloud at once
        gate: (i + 0.5) / MAX_CLOUDS,
      })
    }
  }

  setTime(hour) { this.hour = ((hour % 24) + 24) % 24; this.apply() }
  setCover(c) { this.cover = Math.max(0, Math.min(1, c)); this.apply() }
  setRain(r) {
    this.rain = Math.max(0, Math.min(1, r))
    // rain implies cloud; a downpour under a clear sky is a bug, not weather
    if (this.rain > 0) this.cover = Math.max(this.cover, 0.55 + this.rain * 0.4)
    this.apply()
  }

  // Everything that only changes when the sky changes, not per frame.
  apply() {
    if (!this.lights) return
    const k = sampleKeys(this.hour)
    const { sun, hemi, fill } = this.lights

    // A directional light below the horizon lights the undersides of every
    // cornice and parapet in the city, which reads as the ground glowing.
    // Night keeps the direction and floors the elevation; the table's own
    // intensity is what makes it night.
    const el = THREE.MathUtils.degToRad(Math.max(3, k.elevation))
    const az = THREE.MathUtils.degToRad(k.azimuth)
    const d = 12000
    // azimuth 0 = north (-z in world, since world z = -y_m), 90 = east
    sun.position.set(
      Math.sin(az) * Math.cos(el) * d,
      Math.sin(el) * d,
      -Math.cos(az) * Math.cos(el) * d,
    )

    // Cloud cover flattens and cools the light rather than just dimming it.
    const overcast = this.cover * (0.55 + this.rain * 0.45)
    sun.color.copy(k.sunColor).lerp(new THREE.Color(0xc8d4e2), overcast * 0.8)
    sun.intensity = k.sunI * (1 - overcast * 0.78)
    hemi.intensity = k.hemiI * (1 - overcast * 0.25)
    fill.intensity = 0.8 * (1 - overcast * 0.35) + overcast * 0.5

    const sky = k.skyTop.clone().lerp(new THREE.Color(0x6f7783), overcast)
    const haze = k.haze.clone().lerp(new THREE.Color(0x707880), overcast)
    this.scene.background = sky
    if (this.scene.fog) {
      this.scene.fog.color.copy(haze)
      // rain closes the view down hard; this is most of what makes it read
      const near = 2600 * (1 - this.rain * 0.72)
      const far = 26000 * (1 - this.rain * 0.80) * (1 - overcast * 0.25)
      this.scene.fog.near = Math.max(120, near)
      this.scene.fog.far = Math.max(900, far)
    }
    this.renderer.toneMappingExposure = k.exposure * (1 - overcast * 0.12)

    this.skyColor = sky
    this.stats.hour = +this.hour.toFixed(2)
    this.stats.wet = +(this.rain).toFixed(2)
    this._applyWetness()
  }

  // Give the streamers to the weather so a wet road can actually look wet.
  bindSurfaces(...streamers) {
    this.surfaces = streamers.filter(Boolean)
    this._wetCache = new Map()
    this._applyWetness()
  }

  // A wet road is darker and reflects more. These surfaces are Lambert, so
  // there is no specular term to raise — but darkening alone reads as wet,
  // and it is the single cheapest weather cue in a street scene.
  _applyWetness() {
    if (!this.surfaces) return
    const WET = /asphalt|concrete|kerb|walk|road|paint|land/i
    const k = 1 - this.rain * 0.42
    for (const s of this.surfaces) {
      for (const t of s.tiles.values()) {
        if (t.state !== 'ready' || !t.group) continue
        t.group.traverse((o) => {
          if (!o.isMesh || o.userData.building) return
          const m = o.material
          if (!m || !m.color) return
          const name = m.name || ''
          if (!WET.test(name)) return
          let base = this._wetCache.get(m)
          if (!base) {
            base = m.color.clone()
            this._wetCache.set(m, base)
          }
          m.color.copy(base).multiplyScalar(k)
        })
      }
    }
  }

  update(dt, camera) {
    if (!this.ready) return this.stats
    this.clock += dt
    if (this.timeScale) {
      this.hour = (this.hour + this.timeScale * dt) % 24
      this.apply()
    }
    this._updateClouds(dt, camera)
    this._updateRain(dt, camera)
    // Tiles stream in after the weather is set, and a tile that arrives during
    // a downpour would otherwise show a dry road until the weather changed.
    const resident = this.surfaces
      ? this.surfaces.reduce((a, s) => a + s.stats.resident, 0) : 0
    if (resident !== this._lastResident) {
      this._lastResident = resident
      this._applyWetness()
    }
    return this.stats
  }

  _updateClouds(dt, camera) {
    if (!this.clouds.length) return
    const dummy = new THREE.Object3D()
    const col = new THREE.Color()
    for (const im of this.clouds) im.count = 0
    const drift = this.clock * 0.6
    // lit from the sun side, grey underneath, greyer the heavier the cover
    const lit = new THREE.Color(0xffffff).lerp(
      this.lights.sun.color, 0.35).multiplyScalar(1 - this.cover * 0.30)
    const dull = new THREE.Color(0x8b93a0).multiplyScalar(
      1 - this.cover * 0.25)

    for (const c of this.cloudField) {
      if (c.gate > this.cover) continue
      const im = this.clouds[c.mesh]
      if (!im || im.count >= im.instanceMatrix.count) continue
      // The field is anchored to the world, not the camera, so clouds do not
      // slide with the viewer -- but it wraps, so flying north never runs out.
      const x = ((c.x + this.wind.x * drift - camera.position.x +
        CLOUD_SPREAD) % (CLOUD_SPREAD * 2)) - CLOUD_SPREAD + camera.position.x
      const z = ((c.z - this.wind.y * drift - camera.position.z +
        CLOUD_SPREAD) % (CLOUD_SPREAD * 2)) - CLOUD_SPREAD + camera.position.z
      dummy.position.set(x, c.y, z)
      dummy.rotation.set(0, c.rot, 0)
      dummy.scale.setScalar(c.s)
      dummy.updateMatrix()
      const i = im.count++
      im.setMatrixAt(i, dummy.matrix)
      col.copy(lit).lerp(dull, Math.min(1, c.gate / Math.max(0.05, this.cover)))
      im.setColorAt(i, col)
    }
    let n = 0
    for (const im of this.clouds) {
      im.instanceMatrix.needsUpdate = true
      if (im.instanceColor) im.instanceColor.needsUpdate = true
      n += im.count
    }
    this.stats.clouds = n
  }

  _updateRain(dt, camera) {
    if (!this.drops) return
    const want = Math.round(MAX_DROPS * this.rain)
    const dummy = new THREE.Object3D()
    const cx = camera.position.x
    const cy = camera.position.y
    const cz = camera.position.z
    const fall = FALL_SPEED * dt
    const wx = this.wind.x * 0.25 * dt
    const wz = -this.wind.y * 0.25 * dt
    // Drops lean into the wind. One shared tilt is right because they all
    // fall through the same air.
    const tilt = Math.atan2(this.wind.length() * 0.25, FALL_SPEED)

    let live = 0
    for (let i = 0; i < want; i++) {
      const o = i * 3
      this.dropState[o + 1] -= fall
      this.dropState[o] += wx
      this.dropState[o + 2] += wz
      if (this.dropState[o + 1] < 0) {
        // recycle to the top of the box, and leave a splash if it landed
        // near the ground rather than on a roof
        this.dropState[o + 1] += RAIN_TOP
        this.dropState[o] = (Math.random() * 2 - 1) * RAIN_BOX
        this.dropState[o + 2] = (Math.random() * 2 - 1) * RAIN_BOX
        if (this.splashState && Math.random() < 0.10) {
          const s = (Math.random() * MAX_SPLASH) | 0
          this.splashState[s * 3] = cx + this.dropState[o]
          this.splashState[s * 3 + 1] = cz + this.dropState[o + 2]
          this.splashState[s * 3 + 2] = 0
        }
      }
      // The band is hung just below the camera and rises above it, so drops
      // pass through eye level rather than all falling out of shot overhead.
      const y = Math.max(this.groundY,
        Math.max(this.groundY, cy - 10) + this.dropState[o + 1])
      dummy.position.set(cx + this.dropState[o], y, cz + this.dropState[o + 2])
      dummy.rotation.set(tilt, 0, 0)
      dummy.updateMatrix()
      this.drops.setMatrixAt(live++, dummy.matrix)
    }
    this.drops.count = live
    this.drops.instanceMatrix.needsUpdate = true
    this.stats.drops = live

    if (this.splashes) {
      let sn = 0
      for (let i = 0; i < MAX_SPLASH; i++) {
        const o = i * 3
        const age = this.splashState[o + 2]
        if (age > 0.42) continue
        this.splashState[o + 2] = age + dt
        const t = age / 0.42
        dummy.position.set(this.splashState[o], this.groundY + 0.02,
          this.splashState[o + 1])
        dummy.rotation.set(-Math.PI / 2, 0, 0)
        dummy.scale.setScalar(0.4 + t * 2.6)
        dummy.updateMatrix()
        this.splashes.setMatrixAt(sn++, dummy.matrix)
      }
      this.splashes.count = sn
      this.splashes.instanceMatrix.needsUpdate = true
    }
  }
}
