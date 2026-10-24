// props.js — the static street layer: trees, lights, signals, hydrants, bins,
// shelters and newspaper boxes.
//
// Placement is not decided here. 48_build_walk.py already fused the LION
// centrelines with the planimetric sidewalk survey and wrote every instance to
// props.bin, so a hydrant is in the same place on every load and on every
// machine, and none of them stand in the roadway. This module's only job is to
// keep the instances near the camera resident and everything else out of the
// draw call.
//
// The record is 12 bytes:
//   0 f32 x_m | 4 f32 y_m | 8 u8 type | 9 u8 yaw | 10 u8 scale | 11 u8 variant

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { paintMaterial } from './vehicles.js'
import { cityWorld } from './registry.js'
import { TreeField } from '../world/life/tree-field'
import { streetScale, streetSpecies, treeHash } from '../world/life/tree-lod'

// The /models/manhattan/ mount is cached for an hour, and these asset files carry no
// version in their URL the way the world tiles do. In dev that means a rebuilt
// glb silently does not arrive -- which is exactly how P2-021 burned an hour
// on a corrected export that "did nothing". Never cache them in dev.
const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

const REC = 12
const RADIUS = 420          // metres; beyond this a bin is under a pixel
const REBUILD_AT = 35       // rebuild the instance buffers after this much
const CELL = 200            // must match 48_build_walk.py

// prop type -> mesh in props.glb. Trees (type 0) are not drawn from
// props.glb any more: world/life/tree-field.ts grows real ones, picking a
// species from the variant byte (the genus in the forestry data).
const TREE = 0
const MESH_FOR = {
  1: ['PROP_streetlight'],
  2: ['PROP_signal'],
  3: ['PROP_hydrant'],
  4: ['PROP_bin'],
  5: ['PROP_shelter'],
  6: ['PROP_bollard'],
  7: ['PROP_newsbox'],
}

// Stride of one packed tree for TreeField: x, y, z, scale, yaw, tint,
// species, spare.
const TREE_REC = 8
// Manhattan hydrants are mostly a dull aluminium; a minority are painted.
const HYDRANT = [
  0x9aa0a2, 0x9aa0a2, 0x9aa0a2, 0x8e9698, 0xa8471f, 0x93999b,
]

// A prop that costs more than it is worth at range gets dropped first. These
// are radii in metres, not counts, so a dense block does not starve a sparse
// one.
const FAR = {
  PROP_streetlight: 360, PROP_signal: 300, PROP_shelter: 300,
  PROP_hydrant: 150, PROP_bin: 160, PROP_bollard: 140, PROP_newsbox: 140,
}

export class StaticProps {
  constructor(scene, city) {
    this.scene = scene
    this.groundY = (city?.meta?.land_level_m ?? 12.0) + 0.20  // pavement top
    this.material = paintMaterial()
    this.meshes = new Map()      // mesh name -> InstancedMesh
    this.records = null          // DataView over props.bin
    this.count = 0
    this.meta = null
    this.last = new THREE.Vector3(1e9, 1e9, 1e9)
    this.stats = { total: 0, drawn: 0, types: 0, trees: 0 }
    this.enabled = true
    this.trees = new TreeField(scene)
    this._treeClock = 0
  }

  async load(metaUrl = '/models/manhattan/props/props.json', binUrl = '/models/manhattan/props/props.bin',
             glbUrl = '/models/manhattan/props.glb') {
    const meta = await fetch(metaUrl).then((r) => (r.ok ? r.json() : null))
    if (!meta) { console.warn('[props] no props.json'); return this }
    const buf = await fetch(binUrl).then((r) => r.arrayBuffer())
    this.meta = meta
    this.records = new DataView(buf)
    this.count = Math.floor(buf.byteLength / REC)
    if (this.count !== meta.count) {
      console.warn('[props] bin/meta disagree', this.count, meta.count)
    }

    const gltf = await new GLTFLoader().loadAsync(glbUrl + bust())
    const src = new Map()
    gltf.scene.traverse((o) => {
      // the blob trees in props.glb are superseded by TreeField
      if (o.isMesh && !o.name.startsWith('PROP_tree_')) src.set(o.name, o)
    })

    // Capacity per mesh from what is actually in the file within one radius.
    // Guessing high wastes tens of megabytes on 54,000 trees; guessing low
    // silently drops half the street.
    const cap = this._capacities()
    for (const [name, mesh] of src) {
      const n = Math.max(16, Math.min(6000, Math.round((cap.get(name) || 0))))
      const im = new THREE.InstancedMesh(mesh.geometry, this.material, n)
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      im.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(n * 3).fill(1), 3)
      im.count = 0
      im.name = `PROPS_${name}`
      im.frustumCulled = false
      im.castShadow = false
      this.meshes.set(name, im)
      this.scene.add(im)
    }
    this.stats.total = this.count
    this.stats.types = this.meshes.size

