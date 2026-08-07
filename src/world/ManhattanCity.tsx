import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import {
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh'
import { manhattanCollision } from './manhattan-collision'
import { getBuildingNightMaterial, getRoadNightMaterial, isCityNightMaterial } from './night-materials'
import { QUALITY, type QualityPreset } from './palette'
import { rt } from '../gameplay/runtime'
import { City } from '../city/city.js'
import { FacadeMaterial } from '../city/facade.js'
import { TileStreamer } from '../city/streamer.js'
import { LodLayer } from '../city/lod.js'
import { StaticProps } from '../city/props.js'
import { Demand } from '../city/demand.js'
import { Traffic } from '../city/traffic.js'
import { Weather } from '../city/weather.js'
import { Crowd } from '../city/pedestrians.js'
import { Subway } from '../city/subway.js'
import { Interiors } from '../city/interiors.js'
import { HQ } from '../city/hq.js'
import { Doors } from '../city/doors.js'
import { buildSky } from '../city/sky.js'
import { cityWorld } from '../city/registry.js'
import { cityHud } from '../city/city-hud.js'

// three-mesh-bvh extends BufferGeometry/Mesh only when asked; wire it up once.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree

let sharedLoader: GLTFLoader | null = null

function getGLTFLoader(): GLTFLoader {
  if (!sharedLoader) {
    const draco = new DRACOLoader()
    // Serve decoders locally — the external gstatic CDN often fails with
    // "Failed to fetch" in restricted networks or on slow connections.
    draco.setDecoderPath('/draco/')
    draco.preload()
    sharedLoader = new GLTFLoader()
    sharedLoader.setDRACOLoader(draco)
  }
  return sharedLoader
}

/** The ported facade material is shared across every tile; disposal must skip it. */
function isSharedCityMaterial(material: THREE.Material): boolean {
  return material.userData.cityShared === true || isCityNightMaterial(material)
}

function disposeGroup(root: THREE.Group) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      if (obj.geometry.boundsTree) obj.geometry.disposeBoundsTree()
      obj.geometry.dispose()
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of materials) {
        if (!isSharedCityMaterial(m)) m.dispose()
      }
    }
  })
  root.removeFromParent()
  root.clear()
}

/**
 * The one city, running the ported Phase 2 reference engine:
 *
 *   tile streaming with the facade shader on the BLD_* meshes (procedural
 *   windows, storefronts, roofs — the look the evidence shots were taken on),
 *   a separate street-tile streamer for kerbs and paint, far LOD tiers,
 *   street furniture, the LION traffic sim, the sidewalk crowd, and a
 *   full weather system (sun, fog, clouds, rain) driven by the game clock.
 *
 * Collision and navigation still run through manhattanCollision: the base's
 * LAND_* islands answer ground-height raycasts, and each streamed BLD_* mesh
 * gets a BVH for the walk sweeps, exactly like the old tile loader.
 */
function prepareFallbackMaterials(root: THREE.Group, quality: QualityPreset) {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    obj.castShadow = false
    obj.receiveShadow = true
    const hasColor = !!obj.geometry.attributes.color
    const mat = obj.material as THREE.Material
    const hasTexture =
      mat instanceof THREE.MeshStandardMaterial ||
      mat instanceof THREE.MeshPhysicalMaterial
        ? !!(mat as { map?: THREE.Texture }).map ||
          !!(mat as { normalMap?: THREE.Texture }).normalMap ||
          !!(mat as { roughnessMap?: THREE.Texture }).roughnessMap ||
          !!(mat as { emissiveMap?: THREE.Texture }).emissiveMap
        : false
    if (hasTexture) return
    const name = obj.name.toUpperCase()
    if (name.startsWith('BLD_') && obj.geometry.attributes._bid) {
      obj.material = getBuildingNightMaterial({ quality })
      return
    }
    if (name.startsWith('ROAD_')) {
      obj.material = getRoadNightMaterial({ quality })
      return
    }
    obj.material = new THREE.MeshStandardMaterial({
      vertexColors: hasColor,
      color: hasColor ? 0xffffff : 0x8a8f96,
      roughness: 0.78,
      metalness: 0.08,
    })
  })
}

