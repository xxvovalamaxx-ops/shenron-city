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

// The /tiles/ mount is cached for an hour, and these asset files carry no
// version in their URL the way the world tiles do. In dev that means a rebuilt
// glb silently does not arrive -- which is exactly how P2-021 burned an hour
// on a corrected export that "did nothing". Never cache them in dev.
const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

const REC = 12
const RADIUS = 420          // metres; beyond this a bin is under a pixel
const REBUILD_AT = 35       // rebuild the instance buffers after this much
const CELL = 200            // must match 48_build_walk.py

// prop type -> mesh in props.glb. Trees pick a mesh by their variant byte,
// which came from the genus in the forestry data.
const MESH_FOR = {
  0: ['PROP_tree_broad', 'PROP_tree_column', 'PROP_tree_conifer'],
  1: ['PROP_streetlight'],
  2: ['PROP_signal'],
  3: ['PROP_hydrant'],
  4: ['PROP_bin'],
  5: ['PROP_shelter'],
  6: ['PROP_bollard'],
  7: ['PROP_newsbox'],
}

// Only the meshes authored with the paint mask set read these. Everything else
// keeps its own colour whatever we write here.
const CANOPY = [
  0x2f4a24, 0x35512a, 0x2a4420, 0x3b5730, 0x304a28, 0x40603a, 0x2d4526,
]
// Manhattan hydrants are mostly a dull aluminium; a minority are painted.
const HYDRANT = [
  0x9aa0a2, 0x9aa0a2, 0x9aa0a2, 0x8e9698, 0xa8471f, 0x93999b,
]

// A prop that costs more than it is worth at range gets dropped first. These
// are radii in metres, not counts, so a dense block does not starve a sparse
// one.
const FAR = {
  PROP_tree_broad: 420, PROP_tree_column: 420, PROP_tree_conifer: 420,
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
    this.stats = { total: 0, drawn: 0, types: 0 }
    this.enabled = true
  }

  async load(metaUrl = '/props/props.json', binUrl = '/props/props.bin',
             glbUrl = '/tiles/props.glb') {
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
    gltf.scene.traverse((o) => { if (o.isMesh) src.set(o.name, o) })

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

  _meshName(type, variant) {
    const list = MESH_FOR[type]
    if (!list) return null
    return list[Math.min(list.length - 1, variant)] || list[0]
  }

  update(camera, force = false) {
    if (!this.enabled || !this.records) return this.stats
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

          if (type === 0) {
            col.setHex(CANOPY[(i * 7 + variant) % CANOPY.length])
          } else if (type === 3) {
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
