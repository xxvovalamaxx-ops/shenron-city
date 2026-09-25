// weather.js — time of day, cloud cover and rain.
//
// Everything here is generated: the sun and moon follow a solar arc for the
// clock, and the sky, haze, key light, image-based ambient and exposure all
// come from one pure model (world/atmosphere/model.ts). This engine owns the
// state (hour, cover, rain) and applies it: the key light and its shadow
// map, the fallback fog and hemisphere light, the exposure, and the shared
// uniforms the sky dome, the fog chunk and the surface shaders read. The
// cloud deck is drawn by the sky dome shader; the rain is the low-poly
// streaks and splashes 58_weather.py authored in Blender.
//
// The three things that actually sell weather in a city, in order:
//   1. where the sun is, because it decides which side of every avenue is lit
//   2. what colour the haze is, because at 26 km fog is most of the picture
//   3. whether the road is wet, because a wet road doubles the light in frame

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { atmosphereAt } from '../world/atmosphere/model'
import { atmosphere, publishAtmosphere } from '../world/atmosphere/lighting-state'
import {
  LIGHT_DISTANCE, placeShadowCamera, shadowPresetFor,
} from '../world/atmosphere/sun-shadow'

// The /models/manhattan/ mount is cached for an hour, and these asset files carry no
// version in their URL the way the world tiles do. In dev that means a rebuilt
// glb silently does not arrive -- which is exactly how P2-021 burned an hour
// on a corrected export that "did nothing". Never cache them in dev.
const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

// The cloud deck drifts faster than street-level wind: it is 2 km up.
const CLOUD_WIND_SCALE = 4

const RAIN_BOX = 46             // half-extent of the rain volume, metres
const RAIN_TOP = 34
const MAX_DROPS = 3000
const MAX_SPLASH = 260
const FALL_SPEED = 22           // m/s, near enough terminal velocity

export class Weather {
  constructor(scene, renderer, lights, city) {
    this.scene = scene
    this.renderer = renderer
    this.lights = lights          // { sun, hemi, fill } from buildSky
    this.groundY = city?.meta?.land_level_m ?? 12.0

    this.hour = 17.0              // late afternoon, matching the old fixed sun
    this.timeScale = 0            // hours per second; 0 = frozen
    this.baseCover = 0.4          // fair-weather cloud; rain adds to it
    this.cover = this.baseCover   // 0..1 effective cloud cover
    this.rain = 0.0               // 0..1 rain intensity
    this.wind = new THREE.Vector2(3.2, -1.1)   // m/s in local metres

    // The cloud deck is drawn by the sky dome; kept for the API and the HUD.
    this.clouds = []
    this.drops = null
    this.splashes = null
    this.dropState = null
    this.splashState = null
    this.rainMaterial = null
    this.clock = 0
    this.ready = false
    this.shadowPreset = null
    this.state = null
    this.skyColor = new THREE.Color()
    this._keyDir = new THREE.Vector3(0, 1, 0)
    this._appliedWetRain = -1
    this.stats = { hour: 17, clouds: 0, drops: 0, wet: 0 }
  }

  async load(url = '/models/manhattan/weather.glb') {
    // The sky is procedural, so the light is right even if the rain meshes
    // never arrive.
    this.ready = true
    this.apply()
    const gltf = await new GLTFLoader().loadAsync(url + bust())
      .catch(() => null)
    if (!gltf) { console.warn('[weather] no weather.glb'); return this }
    const src = new Map()
    gltf.scene.traverse((o) => { if (o.isMesh) src.set(o.name, o) })

    // Rain is tinted by the light every time the sky changes: a white streak
    // at 45 % opacity is a snowstorm at midnight.
    const rainMat = new THREE.MeshBasicMaterial({
      vertexColors: true, color: 0xffffff, transparent: true,
      opacity: 0.45, depthWrite: false, fog: false,
      side: THREE.DoubleSide,
    })
    this.rainMaterial = rainMat
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

    this.apply()
    return this
  }

  setTime(hour) { this.hour = ((hour % 24) + 24) % 24; this.apply() }
  setCover(c) {
    this.baseCover = Math.max(0, Math.min(1, c))
    this._resolveCover()
    this.apply()
  }
  setRain(r) {
    this.rain = Math.max(0, Math.min(1, r))
    this._resolveCover()
    this.apply()
  }

  // Rain implies cloud — a downpour under a clear sky is a bug, not weather —
  // but the sky clears again when the rain stops.
  _resolveCover() {
    const rainCover = this.rain > 0 ? 0.55 + this.rain * 0.4 : 0
    this.cover = Math.max(this.baseCover, rainCover)
  }

