// vehicles.js — loads the procedural fleet and renders it as instanced meshes.
//
// One InstancedMesh per body type, with per-instance colour. The paint mask
// lives in COLOR_0's alpha (see scripts/phase2/52_vehicles.py):
//
//     a = 1   body panel  -> tinted by the instance colour
//     a = 0   glass, tyre, lamp, trim -> keeps its own rgb
//
// Without that mask, instance colour would turn the windscreen and the tyres
// yellow along with the cab.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// NYC-plausible mix. Weights are shares of the moving fleet, not of
// registrations: a third of Manhattan's midday traffic is for-hire.
// The /models/manhattan/ mount is cached for an hour, and these asset files carry no
// version in their URL the way the world tiles do. In dev that means a rebuilt
// glb silently does not arrive -- which is exactly how P2-021 burned an hour
// on a corrected export that "did nothing". Never cache them in dev.
const bust = () => (import.meta.env && import.meta.env.DEV
  ? `?v=${Date.now()}` : '')

export const FLEET = [
  { name: 'VEH_sedan', key: 'sedan', weight: 0.30, speedScale: 1.00 },
  { name: 'VEH_sedan', key: 'taxi', weight: 0.22, speedScale: 1.05,
    color: 0xf2b736, fixedColor: true },
  { name: 'VEH_suv', key: 'suv', weight: 0.20, speedScale: 0.98 },
  { name: 'VEH_van', key: 'van', weight: 0.13, speedScale: 0.92 },
  { name: 'VEH_pickup', key: 'pickup', weight: 0.07, speedScale: 0.95 },
  { name: 'VEH_box_truck', key: 'box_truck', weight: 0.05, speedScale: 0.82 },
  { name: 'VEH_bus', key: 'bus', weight: 0.03, speedScale: 0.75 },
]

// Muted, road-realistic paint. Manhattan traffic is overwhelmingly white,
// black, silver and grey; saturated colours are the exception.
const PAINT = [
  0xd8d8d6, 0xd8d8d6, 0xc9cacc, 0xb4b6b8, 0x8d9094,
  0x2e3134, 0x24262a, 0x3a4048, 0x51565c,
  0x6b2f2f, 0x25405e, 0x2c4a3a, 0x7a6a4a,
]

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
// glass and tyres take their own rgb straight from vPaint.
const PATCH_FRAG_BODY = /* glsl */`
{
  diffuseColor.rgb = mix(vPaint.rgb, vColor.rgb, vPaint.a);
  diffuseColor.a = 1.0;
}
`

// Exported because the street furniture is authored to the same convention:
// a tree canopy and a hydrant barrel are painted white with the mask set, and
// everything else keeps its authored colour.
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

export class VehicleFleet {
  constructor(scene) {
    this.scene = scene
    this.material = paintMaterial()
    this.types = []          // one entry per FLEET row, with its InstancedMesh
    this.ready = false
  }

  async load(url = '/models/manhattan/vehicles.glb', capacity = 1200) {
    const gltf = await new GLTFLoader().loadAsync(url + bust())
    const byName = new Map()
    gltf.scene.traverse((o) => { if (o.isMesh) byName.set(o.name, o) })

    const dummy = new THREE.Object3D()
    for (const spec of FLEET) {
      const src = byName.get(spec.name)
      if (!src) {
        console.warn('[fleet] missing', spec.name)
        continue
      }
      const cap = Math.max(8, Math.round(capacity * spec.weight * 1.6))
      const mesh = new THREE.InstancedMesh(src.geometry, this.material, cap)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(cap * 3), 3)
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.name = `FLEET_${spec.key}`
      // park every slot far below the world until it is used
      dummy.position.set(0, -5000, 0)
      dummy.updateMatrix()
      for (let i = 0; i < cap; i++) mesh.setMatrixAt(i, dummy.matrix)

      src.geometry.computeBoundingBox()
      const bb = src.geometry.boundingBox
      this.types.push({
        ...spec,
        mesh,
        capacity: cap,
        // The exporter maps Blender (x, y, z) -> glTF (x, z, -y). The bodies
        // are authored pointing along Blender +x, so after export the length
        // is the glTF x extent and the width is the z extent. Reading them
        // the other way round gave every vehicle a 1.9 m "length", which
        // collapsed the car-following gaps.
        length: bb.max.x - bb.min.x,
        width: bb.max.z - bb.min.z,
      })
      this.scene.add(mesh)
    }
    this.ready = this.types.length > 0
    return this
  }

  // Deterministic per-vehicle paint, so a car does not change colour when it
  // is recycled into a different slot.
  colorFor(type, seed) {
    if (type.fixedColor) return new THREE.Color(type.color)
    return new THREE.Color(PAINT[seed % PAINT.length])
  }

  pick(rand) {
    let r = rand
    for (const t of this.types) {
      r -= t.weight
      if (r <= 0) return t
    }
    return this.types[0]
  }

  reset() {
    for (const t of this.types) t.mesh.count = 0
  }

  flush() {
    for (const t of this.types) {
      t.mesh.instanceMatrix.needsUpdate = true
      if (t.mesh.instanceColor) t.mesh.instanceColor.needsUpdate = true
    }
  }

  get stats() {
    let n = 0
    for (const t of this.types) n += t.mesh.count
    return { drawn: n, types: this.types.length }
  }
}