    // Street trees and the park forest.
    await this.trees.load()
    this.trees.setSource('street', this._streetTrees())
    this.trees.attachStreamer(cityWorld.streamer)
    // The records DataView is live from the bin fetch, but between that and
    // the GLB meshes existing there is a window where update() runs, caches
    // the camera position and draws nothing — leaving the throttle to skip
    // every later rebuild while the camera is still. Invalidate it so the
    // first update after load really rebuilds.
    this.last.set(1e9, 1e9, 1e9)
    return this
  }

  // Worst case within one radius, measured off the real placement rather than
  // assumed: walk the cell index, sum the densest disc for each type.
  _capacities() {
    const byType = new Map()
    for (let i = 0; i < this.count; i++) {
      const t = this.records.getUint8(i * REC + 8)
      const v = this.records.getUint8(i * REC + 11)
      const name = this._meshName(t, v)
      byType.set(name, (byType.get(name) || 0) + 1)
    }
    // Manhattan is 59 km2; one 420 m disc is 0.55 km2, and the densest blocks
    // run about 4x the mean. Head room of 4.5x on the areal share, clamped.
    const out = new Map()
    const share = (Math.PI * RADIUS * RADIUS) / 59e6
    for (const [name, n] of byType) {
      out.set(name, Math.max(24, Math.ceil(n * share * 4.5)))
    }
    return out
  }

  // Every type-0 record packed for TreeField. The species comes from the
  // forestry variant byte, the size from the scale byte, and a per-tree hash
  // turns the canopy tint so a block of planes is not a row of clones.
  _streetTrees() {
    let n = 0
    for (let i = 0; i < this.count; i++) {
      if (this.records.getUint8(i * REC + 8) === TREE) n++
    }
    const out = new Float32Array(n * TREE_REC)
    let k = 0
    for (let i = 0; i < this.count; i++) {
      const o = i * REC
      if (this.records.getUint8(o + 8) !== TREE) continue
      const x = this.records.getFloat32(o, true)
      const y = this.records.getFloat32(o + 4, true)
      const variant = this.records.getUint8(o + 11)
      const h = treeHash(i * 7 + 3)
      out[k] = x
      out[k + 1] = this.groundY
      out[k + 2] = -y
      out[k + 3] = streetScale(this.records.getUint8(o + 10))
      out[k + 4] = (this.records.getUint8(o + 9) / 255) * Math.PI * 2
      out[k + 5] = (h % 2000) / 1000 - 1
      out[k + 6] = this.trees.speciesIndex(streetSpecies(variant, i))
      k += TREE_REC
    }
    this.stats.trees = n
    return out
  }

  _meshName(type, variant) {
    const list = MESH_FOR[type]
    if (!list) return null
    return list[Math.min(list.length - 1, variant)] || list[0]
  }

  update(camera, force = false) {
    if (!this.enabled || !this.records) return this.stats
    const now = performance.now() / 1000
    const dt = this._treeClock ? Math.min(0.1, now - this._treeClock) : 0
    this._treeClock = now
    this.trees.update(camera, dt)
    if (!force && camera.position.distanceTo(this.last) < REBUILD_AT) {
      return this.stats
    }
    this.last.copy(camera.position)

    const camX = camera.position.x
    const camY = -camera.position.z
    for (const m of this.meshes.values()) m.count = 0

    const dummy = new THREE.Object3D()
    const col = new THREE.Color()
    const r = Math.ceil(RADIUS / CELL)
    const cx = Math.floor(camX / CELL)
    const cy = Math.floor(camY / CELL)
    const cells = this.meta.cells

    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const slot = cells[`${cx + dx},${cy + dy}`]
        if (!slot) continue
        const [start, n] = slot
        for (let i = start; i < start + n; i++) {
          const o = i * REC
          const x = this.records.getFloat32(o, true)
          const y = this.records.getFloat32(o + 4, true)
          const d = Math.hypot(x - camX, y - camY)
          if (d > RADIUS) continue

          const type = this.records.getUint8(o + 8)
          const variant = this.records.getUint8(o + 11)
          const name = this._meshName(type, variant)
          const mesh = this.meshes.get(name)
          if (!mesh || d > (FAR[name] || RADIUS)) continue
          if (mesh.count >= mesh.instanceMatrix.count) continue

          const yaw = (this.records.getUint8(o + 9) / 255) * Math.PI * 2
          const scale = this.records.getUint8(o + 10) * 0.02

          dummy.position.set(x, this.groundY, -y)
          dummy.rotation.set(0, yaw, 0)
          dummy.scale.setScalar(scale)
          dummy.updateMatrix()
          const ix = mesh.count++
          mesh.setMatrixAt(ix, dummy.matrix)

          if (type === 3) {
            col.setHex(HYDRANT[i % HYDRANT.length])
          } else {
            col.setRGB(1, 1, 1)
          }
          mesh.setColorAt(ix, col)
        }
      }
    }

    let drawn = 0
    for (const m of this.meshes.values()) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      drawn += m.count
    }
    this.stats.drawn = drawn
    return this.stats
  }

  pickables() {
    return [...this.meshes.values()]
  }

  dispose() {
    this.trees.dispose()
  }

  // How much of each type was dropped for want of capacity, so a starved
  // street shows up as a number instead of as a vaguely empty pavement.
  get saturation() {
    const out = {}
    for (const [name, m] of this.meshes) {
      out[name] = `${m.count}/${m.instanceMatrix.count}`
    }
    return out
  }
}
