// vehicles.js — the traffic fleet on the GPU.
//
// The fleet draws the Shenron vehicle family (public/models/vehicles/
// vehicles.glb, authored by scripts/blender/vehicles/build_vehicles.py): six
// original, fictional kinds, each in three levels of detail, plus a wheel.
// Every kind and LOD is one InstancedMesh sharing one material (see
// createFleetMaterial in world/vehicles/vehicle-assets.ts): a per-vertex
// `zone` is the paint mask and the lookup for every other material slot, and
// per-instance attributes carry the paint colour and the lamp state (brake,
// headlights, police strobe phase, taxi roof sign). A whole car is one draw
// per kind and LOD; the near LOD adds four spinning wheels.
//
// `paintMaterial()` is the older vertex-colour paint convention, still used
// by the street furniture (props.js): body panels authored white with the
// mask in COLOR_0 alpha are tinted by the instance colour.

import * as THREE from 'three'
import {
  createFleetMaterial,
  currentVehicleQuality,
  loadVehicleAssets,
} from '../world/vehicles/vehicle-assets'
import { paintFor, vehicleSpec } from '../gameplay/vehicles/vehicle-specs'

// NYC-plausible mix. Weights are shares of the moving fleet, not of
// registrations. Taxis are re-weighted by district at spawn time: a third of
// Midtown's traffic is for-hire, far less of Inwood's.
export const FLEET = [
  { key: 'sedan', weight: 0.34, speedScale: 1.0 },
  { key: 'taxi', weight: 0.18, speedScale: 1.05 },
  { key: 'suv', weight: 0.22, speedScale: 0.98 },
  { key: 'van', weight: 0.12, speedScale: 0.9 },
  { key: 'coupe', weight: 0.09, speedScale: 1.08 },
  { key: 'police', weight: 0.05, speedScale: 1.0 },
]

/** Cars within this distance draw the full model with spinning wheels. */
export const LOD0_DISTANCE = 55
/** Cars within this distance draw the mid LOD; beyond, the far LOD. */
export const LOD1_DISTANCE = 170
const LOD0_CAP = 26

const PATCH_VERT = /* glsl */`
varying vec4 vPaint;
`
const PATCH_VERT_BODY = /* glsl */`
vPaint = vec4(1.0);
#ifdef USE_COLOR_ALPHA
  vPaint = color;
#endif
`
const PATCH_FRAG = /* glsl */`
varying vec4 vPaint;
`
// three's color_vertex chunk already multiplies the instance colour into
// vColor, and there is no vInstanceColor varying to read. So: vPaint holds
// the raw COLOR_0 attribute (mask intact), vColor holds it multiplied by the
// instance colour. Body panels are authored white, so vColor *is* the paint;
// everything else takes its own rgb straight from vPaint.
const PATCH_FRAG_BODY = /* glsl */`
{
  diffuseColor.rgb = mix(vPaint.rgb, vColor.rgb, vPaint.a);
  diffuseColor.a = 1.0;
}
`

// The street furniture is authored to this convention: a tree canopy and a
// hydrant barrel are painted white with the mask set, and everything else
// keeps its authored colour.
export function paintMaterial() {
  const m = new THREE.MeshLambertMaterial({
    vertexColors: true,
    color: 0xffffff,
  })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PATCH_VERT}`)
      .replace('#include <color_vertex>',
        `#include <color_vertex>\n${PATCH_VERT_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PATCH_FRAG}`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>\n${PATCH_FRAG_BODY}`)
  }
  m.customProgramCacheKey = () => 'manhattan-vehicle-paint-v1'
  return m
}

const _color = new THREE.Color()

export class VehicleFleet {
  constructor(scene) {
    this.scene = scene
    this.material = null
    this.types = []          // one entry per FLEET row, with its meshes
    this.ready = false
    this.quality = 'medium'
  }

