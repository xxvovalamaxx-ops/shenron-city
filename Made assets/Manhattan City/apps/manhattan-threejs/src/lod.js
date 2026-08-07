// lod.js — the far tiers of the building ladder.
//
// Until this landed the runtime had one detail level and a 30 km streaming
// radius, which on a 21 km island means every tile is resident from anywhere:
// 180 MB of full-detail geometry, permanently, with the word "streaming" doing
// no work. 56_build_lods.py exports three massing tiers per tile and this
// picks exactly one representation per tile per frame.
//
//   full   0 - 900 m      the tile's own BLD_ meshes, facade shader and all
//   L2   900 - 2600 m     footprint reduced to 10 vertices, extruded
//   L3  2600 - 7000 m     one oriented box per building
//   L4   beyond           only what is 100 m or taller
//
// Exactly one, because the tiers are coincident geometry: two of them on at
// once is z-fighting, none of them is a hole. The bands overlap by HYSTERESIS
// so a camera sitting on a boundary does not thrash between two files.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

export const FULL_R = 900
export const L2_R = 2600
export const L3_R = 7000
const HYSTERESIS = 180       // metres of overlap at each boundary
const MAX_INFLIGHT = 6

const ORDER = ['full', 'L2', 'L3', 'L4']

export class LodLayer {
  constructor(scene) {
    this.scene = scene
    this.manifest = null
    this.tiles = new Map()   // key -> {want, have, groups:{L2,L3,L4}, c, r}
    this.inflight = 0
    this.enabled = true
    this.stats = { full: 0, L2: 0, L3: 0, L4: 0, off: 0, tris: 0, files: 0 }

    const draco = new DRACOLoader()
    draco.setDecoderPath('/draco/')
    this.loader = new GLTFLoader()
    this.loader.setDRACOLoader(draco)

    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true, color: 0xffffff,
    })
  }

  async load(url = '/lod/lod_manifest.json') {
    const m = await fetch(url).then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    if (!m) { console.warn('[lod] no manifest; far tiers disabled'); return this }
    this.manifest = m
    const keys = new Set([
      ...Object.keys(m.L2 || {}), ...Object.keys(m.L3 || {}),
      ...Object.keys(m.L4 || {}),
    ])
    const grid = m.grid_m || 1400
    for (const k of keys) {
      // The key is the tile's grid position, so its extent is exact. The
      // manifest's `c` is the centroid of the buildings inside it, which is
      // not the same thing and is not what a proximity test wants.
      const mm = /^([+-]\d+)_([+-]\d+)$/.exec(k)
      if (!mm) continue
      const tx = parseInt(mm[1], 10)
      const ty = parseInt(mm[2], 10)
      this.tiles.set(k, {
        key: k,
        c: [(tx + 0.5) * grid, (ty + 0.5) * grid],   // local metres
        hx: grid * 0.5,
        hz: grid * 0.5,
        want: null,
        groups: {},               // tier -> THREE.Group
        loading: {},
      })
    }
    this.ready = this.tiles.size > 0
    return this
  }

  // Which tier a tile at distance d should be showing, given what it shows
  // now. The current tier widens its own band, which is what stops a camera
  // parked on a boundary from loading and disposing the same file every frame.
  _tierFor(d, current) {
    const h = (limit, tier) => (current === tier ? limit + HYSTERESIS : limit)
    if (d <= h(FULL_R, 'full')) return 'full'
    if (d <= h(L2_R, 'L2')) return 'L2'
    if (d <= h(L3_R, 'L3')) return 'L3'
    return 'L4'
  }

  // `streamer` is the world TileStreamer: when a tile is showing a far tier,
  // its own building meshes have to be hidden or the two draw on top of one
  // another. Roads, park trees and terrain are left alone at every range —
  // they are not what this replaces.
  update(camera, streamer) {
    if (!this.ready || !this.enabled) return this.stats
    const cx = camera.position.x
    const cz = camera.position.z
    const counts = { full: 0, L2: 0, L3: 0, L4: 0, off: 0 }
    let tris = 0

    for (const t of this.tiles.values()) {
      // Distance to the tile's nearest edge, not to its centre. A 1400 m tile
      // measured from its centre can have its near corner 200 m from the
      // camera while still being called 900 m away, which put flat 10-vertex
      // massing directly across the street.
      const dx = Math.max(0, Math.abs(t.c[0] - cx) - t.hx)
      const dz = Math.max(0, Math.abs(-t.c[1] - cz) - t.hz)
      const d = Math.hypot(dx, dz)
      const tier = this._tierFor(d, t.want)
      if (tier !== t.want) {
        t.want = tier
        this._apply(t)
      } else if (tier !== 'full' && !t.groups[tier] && !t.loading[tier]) {
        // A load skipped for the in-flight cap is only ever retried here.
        // Without this, a tile whose tier never changes again simply stays
        // empty: 16 of 101 far tiles had any geometry at all.
        this._loadTier(t, tier)
      }
      counts[tier]++
      const g = t.groups[tier]
      if (g) tris += g.userData.tris || 0
      if (streamer) streamer.setBuildingsVisible(t.key, tier === 'full')
    }

    Object.assign(this.stats, counts)
    this.stats.tris = tris
    this.stats.files = Object.values(counts).reduce((a, b) => a + b, 0) -
      counts.full
    return this.stats
  }

  _apply(t) {
    for (const tier of ORDER) {
      if (tier === 'full') continue
      const on = tier === t.want
      const g = t.groups[tier]
      if (on) {
        if (g) { g.visible = true } else { this._loadTier(t, tier) }
      } else if (g) {
        g.visible = false
      }
    }
  }

  _loadTier(t, tier) {
    const rec = this.manifest[tier] && this.manifest[tier][t.key]
    if (!rec || t.loading[tier]) return
    if (this.inflight >= MAX_INFLIGHT) return   // retried next frame
    t.loading[tier] = true
    this.inflight++
    this.loader.load(`/lod/${rec.file}`, (gltf) => {
      this.inflight--
      t.loading[tier] = false
      let tris = 0
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return
        o.material = this.material
        const g = o.geometry
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3
      })
      gltf.scene.userData.tris = tris
      gltf.scene.visible = t.want === tier
      t.groups[tier] = gltf.scene
      this.scene.add(gltf.scene)
    }, undefined, (err) => {
      this.inflight--
      t.loading[tier] = false
      console.warn('[lod] failed', rec.file, err)
    })
  }

  // Everything at full detail, for a fair before/after measurement.
  setDisabled(off) {
    this.enabled = !off
    for (const t of this.tiles.values()) {
      for (const tier of ORDER) {
        if (tier !== 'full' && t.groups[tier]) t.groups[tier].visible = false
      }
      if (off) t.want = null
    }
  }
}
