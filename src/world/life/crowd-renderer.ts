/**
 * Crowd visuals: skinned-quality people at instancing cost.
 *
 * The bodies are rigged CC0 characters (public/models/people/crowd_*.glb,
 * built by scripts/blender/people/build_crowd.py). At load each gender's clips
 * are sampled into a bone-matrix texture — one row per frame, three RGBA32F
 * texels per bone — and every pedestrian is an instance whose vertex shader
 * blends four bones from two rows of that texture. Walk, run, idles, a phone
 * idle and a crossfade between any two of them cost two per-instance numbers.
 *
 *   near  (< 26 m)   the full outfit, one InstancedMesh per variant,
 *                    casts shadows
 *   mid   (< 85 m)   one of two decimated silhouettes per gender (~1100 tris)
 *   far              the same silhouettes at ~320 tris
 *
 * Draw calls are bounded by the variant count (14) plus 8 proxies, and a mesh
 * with no instances this frame is hidden rather than drawn empty.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CROWD_VARIANTS, type CrowdVariant, type Gender } from './crowd-variants'
import { BAKE_FPS, layoutClips, strideFromFoot, type ClipLayout } from './crowd-anim'

/** Literal paths: the standalone verifier needs to see every shipped file. */
export const CROWD_BODY_URLS: Record<Gender, string> = {
  men: '/models/people/crowd_men.glb',
  women: '/models/people/crowd_women.glb',
}

/** Baked clips, in texture row order. All loop. */
export const CROWD_CLIPS = ['Walk', 'Run', 'Idle', 'Idle_Neutral', 'Phone', 'Wave', 'Interact'] as const
export type CrowdClip = (typeof CROWD_CLIPS)[number]

export const NEAR_M = 26
export const MID_M = 85

const NEAR_CAP = 72
const MID_CAP = 360
const FAR_CAP = 900

const VERT_HEAD = /* glsl */ `
uniform highp sampler2D uBones;
attribute vec4 aJoints;
attribute vec4 aWeights;
attribute vec4 aPaint;
attribute vec4 aAnim;
attribute vec4 aPal0;
attribute vec4 aPal1;
varying vec3 vPaint;
vec4 cR0;
vec4 cR1;
vec4 cR2;

vec3 crowdUnpack(float v) {
  v = floor(v + 0.5);
  vec3 c = vec3(floor(v / 65536.0), mod(floor(v / 256.0), 256.0), mod(v, 256.0)) / 255.0;
  // palettes are authored in sRGB
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void crowdBone(float joint, float w, ivec2 rows, float t) {
  int x = int(joint + 0.5) * 3;
  vec4 a0 = texelFetch(uBones, ivec2(x, rows.x), 0);
  vec4 a1 = texelFetch(uBones, ivec2(x + 1, rows.x), 0);
  vec4 a2 = texelFetch(uBones, ivec2(x + 2, rows.x), 0);
  vec4 b0 = texelFetch(uBones, ivec2(x, rows.y), 0);
  vec4 b1 = texelFetch(uBones, ivec2(x + 1, rows.y), 0);
  vec4 b2 = texelFetch(uBones, ivec2(x + 2, rows.y), 0);
  cR0 += w * mix(a0, b0, t);
  cR1 += w * mix(a1, b1, t);
  cR2 += w * mix(a2, b2, t);
}

void crowdSkin() {
  cR0 = vec4(0.0);
  cR1 = vec4(0.0);
  cR2 = vec4(0.0);
  ivec2 rows = ivec2(int(aAnim.x + 0.5), int(aAnim.y + 0.5));
  float t = aAnim.z;
  crowdBone(aJoints.x, aWeights.x, rows, t);
  if (aWeights.y > 0.0) crowdBone(aJoints.y, aWeights.y, rows, t);
  if (aWeights.z > 0.0) crowdBone(aJoints.z, aWeights.z, rows, t);
  if (aWeights.w > 0.0) crowdBone(aJoints.w, aWeights.w, rows, t);

  int region = int(aPaint.a * 7.0 + 0.5);
  vec3 tint = vec3(1.0);
  if (region == 1) tint = crowdUnpack(aPal0.x);
  else if (region == 2) tint = crowdUnpack(aPal0.y);
  else if (region == 3) tint = crowdUnpack(aPal0.z);
  else if (region == 4) tint = crowdUnpack(aPal0.w);
  else if (region == 5) tint = crowdUnpack(aPal1.x);
  else if (region == 6) tint = crowdUnpack(aPal1.y);
  vPaint = region == 0 || region == 7 ? aPaint.rgb : aPaint.rgb * tint;
}

vec3 crowdPos(vec3 p) {
  vec4 h = vec4(p, 1.0);
  vec3 o = vec3(dot(cR0, h), dot(cR1, h), dot(cR2, h));
  // the phone only exists while its idle plays
  if (int(aPaint.a * 7.0 + 0.5) == 7 && aAnim.w < 0.5) o = vec3(cR0.w, cR1.w, cR2.w);
  return o;
}
`