interface PipelineHooks {
  onBaseRegistered?: (root: THREE.Group) => void
  onTileRegistered?: (url: string, root: THREE.Group) => void
}

/**
 * The ported life-engine pipeline. Owns the streamers, the sims and the
 * weather; updated once per frame from the ManhattanCity frame loop.
 */
class CityPipeline {
  private readonly scene: THREE.Scene
  private readonly groupRoot: THREE.Group
  private readonly quality: QualityPreset
  private readonly hooks: PipelineHooks
  private readonly facade: FacadeMaterial
  private readonly streamer: TileStreamer
  private readonly streets: TileStreamer
  private readonly lod: LodLayer
  private readonly props: StaticProps
  private readonly demand: Demand
  private readonly traffic: Traffic
  private readonly weather: Weather
  private readonly crowd: Crowd
  private readonly subway: Subway
  private readonly interiors: Interiors
  private readonly hq: HQ
  private readonly doors: Doors
  private readonly lights: ReturnType<typeof buildSky>
  private readonly sun: THREE.DirectionalLight | null
  private readonly processed = new Set<string>()
  private readonly roots = new Map<string, THREE.Group>()
  /** Walkable surface meshes registered per tile, so unloading undoes them. */
  private readonly groundByTile = new Map<string, THREE.Mesh[]>()
  /** Placed room groups, so dispose can undo their collision registration. */
  private readonly interiorGroups: THREE.Group[] = []
  private doorsBound = false
  private baseDone = false
  private hudTimer = 0
  private lastNight = -1
  private disposed = false

  constructor(
    group: THREE.Group,
    scene: THREE.Scene,
    gl: THREE.WebGLRenderer,
    quality: QualityPreset,
    hooks: PipelineHooks,
  ) {
    this.scene = scene
    this.groupRoot = group
    this.quality = quality
    this.hooks = hooks

    this.facade = new FacadeMaterial(cityWorld.city)
    this.facade.material.userData.cityShared = true
    this.streamer = new TileStreamer(group, cityWorld.city!.meta, this.facade.material)
    this.streets = new TileStreamer(group, cityWorld.city!.meta, null, 'streets')
    this.lod = new LodLayer(group)
    this.props = new StaticProps(group, cityWorld.city)
    this.demand = new Demand()
    this.traffic = new Traffic(group, cityWorld.city, this.demand)
    this.crowd = new Crowd(group, cityWorld.city, this.demand)
    this.subway = new Subway(group, cityWorld.city)
    // Interiors, the HQ and the Phase 3B doorways. These place themselves into
    // the scene at real world coordinates rather than into the city group, so
    // they take `scene` — the group is only a convenience parent for the
    // streamed tiles.
    this.interiors = new Interiors(scene, cityWorld.city)
    this.hq = new HQ(scene, cityWorld.city, this.interiors, this.facade)
    // No hero corridor in the game: it is a scripted camera tour that belonged
    // to the authoring app. Doors treats it as optional (`this.corridor?.`),
    // and without it a lift link falls back to the interiors' own transition.
    this.doors = new Doors(scene, cityWorld.city, this.interiors, this.hq, null, this.streamer)
    // A wall cut rebuilds a tile mesh's buffers; the BVH indexed at tile-load
    // has to follow or the doorway is a hole you cannot walk through. Measured
    // both ways by scripts/qa/doorcheck.mjs: with the hook, 0 of 15 probe rays
    // meet anything at all four doorways; with `--no-bvh-refresh`, 15 of 15,
    // and two of the three walks stop dead in an empty opening.
    //
    // The escape hatch is dev-only on purpose. It exists so that control run
    // stays reproducible, not so a build can ship without collision.
    if (!(import.meta.env.DEV && new URLSearchParams(location.search).has('noBvhRefresh'))) {
      this.doors.onGeometryChanged = (mesh: THREE.Mesh) => manhattanCollision.refreshMesh(mesh)
    }

    const lights = buildSky(scene, gl)
    this.lights = lights
    this.sun = lights.sun
    this.weather = new Weather(scene, gl, lights, cityWorld.city)

    cityWorld.facade = this.facade
    cityWorld.weather = this.weather
    cityWorld.lights = lights
    cityWorld.streamer = this.streamer
    cityWorld.streets = this.streets
    cityWorld.lod = this.lod
    cityWorld.props = this.props
    cityWorld.traffic = this.traffic
    cityWorld.crowd = this.crowd
    cityWorld.subway = this.subway
    cityWorld.interiors = this.interiors
    cityWorld.hq = this.hq
    cityWorld.doors = this.doors
    cityWorld.demand = this.demand
    // The reference app exposed the same handle for live inspection; the
    // visual-QA runner and the debugger read stats and geometry through it.
    ;(window as unknown as { __cityWorld: typeof cityWorld }).__cityWorld = cityWorld
    ;(window as unknown as { __manhattanCollision: typeof manhattanCollision }).__manhattanCollision = manhattanCollision
    ;(window as unknown as { THREE: typeof THREE }).THREE = THREE
  }