  async load(capacity = 1200) {
    const assets = await loadVehicleAssets()
    this.quality = currentVehicleQuality()
    this.material = createFleetMaterial(this.quality)
    const shadows = this.quality !== 'low'
    for (const spec of FLEET) {
      const asset = assets.kinds.get(spec.key)
      if (!asset) {
        console.warn('[fleet] missing', spec.key)
        continue
      }
      const sim = vehicleSpec(spec.key)
      const cap = Math.max(16, Math.round(capacity * spec.weight * 2.2))
      const lods = [
        this._mesh(asset.fleet.lod0, LOD0_CAP, `FLEET_${spec.key}_lod0`, shadows),
        this._mesh(asset.fleet.lod1, cap, `FLEET_${spec.key}_lod1`, shadows),
        this._mesh(asset.fleet.lod2, cap, `FLEET_${spec.key}_lod2`, false),
      ]
      const wheel = this._mesh(asset.fleetWheel, LOD0_CAP * 4, `FLEET_${spec.key}_wheel`, shadows)
      this.types.push({
        ...spec,
        lods,
        wheel,
        wheels: asset.wheels,
        wheelRadius: asset.wheelRadius,
        capacity: cap,
        // footprint from the gameplay spec, which matches the model
        length: sim.halfLength * 2,
        width: sim.halfWidth * 2,
        halfLength: sim.halfLength,
        halfWidth: sim.halfWidth,
      })
    }
    this.ready = this.types.length > 0
    return this
  }

  _mesh(source, cap, name, castShadow) {
    // Share the vertex data; each mesh owns its per-instance lamp attribute.
    const g = new THREE.BufferGeometry()
    for (const [key, attr] of Object.entries(source.attributes)) g.setAttribute(key, attr)
    g.setIndex(source.index)
    g.boundingSphere = source.boundingSphere
    g.boundingBox = source.boundingBox
    const light = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4)
    light.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('instLight', light)
    const mesh = new THREE.InstancedMesh(g, this.material, cap)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    mesh.name = name
    this.scene.add(mesh)
    return mesh
  }

  // Deterministic per-vehicle paint (sRGB hex), so a car does not change
  // colour when it is recycled into a different slot.
  paintFor(type, seed) {
    return paintFor(type.key, seed | 0)
  }

  // Weighted pick. `taxiBias` 0..1 raises the taxi share (Midtown).
  pick(rand, taxiBias = 0) {
    let total = 0
    for (const t of this.types) total += this._weight(t, taxiBias)
    let r = rand * total
    for (const t of this.types) {
      r -= this._weight(t, taxiBias)
      if (r <= 0) return t
    }
    return this.types[0]
  }

  _weight(t, taxiBias) {
    if (t.key !== 'taxi') return t.weight
    return t.weight * (0.45 + taxiBias * 1.9)
  }

  reset() {
    for (const t of this.types) {
      for (const m of t.lods) m.count = 0
      t.wheel.count = 0
    }
  }

  /**
   * Write one car. `lod` 0..2; falls back to the next LOD when a pool is
   * full. Returns the LOD actually used, or -1 when every pool is full.
   */
  put(type, lod, matrix, paintHex, brake, heads, strobe, sign) {
    let l = lod
    while (l < 3 && type.lods[l].count >= (l === 0 ? LOD0_CAP : type.capacity)) l++
    if (l >= 3) return -1
    const mesh = type.lods[l]
    const i = mesh.count++
    mesh.setMatrixAt(i, matrix)
    mesh.setColorAt(i, _color.setHex(paintHex))
    const light = mesh.geometry.getAttribute('instLight')
    light.setXYZW(i, brake, heads, strobe, sign)
    return l
  }

  putWheel(type, matrix) {
    const mesh = type.wheel
    if (mesh.count >= LOD0_CAP * 4) return
    const i = mesh.count++
    mesh.setMatrixAt(i, matrix)
    mesh.setColorAt(i, _color.setHex(0xffffff))
  }

  flush() {
    for (const t of this.types) {
      for (const m of [...t.lods, t.wheel]) {
        if (m.count === 0) continue
        m.instanceMatrix.needsUpdate = true
        m.instanceMatrix.clearUpdateRanges()
        m.instanceMatrix.addUpdateRange(0, m.count * 16)
        if (m.instanceColor) {
          m.instanceColor.needsUpdate = true
          m.instanceColor.clearUpdateRanges()
          m.instanceColor.addUpdateRange(0, m.count * 3)
        }
        const light = m.geometry.getAttribute('instLight')
        light.needsUpdate = true
        light.clearUpdateRanges()
        light.addUpdateRange(0, m.count * 4)
      }
    }
  }

  get stats() {
    let n = 0
    for (const t of this.types) for (const m of t.lods) n += m.count
    return { drawn: n, types: this.types.length }
  }
}