  /** Shadow resolution and reach for a quality preset; low casts none. */
  configureShadows(quality) {
    const sun = this.lights?.sun
    if (!sun) return
    const preset = shadowPresetFor(quality)
    this.shadowPreset = preset
    sun.castShadow = !!preset
    if (!preset) return
    sun.shadow.mapSize.set(preset.mapSize, preset.mapSize)
    if (sun.shadow.map) {
      sun.shadow.map.dispose()
      sun.shadow.map = null
    }
    // Depth bias stays tiny (the frustum is 3 km deep); normal offset does
    // the acne work in world units, sized to about one texel.
    sun.shadow.bias = -0.00004
    sun.shadow.normalBias = (2 * preset.halfExtent / preset.mapSize) * 1.1
    sun.shadow.radius = quality === 'high' ? 3 : 2
  }

  // Everything that only changes when the sky changes, not per frame.
  apply() {
    if (!this.lights) return
    const st = atmosphereAt({ hour: this.hour, cover: this.cover, rain: this.rain })
    this.state = st
    publishAtmosphere(st, this.groundY + 0.4)
    const { sun, hemi, fill } = this.lights

    // The key light is the sun by day and the moon by night. Its direction
    // is placed each frame around the camera (update); keep a far fallback
    // position so it is right before the first frame too.
    this._keyDir.set(st.keyDir.x, st.keyDir.y, st.keyDir.z)
    // Never light the city from below the pavement.
    if (this._keyDir.y < 0.05) {
      this._keyDir.y = 0.05
      this._keyDir.normalize()
    }
    if (!sun.castShadow) {
      sun.target.position.set(0, 0, 0)
      sun.position.copy(this._keyDir).multiplyScalar(LIGHT_DISTANCE)
      sun.target.updateMatrixWorld()
    }
    sun.color.setRGB(st.keyColor.r, st.keyColor.g, st.keyColor.b)
    sun.intensity = st.keyIntensity
    // A softer, bluer shadow under cloud; a crisp one at golden hour.
    sun.shadow.intensity = 0.92 - st.cover * 0.35

    // Image-based light does the ambient work; the hemisphere is only a
    // floor for anything that renders before the first environment bake.
    hemi.color.setRGB(st.hemiSky.r, st.hemiSky.g, st.hemiSky.b)
    hemi.groundColor.setRGB(st.hemiGround.r, st.hemiGround.g, st.hemiGround.b)
    hemi.intensity = st.hemiIntensity
    fill.intensity = st.fillIntensity

    this.skyColor.setRGB(st.horizon.r, st.horizon.g, st.horizon.b)
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(this.skyColor)
    } else {
      this.scene.background = this.skyColor.clone()
    }
    if (this.scene.fog) {
      // The patched fog chunk computes its own haze; this is the stock-fog
      // fallback for shaders that do not carry the atmosphere uniforms.
      this.scene.fog.color.setRGB(st.hazeAway.r, st.hazeAway.g, st.hazeAway.b)
      this.scene.fog.near = Math.max(120, 2600 * (1 - this.rain * 0.72))
      this.scene.fog.far = Math.max(900, st.fogFar)
    }
    this.renderer.toneMappingExposure = st.exposure

    if (this.rainMaterial) {
      const ambient = Math.max(0.05, st.horizon.g * 0.9 + st.practicals * 0.12)
      this.rainMaterial.color.setRGB(
        Math.min(1, ambient * 1.05 + st.practicals * 0.08),
        Math.min(1, ambient),
        Math.min(1, ambient * 1.08),
      )
      this.rainMaterial.opacity = 0.3 + (1 - st.night) * 0.12
    }

    this.stats.hour = +this.hour.toFixed(2)
    this.stats.wet = +(this.rain).toFixed(2)
    this.stats.clouds = Math.round(this.cover * 100)
    if (Math.abs(this.rain - this._appliedWetRain) > 1e-3) {
      this._appliedWetRain = this.rain
      this._applyWetness()
    }
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
    // The deck drifts with the wind; a frozen capture has dt = 0.
    atmosphere.cloudOffset.x -= this.wind.x * CLOUD_WIND_SCALE * dt
    atmosphere.cloudOffset.y -= -this.wind.y * CLOUD_WIND_SCALE * dt
    this._placeKeyLight(camera)
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

  // The shadow map follows the camera, texel-snapped so it does not swim.
  _placeKeyLight(camera) {
    const sun = this.lights?.sun
    if (!sun || !sun.castShadow || !this.shadowPreset) return
    placeShadowCamera(sun, camera, this._keyDir, this.groundY + 0.4,
      this.shadowPreset)
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