const FRAG_HEAD = /* glsl */ `
varying vec3 vPaint;
`

function patchVertex(src: string, withNormal: boolean): string {
  let s = src
    .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
    .replace('#include <skinbase_vertex>', 'crowdSkin();')
    .replace('#include <begin_vertex>', 'vec3 transformed = crowdPos(position);')
  if (withNormal) {
    s = s.replace(
      '#include <skinnormal_vertex>',
      'objectNormal = vec3(dot(cR0.xyz, objectNormal), dot(cR1.xyz, objectNormal), dot(cR2.xyz, objectNormal));',
    )
  }
  return s
}

function bodyMaterial(gender: Gender, bones: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBones = { value: bones }
    shader.vertexShader = patchVertex(shader.vertexShader, true)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vPaint;')
  }
  m.customProgramCacheKey = () => `crowd-body-${gender}`
  return m
}

function depthMaterial(gender: Gender, bones: THREE.Texture): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBones = { value: bones }
    shader.vertexShader = patchVertex(shader.vertexShader, false)
  }
  m.customProgramCacheKey = () => `crowd-depth-${gender}`
  return m
}

interface Body {
  gender: Gender
  layout: ClipLayout
  bones: THREE.DataTexture
  material: THREE.MeshStandardMaterial
  depth: THREE.MeshDepthMaterial
  parts: Map<string, THREE.BufferGeometry>
  proxies: Map<string, THREE.BufferGeometry>
  /** Metres covered by one cycle of each locomotion clip at scale 1. */
  cycle: Record<string, number>
}

interface Slot {
  mesh: THREE.InstancedMesh
  anim: THREE.InstancedBufferAttribute
  pal0: THREE.InstancedBufferAttribute
  pal1: THREE.InstancedBufferAttribute
  capacity: number
}

export interface CrowdInstance {
  x: number
  y: number
  z: number
  /** Rotation about +Y; the bodies face +Z at yaw 0. */
  yaw: number
  scale: number
  variant: number
  rowA: number
  rowB: number
  w: number
  prop: boolean
  pal0: [number, number, number, number]
  pal1: [number, number]
}

function prepGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const a = src.attributes
  g.setAttribute('position', a.position)
  g.setAttribute('normal', a.normal)
  // Renamed so three's own skinning/colour declarations never collide.
  g.setAttribute('aPaint', a.color)
  g.setAttribute('aJoints', a.skinIndex)
  g.setAttribute('aWeights', a.skinWeight)
  if (src.index) g.setIndex(src.index)
  return g
}