  async boot(): Promise<void> {
    if (this.disposed) return
    const { streamer, streets, lod, props, demand, traffic, weather, crowd } = this

    // Far tiers first: a tile that is about to be covered by L2 should never
    // briefly render at full detail on the way in.
    await lod.load()
    if (this.disposed) return

    await props.load()
    if (this.disposed) return

    await demand.load()
    if (this.disposed) return

    await traffic.load()
    if (this.disposed) return

    await weather.load()
    if (this.disposed) return
    weather.bindSurfaces(streamer, streets)

    await crowd.load()
    if (this.disposed) return

    // Station kiosks, and the footfall that thickens the crowd around them.
    await this.subway.load()
    if (this.disposed) return
    demand.setSubway(this.subway)

    // Rooms, the HQ tower, then the doorways that cut into them. Order is
    // load-bearing: HQ registers two more rooms with interiors, linkRooms
    // resolves the lift thresholds between them by key, and doors resolves
    // each entry against a room that must already exist — an entrance with no
    // interior behind it is left as a closed door rather than a hole into a
    // solid building.
    await this.interiors.load()
    if (this.disposed) return
    await this.hq.load()
    if (this.disposed) return
    this.interiors.linkRooms()
    await this.doors.load()
    if (this.disposed) return
    // Only now: a wall cut can rotate a room onto a clear frontage, and the
    // BVH bakes the room's world matrix.
    for (const room of this.interiors.rooms) {
      manhattanCollision.registerInterior(room.group)
      this.interiorGroups.push(room.group)
    }

    this._rigSun()
    this.weather.setTime(rt.clock.hour)
    this.weather.setRain(rt.clock.weather.rain)
    cityWorld.ready = true
    console.info(
      '[city]', cityWorld.city?.count, 'buildings,',
      streamer.tileCount, 'tiles,',
      traffic.stats.lanes, 'lanes,',
      crowd.stats.lanes, 'walk lanes,',
      props.stats.total, 'props,',
      this.subway.stats.total, 'subway entrances,',
      this.interiors.stats.rooms, 'rooms,',
      this.doors.stats.doors, 'doorways',
    )
  }

