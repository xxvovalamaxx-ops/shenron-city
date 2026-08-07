// streamer.js — distance-prioritised tile streaming.
//
// The world ships as 1400 m glb tiles (Phase 1 export, Draco compressed).
// This keeps a working set resident: tiles are requested nearest-first, a few
// at a time, and disposed once the camera is well past them.
//
// FAR used to be 30 km, which on a 21 km island meant every tile was resident
// from anywhere and nothing streamed at all. Now that 56_build_lods.py exports
// the far tiers, FAR is the band where a tile's own geometry is still worth
// having and lod.js takes over past it. A tile's buildings are hidden — not
// disposed — as soon as a far tier covers them, so the swap costs nothing and
// reverses instantly; roads, park trees and terrain stay on at every range.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

const TILE = 1400 // metres, matches building_index.json tile_size_m
// A little past lod.js's L2 band, so a tile is only disposed once its
// buildings have been handed to the L3 massing and nothing is briefly absent.
const FAR = 3400
const MAX_INFLIGHT = 4

export class TileStreamer {
  // `layer` picks which tile set to stream: "world" is the massing and
  // ground, "streets" is the Phase 2E sidewalk and paint layer. They are
  // separate because a 150 mm kerb carries no information past a few hundred
  // metres, while the skyline has to be visible across the island.
  constructor(scene, meta, material = null, layer = 'world') {
    this.scene = scene
    this.meta = meta
    this.layer = layer
    this.injected = material

    const cfg = layer === 'streets' ? meta.street_tiles : meta.tiles
    this.cfg = cfg || { list: [] }
    this.tileSize = this.cfg.size_m || meta.tiles?.size_m || TILE
    this.far = this.cfg.far_m || FAR
    this.unload = this.far * 1.15 + 400

    this.tiles = new Map() // file -> {state, group, cx, cz, bytes}
    // grid key ("+00_-01") -> tile, so lod.js can address a tile by the same
    // key its own files are named with
    this.byKey = new Map()
    // callbacks run after a tile finishes loading and enters the scene; the
    // door system re-cuts a doorway into a tile that (re)loads after boot
    this.onReady = []
    this.inflight = 0
    this.loadedBytes = 0
    this.stats = { resident: 0, loading: 0, queued: 0, tris: 0, bytes: 0 }

    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/')
    this.loader = new GLTFLoader()
    this.loader.setDRACOLoader(draco)

    // Two shared materials for the whole city. Colour arrives in COLOR_0
    // (Blender's "bcol"), so no textures and no per-tile material. Buildings
    // get the facade shader when one is supplied; ground, water, roads and
    // parks stay on the plain one.
    this.plainMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      color: 0xffffff,
    })
    this.fallbackMaterial = new THREE.MeshLambertMaterial({ color: 0x8a8f96 })

    for (const t of this.cfg.list || []) {
      // tile (tx, ty) covers x_m [tx*S,(tx+1)*S], y_m [ty*S,(ty+1)*S];
      // world z = -y_m, so the world centre flips sign on z
      const s = this.tileSize
      const km = /([+-]\d+_[+-]\d+)\.glb$/.exec(t.file)
      const rec = {
        file: t.file,
        state: 'idle',
        group: null,
        bytes: t.bytes || 0,
        // the base tile holds the landmass and water: no grid position, and
        // it must never unload or the ground disappears
        always: !!t.always,
        // export mtime, appended to the URL so a re-export busts the cache
        v: t.v || 0,
        cx: (t.tx + 0.5) * s,
        cz: -(t.ty + 0.5) * s,
        buildingsVisible: true,
      }
      this.tiles.set(t.file, rec)
      if (km) this.byKey.set(km[1], rec)
    }
  }

  // Show or hide a tile's building meshes without touching its roads, park
  // trees or terrain. Called by lod.js when a far tier takes the tile over;
  // hiding rather than disposing keeps the swap free and instantly reversible.
  setBuildingsVisible(key, on) {
    const t = this.byKey.get(key)
    if (!t || t.buildingsVisible === on) return
    t.buildingsVisible = on
    if (t.state !== 'ready' || !t.group) return
    t.group.traverse((o) => {
      if (o.isMesh && o.userData.building) o.visible = on
    })
  }

  get tileCount() { return this.tiles.size }

  totalBytes() {
    let n = 0
    for (const t of this.tiles.values()) n += t.bytes
    return n
  }

  // Called every frame; cheap because it is O(tiles) over ~120 entries.
  update(camera) {
    const cx = camera.position.x
    const cz = camera.position.z

    const wanted = []
    let resident = 0
    let loading = 0

    for (const t of this.tiles.values()) {
      const d = t.always ? 0 : Math.hypot(t.cx - cx, t.cz - cz)
      t.dist = d

      if (t.state === 'ready') {
        resident++
        if (!t.always && d > this.unload) this._dispose(t)
        continue
      }
      if (t.state === 'loading') { loading++; continue }
      if (t.state === 'error') continue
      if (t.always || d <= this.far) wanted.push(t)
    }

    wanted.sort((a, b) => a.dist - b.dist)
    while (this.inflight < MAX_INFLIGHT && wanted.length) {
      this._load(wanted.shift())
    }

    this.stats.resident = resident
    this.stats.loading = loading
    this.stats.queued = wanted.length
    this.stats.bytes = this.loadedBytes
    return this.stats
  }

  // Load everything within FAR without waiting for frames — used once at boot
  // so the first view is complete rather than visibly filling in.
  async preload(camera, onProgress = () => {}) {
    const list = []
    for (const t of this.tiles.values()) {
      const d = t.always ? 0
        : Math.hypot(t.cx - camera.position.x, t.cz - camera.position.z)
      if (t.always || d <= this.far) { t.dist = d; list.push(t) }
    }
    list.sort((a, b) => a.dist - b.dist)

    let done = 0
    const total = list.length
    const worker = async () => {
      for (;;) {
        const t = list.shift()
        if (!t) return
        await this._loadAsync(t)
        done++
        onProgress(done / total, t.file)
      }
    }
    await Promise.all(
      Array.from({ length: MAX_INFLIGHT }, () => worker()),
    )
  }

  _load(t) {
    this._loadAsync(t)
  }

  _loadAsync(t) {
    if (t.state !== 'idle') return Promise.resolve()
    t.state = 'loading'
    this.inflight++
    return new Promise((resolve) => {
      this.loader.load(
        `/tiles/${t.file}?v=${t.v}`,
        (gltf) => {
          this.inflight--
          // the camera may have moved past it while it was in flight
          if (t.state !== 'loading') { resolve(); return }
          let tris = 0
          gltf.scene.traverse((o) => {
            if (!o.isMesh) return
            const g = o.geometry
            tris += (g.index ? g.index.count : g.attributes.position.count) / 3
            // Only buildings carry _bid, and only buildings should get the
            // facade shader -- roads and water are in the same tile and
            // would otherwise be shaded as rooftops.
            const isBuilding = !!(g.attributes._bid || g.attributes._BID)
            if (isBuilding && this.injected) {
              o.material = this.injected
            } else if (isBuilding) {
              o.material = this.plainMaterial
            }
            // Water, land, roads, parks and bridges keep the material the
            // exporter gave them. Overriding those with a vertex-colour
            // material turned the whole ground plane into flat grey, because
            // they carry no COLOR_0 -- their colour is in the material.
            o.userData.tile = t.file
            o.userData.building = isBuilding
            // a tile can finish loading while a far tier already covers it
            if (isBuilding && !t.buildingsVisible) o.visible = false
          })
          t.group = gltf.scene
          t.tris = tris
          t.state = 'ready'
          this.stats.tris += tris
          this.loadedBytes += t.bytes
          this.scene.add(gltf.scene)
          for (const fn of this.onReady) {
            try { fn(t.file, gltf.scene) } catch (e) {
              console.warn('[stream] onReady hook failed', String(e))
            }
          }
          resolve()
        },
        undefined,
        (err) => {
          this.inflight--
          t.state = 'error'
          t.error = String(err)
          console.warn('[stream] failed', t.file, err)
          resolve()
        },
      )
    })
  }

  _dispose(t) {
    if (!t.group) return
    this.scene.remove(t.group)
    t.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose()
    })
    this.stats.tris -= t.tris || 0
    this.loadedBytes -= t.bytes
    t.group = null
    t.tris = 0
    t.state = 'idle'
  }

  // Meshes a raycaster should test — only what is actually in the scene.
  pickables() {
    const out = []
    for (const t of this.tiles.values()) {
      if (t.state === 'ready' && t.group) out.push(t.group)
    }
    return out
  }
}