/** Sample every clip into one bone texture, bind space, root motion removed. */
function bake(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }): {
  texture: THREE.DataTexture
  layout: ClipLayout
  cycle: Record<string, number>
} | null {
  const skinned: THREE.SkinnedMesh[] = []
  gltf.scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh)
  })
  if (!skinned.length) return null
  const ref = skinned[0]
  const bones = ref.skeleton.bones
  const inverses = ref.skeleton.boneInverses
  const clips = CROWD_CLIPS.map((n) => gltf.animations.find((c) => c.name === n)).filter(
    (c): c is THREE.AnimationClip => !!c,
  )
  const layout = layoutClips(clips.map((c) => ({ name: c.name, duration: c.duration })))
  const W = bones.length * 3
  const data = new Float32Array(W * layout.rows * 4)
  const mixer = new THREE.AnimationMixer(gltf.scene)
  const m = new THREE.Matrix4()
  const bindInv = ref.bindMatrixInverse
  const bind = ref.bindMatrix
  const hips = bones.findIndex((b) => b.name === 'Hips')
  const foot = bones.findIndex((b) => b.name === 'Foot.L')
  const cycle: Record<string, number> = {}
  const tmp = new THREE.Vector3()

  for (const clip of clips) {
    const info = layout.clips[clip.name]
    const action = mixer.clipAction(clip)
    action.reset().play()
    const hx: number[] = []
    const hz: number[] = []
    const fz: number[] = []
    const frames: Float32Array[] = []
    for (let f = 0; f < info.frames; f++) {
      mixer.setTime(f / BAKE_FPS)
      gltf.scene.updateMatrixWorld(true)
      const rowData = new Float32Array(W * 4)
      for (let i = 0; i < bones.length; i++) {
        m.multiplyMatrices(bones[i].matrixWorld, inverses[i]).premultiply(bindInv).multiply(bind)
        const e = m.elements
        for (let r = 0; r < 3; r++) {
          const o = (i * 3 + r) * 4
          rowData[o] = e[r]
          rowData[o + 1] = e[4 + r]
          rowData[o + 2] = e[8 + r]
          rowData[o + 3] = e[12 + r]
        }
      }
      frames.push(rowData)
      if (hips >= 0) {
        tmp.setFromMatrixPosition(bones[hips].matrixWorld)
        hx.push(tmp.x)
        hz.push(tmp.z)
      }
      if (foot >= 0) {
        tmp.setFromMatrixPosition(bones[foot].matrixWorld)
        fz.push(tmp.z)
      }
    }
    action.stop()
    mixer.uncacheAction(clip)

    // Root motion: a clip that travels would snap back at every loop. Hold
    // the hips over the origin on the ground plane instead; the sim moves the
    // instance.
    const span = (a: number[]) => (a.length ? Math.max(...a) - Math.min(...a) : 0)
    const drift = Math.max(span(hx), span(hz)) > 0.25
    for (let f = 0; f < frames.length; f++) {
      const rowData = frames[f]
      if (drift) {
        const dx = hx[f] - hx[0]
        const dz = hz[f] - hz[0]
        for (let i = 0; i < bones.length; i++) {
          rowData[(i * 3) * 4 + 3] -= dx
          rowData[(i * 3 + 2) * 4 + 3] -= dz
        }
        if (f < fz.length) fz[f] -= dz
      }
      data.set(rowData, (info.start + f) * W * 4)
    }
    cycle[clip.name] = strideFromFoot(fz)
  }

  const texture = new THREE.DataTexture(data, W, layout.rows, THREE.RGBAFormat, THREE.FloatType)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return { texture, layout, cycle }
}