  /** Character shadows follow the player: the sun is re-anchored each frame. */
  private _rigSun(): void {
    const sun = this.sun
    if (!sun) return
    const q = QUALITY[this.quality]
    sun.castShadow = q.shadows
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize)
    const sc = sun.shadow.camera
    sc.near = 11000
    sc.far = 13000
    sc.left = -240
    sc.right = 240
    sc.top = 240
    sc.bottom = -240
    sc.updateProjectionMatrix()
    sun.shadow.bias = -0.0006
    this.scene.add(sun.target)
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.disposed) return
    const { streamer, streets, lod, props, traffic, crowd, weather } = this
    // Deterministic captures freeze the life sims (traffic, crowd, weather)
    // like pause does, so repeated captures of a scene are identical. The
    // streamers keep running — they converge to the same loaded set.
    if (rt.paused || rt.captureFrozen) dt = 0

    const st = streamer.update(camera)
    const sst = streets.update(camera)
    void sst
    this._processTiles(streamer, false)
    this._processTiles(streets, true)
    lod.update(camera, streamer)
    props.update(camera)
    this.subway.update(camera)
    traffic.update(dt, camera)
    crowd.update(dt, camera)
    weather.update(dt, camera)
    this._interiors(dt, camera)
    this._syncWeather(camera)
    this._hud(dt, camera)
    void st
  }

  // ---- tile lifecycle ------------------------------------------------

  private _processTiles(streamer: TileStreamer, isStreets: boolean): void {
    for (const [file, t] of streamer.tiles) {
      if (t.always && t.state === 'ready' && !this.baseDone) {
        this.baseDone = true
        this._registerBase(t.group)
        continue
      }
      if (t.state === 'ready' && !this.processed.has(file)) {
        this.processed.add(file)
        this._onTileReady(t.group, isStreets, file)
      } else if (t.state !== 'ready' && this.processed.has(file)) {
        this.processed.delete(file)
        const prev = this.roots.get(file)
        if (prev) {
          this.roots.delete(file)
          manhattanCollision.unregisterTileBuildings(prev)
          disposeGroup(prev)
        }
        const grounds = this.groundByTile.get(file)
        if (grounds) {
          this.groundByTile.delete(file)
          for (const mesh of grounds) manhattanCollision.unregisterGround(mesh)
        }
      }
    }
  }

  private _registerBase(root: THREE.Group | null): void {
    if (!root) return
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      if (obj.name.toUpperCase().startsWith('LAND_')) {
        if (!obj.geometry.boundsTree) obj.geometry.computeBoundsTree()
        manhattanCollision.registerGround(obj)
        obj.receiveShadow = true
      }
    })
    manhattanCollision.baseReady = true
    this.hooks.onBaseRegistered?.(root)
  }

  private _registerGround(name: string, obj: THREE.Mesh, file: string): void {
    if (!/^(SIDEWALK_|ROAD_|PARK_)/.test(name)) return
    if (!obj.geometry.boundsTree) obj.geometry.computeBoundsTree()
    manhattanCollision.registerGround(obj)
    let list = this.groundByTile.get(file)
    if (!list) {
      list = []
      this.groundByTile.set(file, list)
    }
    list.push(obj)
  }

  private _onTileReady(root: THREE.Group | null, isStreets: boolean, file: string): void {
    if (!root) return
    if (isStreets) {
      // The street layer is pavement, kerbs and paint: it never carries
      // buildings, so nothing enters the building index. It does receive the
      // character's shadow, and its SIDEWALK_/ROAD_ surfaces answer ground
      // height probes — the base LAND mesh is too coarse to walk on alone.
      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return
        obj.receiveShadow = true
        this._registerGround(obj.name.toUpperCase(), obj, file)
      })
      return
    }
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      const name = obj.name.toUpperCase()
      if (name.startsWith('ROAD_')) {
        obj.material = getRoadNightMaterial({ quality: this.quality })
        obj.receiveShadow = true
      }
      this._registerGround(name, obj, file)
    })
    manhattanCollision.registerTileBuildings(root)
    this.roots.set(file, root)
    this.hooks.onTileRegistered?.(file, root)
  }

  // ---- interiors + doorways -------------------------------------------

  /**
   * Drive the room state and the doorways off the live camera.
   *
   * Doors has its own `paused` flag wired to page visibility; the game's pause
   * is a separate thing (the menu is open, the world is frozen) and has to
   * reach it too, or a door left mid-swing keeps swinging behind the menu.
   */
  private _interiors(dt: number, camera: THREE.Camera): void {
    if (!this.interiors.ready) return
    if (!this.doorsBound) {
      this.doorsBound = true
      // No walk controller to hand over: the game resolves movement through
      // manhattanCollision, not through a raycast controls object. Doors only
      // uses `controls` for the scripted lift ride, which needs the corridor.
      this.doors.bind(camera, null)
    }
    this.doors.paused = rt.paused || document.hidden
    this.interiors.update(camera)
    this.doors.update(dt, camera)
  }

  // ---- weather + clock bridge ----------------------------------------

  private _syncWeather(camera: THREE.Camera): void {
    const { weather, facade, sun } = this
    const hour = rt.clock.hour
    if (Math.abs(weather.hour - hour) > 1e-4) weather.setTime(hour)
    const rain = rt.clock.weather.rain
    if (Math.abs(weather.rain - rain) > 1e-3) weather.setRain(rain)

    // Facade night windows follow the same shoulders as the city-night
    // shader: lit between dusk and dawn, fading across the transition bands.
    const night =
      1 - smoothstep(5.5, 8, hour) + smoothstep(18, 21, hour)
    if (Math.abs(night - this.lastNight) > 1e-3) {
      this.lastNight = night
      facade.setNight(night)
    }

    if (sun && sun.castShadow) {
      const dir = sun.position.clone().normalize()
      sun.position.copy(camera.position).addScaledVector(dir, 12000)
      sun.target.position.copy(camera.position)
      sun.target.updateMatrixWorld()
    }
  }

  // ---- HUD ------------------------------------------------------------

  private _hud(dt: number, camera: THREE.Camera): void {
    this.hudTimer += dt
    if (this.hudTimer < 0.5) return
    this.hudTimer = 0

    const { streamer, streets, lod, traffic, crowd, props, weather } = this
    const city = cityWorld.city
    if (!city) return
    const hour = rt.clock.hour
    cityHud.tiles =
      `${streamer.stats.resident}/${streamer.tileCount}` +
      (streamer.stats.loading ? ` +${streamer.stats.loading}` : '') +
      `  st ${streets.stats.resident}/${streets.tileCount}`
    cityHud.lod =
      `${lod.stats.full} full · ${lod.stats.L2} L2 · ` +
      `${lod.stats.L3} L3 · ${lod.stats.L4} L4`
    cityHud.cars = `${traffic.stats.vehicles} / ${traffic.stats.simLanes} lanes`
    cityHud.peds =
      `${crowd.stats.people}` +
      (crowd.stats.demand != null ? `  (busy ${crowd.stats.demand.toFixed(2)})` : '')
    cityHud.props = props.stats.drawn
    cityHud.sky =
      `${String(Math.floor(hour)).padStart(2, '0')}:` +
      `${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}` +
      `  cloud ${weather.cover.toFixed(2)}  rain ${weather.rain.toFixed(2)}`
    const i = city.nearest(camera.position.x, camera.position.z, 900)
    cityHud.where = i >= 0 ? city.district(i) : 'off-island'
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    cityWorld.ready = false

    for (const streamer of [this.streamer, this.streets]) {
      for (const t of streamer.tiles.values()) {
        if (t.state !== 'ready' || !t.group) continue
        if (!t.always) manhattanCollision.unregisterTileBuildings(t.group)
        disposeGroup(t.group)
      }
    }
    // The street grounds are registered per tile; undo them all, then drop
    // every collision record so a remount starts from a clean index.
    for (const grounds of this.groundByTile.values()) {
      for (const mesh of grounds) manhattanCollision.unregisterGround(mesh)
    }
    this.groundByTile.clear()
    // Rooms and the HQ live on the scene, not the city group, so the group
    // teardown below never reaches them.
    for (const group of this.interiorGroups) {
      manhattanCollision.unregisterTileBuildings(group)
      disposeGroup(group)
    }
    this.interiorGroups.length = 0
    if (this.hq.tower) disposeGroup(this.hq.tower as THREE.Group)
    this.scene.remove(this.interiors.lamp)
    this.interiors.material.dispose()
    this.interiors.glassMaterial.dispose()
    manhattanCollision.clearBase()
    for (const t of this.lod.tiles.values()) {
      for (const tier of ['L2', 'L3', 'L4'] as const) {
        const g = (t.groups as Record<string, THREE.Group | undefined> | undefined)?.[tier]
        if (g) disposeGroup(g)
      }
    }
    // Instanced life layers (props, fleet, crowd, subway kiosks, rain,
    // clouds) are all named children of the city group or the scene; the
    // sims hold them in Maps, so clear by name.
    for (const name of ['PROPS_', 'FLEET_', 'CROWD_', 'SUBWAY_', 'WEATHER_']) {
      const roots = name === 'WEATHER_' ? [this.scene] : [this.scene, this.groupRoot]
      for (const root of roots) {
        for (let i = root.children.length - 1; i >= 0; i--) {
          const child = root.children[i]
          if (child.name.startsWith(name)) {
            root.remove(child)
            child.traverse((o) => {
              if (o instanceof THREE.Mesh) {
                if (o.geometry.boundsTree) o.geometry.disposeBoundsTree()
                o.geometry.dispose()
                if (!isSharedCityMaterial(o.material)) o.material.dispose()
              }
            })
          }
        }
      }
    }
    if (this.lights) this.scene.remove(this.lights.sun.target)
    this.facade.dispose()
    this.streamer.plainMaterial.dispose()
    this.streamer.fallbackMaterial.dispose()
    this.streets.plainMaterial.dispose()
    this.streets.fallbackMaterial.dispose()
    if (this.scene.fog) this.scene.fog = null
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function ManhattanCity({
  mode = 'full',
  position = [0, 0, 0],
  scale = 1,
  quality = 'medium',
  onBaseRegistered,
  onTileRegistered,
}: {
  mode?: 'full' | 'tiles'
  position?: [number, number, number]
  scale?: number
  quality?: QualityPreset
  onBaseRegistered?: (root: THREE.Group) => void
  onTileRegistered?: (url: string, root: THREE.Group) => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const pipelineRef = useRef<CityPipeline | null>(null)
  const qualityRef = useRef(quality)
  qualityRef.current = quality
  const onBase = useRef(onBaseRegistered)
  const onTile = useRef(onTileRegistered)
  onBase.current = onBaseRegistered
  onTile.current = onTileRegistered
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  // Full mode: a single combined GLB. Simple, and the safest fallback when
  // tile streaming misbehaves in an unexpected browser.
  useEffect(() => {
    if (mode !== 'full') return
    const group = groupRef.current
    if (!group) return

    const loader = getGLTFLoader()
    loader.load(
      '/models/manhattan/manhattan_world.glb',
      (gltf) => {
        if (!groupRef.current) return
        prepareFallbackMaterials(gltf.scene, qualityRef.current)
        groupRef.current.add(gltf.scene)
      },
      undefined,
      (err) => console.warn('[ManhattanCity] Failed to load manhattan_world.glb:', err),
    )

    return () => {
      group.clear()
    }
  }, [mode])

  // Tiles mode: the full city-life pipeline.
  useEffect(() => {
    if (mode !== 'tiles') return
    const group = groupRef.current
    if (!group) return
    let cancelled = false

    const boot = async (): Promise<void> => {
      try {
        const city = await City.load()
        if (cancelled) return
        cityWorld.city = city

        const pipeline = new CityPipeline(group, scene, gl, qualityRef.current, {
          onBaseRegistered: (root) => onBase.current?.(root),
          onTileRegistered: (url, root) => onTile.current?.(url, root),
        })
        if (cancelled) {
          pipeline.dispose()
          return
        }
        pipelineRef.current = pipeline
        await pipeline.boot()
      } catch (err) {
        if (!cancelled) console.error('[ManhattanCity] city pipeline failed:', err)
      }
    }
    void boot()

    return () => {
      cancelled = true
      pipelineRef.current?.dispose()
      pipelineRef.current = null
    }
  }, [mode, gl, scene])

  useFrame((state, rawDt) => {
    if (mode !== 'tiles') return
    const pipeline = pipelineRef.current
    if (!pipeline) return
    pipeline.update(Math.min(rawDt, 1 / 20), state.camera)
  })

  return <group ref={groupRef} position={position} scale={scale} name="manhattan-city" />
}