export class CrowdRenderer {
  readonly parent: THREE.Object3D
  readonly variants: readonly CrowdVariant[] = CROWD_VARIANTS
  readonly bodies = new Map<Gender, Body>()
  ready = false
  /** Per-variant near meshes; undefined when a variant's parts are missing. */
  private near: Array<Slot | undefined> = []
  /** `${gender}:${proxy}_L1|L2` */
  private proxies = new Map<string, Slot>()
  private all: Slot[] = []
  private readonly frustum = new THREE.Frustum()
  private readonly projView = new THREE.Matrix4()
  private readonly cam = new THREE.Vector3()
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.2)
  private readonly dummy = new THREE.Object3D()
  stats = { near: 0, mid: 0, far: 0, culled: 0, drawCalls: 0 }

  constructor(parent: THREE.Object3D) {
    this.parent = parent
  }

  async load(): Promise<this> {
    const loader = new GLTFLoader()
    for (const gender of ['men', 'women'] as Gender[]) {
      try {
        const gltf = await loader.loadAsync(CROWD_BODY_URLS[gender])
        const baked = bake(gltf)
        if (!baked) continue
        const parts = new Map<string, THREE.BufferGeometry>()
        const proxies = new Map<string, THREE.BufferGeometry>()
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh
          if (!mesh.isMesh) return
          if (mesh.name.startsWith('PART_')) parts.set(mesh.name.slice(5), prepGeometry(mesh.geometry))
          else if (mesh.name.startsWith('PROXY_')) proxies.set(mesh.name.slice(6), prepGeometry(mesh.geometry))
        })
        this.bodies.set(gender, {
          gender,
          layout: baked.layout,
          bones: baked.texture,
          material: bodyMaterial(gender, baked.texture),
          depth: depthMaterial(gender, baked.texture),
          parts,
          proxies,
          cycle: baked.cycle,
        })
        if (import.meta.env?.DEV) {
          console.info('[crowd] baked', gender, baked.layout.rows, 'frames; cycle m', baked.cycle)
        }
      } catch (err) {
        console.warn('[crowd] body load failed', gender, err)
      }
    }
    this._build()
    this.ready = this.near.some((s) => !!s)
    return this
  }

  private _slot(geo: THREE.BufferGeometry, body: Body, capacity: number, name: string, shadow: boolean): Slot {
    const attr = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n)
      a.setUsage(THREE.DynamicDrawUsage)
      return a
    }
    const anim = attr(4)
    const pal0 = attr(4)
    const pal1 = attr(4)
    geo.setAttribute('aAnim', anim)
    geo.setAttribute('aPal0', pal0)
    geo.setAttribute('aPal1', pal1)
    const mesh = new THREE.InstancedMesh(geo, body.material, capacity)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.visible = false
    mesh.frustumCulled = false
    mesh.castShadow = shadow
    mesh.receiveShadow = true
    if (shadow) mesh.customDepthMaterial = body.depth
    mesh.name = `CROWD_${name}`
    this.parent.add(mesh)
    const slot = { mesh, anim, pal0, pal1, capacity }
    this.all.push(slot)
    return slot
  }

  private _build(): void {
    this.near = this.variants.map((v) => {
      const body = this.bodies.get(v.gender)
      if (!body) return undefined
      const geos = v.parts.map((p) => body.parts.get(p)).filter((g): g is THREE.BufferGeometry => !!g)
      if (geos.length !== v.parts.length) {
        console.warn('[crowd] variant missing parts', v.key)
        if (!geos.length) return undefined
      }
      const merged = mergeGeometries(geos, false)
      if (!merged) return undefined
      return this._slot(merged, body, NEAR_CAP, v.key, true)
    })
    for (const [gender, body] of this.bodies) {
      for (const [name, geo] of body.proxies) {
        const far = name.endsWith('_L2')
        this.proxies.set(`${gender}:${name}`, this._slot(geo, body, far ? FAR_CAP : MID_CAP, `${gender}_${name}`, false))
      }
    }
  }

  /** Clip rows for a gender; undefined until loaded. */
  layout(gender: Gender): ClipLayout | undefined {
    return this.bodies.get(gender)?.layout
  }

  /** Ground metres per cycle of a locomotion clip at scale 1. */
  cycleMetres(gender: Gender, clip: CrowdClip): number {
    const c = this.bodies.get(gender)?.cycle[clip]
    if (c && c > 0.3) return c
    return clip === 'Run' ? 2.6 : 1.5
  }

  begin(camera: THREE.Camera): void {
    for (const s of this.all) s.mesh.count = 0
    camera.updateMatrixWorld()
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.projView)
    this.cam.setFromMatrixPosition(camera.matrixWorld)
    this.stats.near = this.stats.mid = this.stats.far = this.stats.culled = 0
  }

  /** Queue one person. Returns false when culled or over capacity. */
  add(p: CrowdInstance): boolean {
    this.sphere.center.set(p.x, p.y + 0.9 * p.scale, p.z)
    if (!this.frustum.intersectsSphere(this.sphere)) {
      this.stats.culled++
      return false
    }
    const d = Math.hypot(p.x - this.cam.x, p.y - this.cam.y, p.z - this.cam.z)
    const v = this.variants[p.variant]
    let slot: Slot | undefined
    if (d < NEAR_M) {
      slot = this.near[p.variant]
      if (slot) this.stats.near++
    }
    if (!slot) {
      const far = d >= MID_M
      slot = this.proxies.get(`${v.gender}:${v.proxy}_${far ? 'L2' : 'L1'}`)
      if (far) this.stats.far++
      else this.stats.mid++
    }
    if (!slot || slot.mesh.count >= slot.capacity) return false
    const i = slot.mesh.count++
    const dm = this.dummy
    dm.position.set(p.x, p.y, p.z)
    dm.rotation.set(0, p.yaw, 0)
    dm.scale.setScalar(p.scale)
    dm.updateMatrix()
    slot.mesh.setMatrixAt(i, dm.matrix)
    slot.anim.setXYZW(i, p.rowA, p.rowB, p.w, p.prop ? 1 : 0)
    slot.pal0.setXYZW(i, p.pal0[0], p.pal0[1], p.pal0[2], p.pal0[3])
    slot.pal1.setXYZW(i, p.pal1[0], p.pal1[1], 0, 0)
    return true
  }

  end(): void {
    let calls = 0
    for (const s of this.all) {
      const n = s.mesh.count
      s.mesh.visible = n > 0
      if (!n) continue
      calls++
      s.mesh.instanceMatrix.clearUpdateRanges()
      s.mesh.instanceMatrix.addUpdateRange(0, n * 16)
      s.mesh.instanceMatrix.needsUpdate = true
      for (const a of [s.anim, s.pal0, s.pal1]) {
        a.clearUpdateRanges()
        a.addUpdateRange(0, n * 4)
        a.needsUpdate = true
      }
    }
    this.stats.drawCalls = calls
  }

  dispose(): void {
    for (const s of this.all) {
      s.mesh.removeFromParent()
      s.mesh.geometry.dispose()
    }
    for (const b of this.bodies.values()) {
      b.material.dispose()
      b.depth.dispose()
      b.bones.dispose()
    }
    this.all = []
    this.near = []
    this.proxies.clear()
  }
}
