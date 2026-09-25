/**
 * Every tree in the city: street trees from props.bin and park trees read out
 * of the streamed tiles, drawn as instanced procedural trees in three LODs.
 *
 *   near  < 58 m   full tree: bark tubes + ~400 leaf cards, wind, shadows
 *   mid   < 300 m  scaffolds + ~120 large cards
 *   far   < 2.6 km one camera-facing impostor per tree, baked at load from
 *                  the near tree into an albedo + normal atlas (16 views per
 *                  species: 8 around at 10 degrees, 8 around at 50)
 *
 * The bands overlap and crossfade with a screen-door dither evaluated per
 * instance on the GPU (tree-lod.ts has the same curves), so the CPU lists
 * only need to be conservative: near/mid are rebuilt every few metres of
 * camera travel, the far list every 50 m.
 *
 * Draw calls: one per (species, LOD, bark|leaves) that has instances, plus
 * one for every impostor on the island.
 */
import * as THREE from 'three'
import { TREE_SPECIES, growTree, type TreeMeshes, type TreeSpecies } from './tree-gen'
import {
  FAR_R, MID_FADE, MID_R, NEAR_FADE, NEAR_R, SPECIES_ORDER, parkScale, parkSpecies, treeHash,
  type SpeciesKey,
} from './tree-lod'
import { extractConeTrees } from './park-trees'
import { applyParkGround } from './park-ground'

/** Literal paths: the standalone verifier needs to see every shipped file. */
export const TREE_TEXTURE_URLS = {
  leaves: '/textures/nature/trees/leaf-atlas.webp',
  barkBroadleaf: '/textures/nature/trees/bark-broadleaf.webp',
  barkBroadleafNormal: '/textures/nature/trees/bark-broadleaf-normal.webp',
  barkPine: '/textures/nature/trees/pine-bark.webp',
  barkPineNormal: '/textures/nature/trees/pine-bark-normal.webp',
} as const

const CELL = 200
const REC = 8 // x, y, z, scale, yaw, tint, species, spare
const NEAR_CAP = 320
const MID_CAP = 1600
const FAR_CAP = 48000
const NEAR_REBUILD = 5
const FAR_REBUILD = 50

const IMP_VIEWS = 16
const IMP_CELL = 128
const IMP_W = IMP_VIEWS * IMP_CELL
const IMP_H = 8 * IMP_CELL

// ------------------------------------------------------------------ shaders

const DITHER = /* glsl */ `
float treeDither() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
`

// Bands: lo = 1 - smoothstep(uBand.x, uBand.y, d) when uBand.x < uBand.y
// else 0; hi likewise from uBand.zw, else past 1. A pixel draws when its
// dither value h satisfies lo <= h < hi.
const VERT_HEAD = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec4 uBand;
attribute vec3 aLeaf;
attribute float aTint;
varying vec2 vBand;
varying float vAO;
varying float vTint;
`

const VERT_WIND = /* glsl */ `
vec3 treeOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float treePh = dot(treeOrigin.xz, vec2(0.131, 0.071));
float treeSway = aLeaf.x;
float gust = sin(uTime * 0.83 + treePh) + 0.45 * sin(uTime * 1.97 + treePh * 1.7);
transformed.x += gust * treeSway * uWind * 0.32;
transformed.z += sin(uTime * 0.61 + treePh * 0.8) * treeSway * uWind * 0.2;
#ifdef TREE_LEAVES
transformed += objectNormal * sin(uTime * 5.3 + aLeaf.y + treePh) * 0.04 * uWind * treeSway;
#endif
float treeDist = distance(cameraPosition.xz, treeOrigin.xz);
vBand.x = uBand.x < uBand.y ? 1.0 - smoothstep(uBand.x, uBand.y, treeDist) : 0.0;
vBand.y = uBand.z < uBand.w ? 1.0 - smoothstep(uBand.z, uBand.w, treeDist) : 1.01;
vAO = aLeaf.z;
vTint = aTint;
`

const VERT_COLLAPSE = /* glsl */ `
if (vBand.y <= vBand.x + 0.001) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
`

const FRAG_HEAD = /* glsl */ `
varying vec2 vBand;
varying float vAO;
varying float vTint;
${DITHER}
`

const FRAG_DITHER = /* glsl */ `
{
  float h = treeDither();
  if (h < vBand.x || h >= vBand.y) discard;
}
`

// Alpha keeps its coverage down the mip chain: without this a crown thins
// to nothing at 100 m because averaged alpha falls under the cutoff.
const FRAG_LEAF_ALPHA = /* glsl */ `
{
  vec2 dUv = fwidth(vMapUv) * vec2(2048.0, 1024.0);
  float mip = max(0.0, log2(max(max(dUv.x, dUv.y), 1.0)));
  diffuseColor.a *= 1.0 + mip * 0.28;
  diffuseColor.rgb *= vAO * (1.0 + vTint * vec3(0.10, 0.06, -0.08));
}
`

const FRAG_LEAF_NORMAL = /* glsl */ `
float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
vec3 normal = normalize(vNormal);
vec3 nonPerturbedNormal = normal;
`

function patchTree(
  m: THREE.Material,
  leaves: boolean,
  band: THREE.Vector4,
  shared: { uTime: { value: number }; uWind: { value: number } },
  key: string,
): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime
    shader.uniforms.uWind = shared.uWind
    shader.uniforms.uBand = { value: band }
    if (leaves) shader.defines = { ...(shader.defines ?? {}), TREE_LEAVES: '' }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_WIND}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${VERT_COLLAPSE}`)
    let frag = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_DITHER}`)
    if (leaves) {
      frag = frag
        .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_LEAF_ALPHA}`)
        .replace('#include <normal_fragment_begin>', FRAG_LEAF_NORMAL)
    } else {
      frag = frag.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 1.0 + vTint * 0.08;')
    }
    shader.fragmentShader = frag
  }
  m.customProgramCacheKey = () => key
}

function patchDepth(
  m: THREE.MeshDepthMaterial,
  leaves: boolean,
  band: THREE.Vector4,
  shared: { uTime: { value: number }; uWind: { value: number } },
  key: string,
): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime
    shader.uniforms.uWind = shared.uWind
    shader.uniforms.uBand = { value: band }
    if (leaves) shader.defines = { ...(shader.defines ?? {}), TREE_LEAVES: '' }
    // the depth shader has no objectNormal unless displacement is on
    const wind = VERT_WIND.replace('objectNormal', 'normal')
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${wind}`)
      .replace('#include <clipping_planes_vertex>', `#include <clipping_planes_vertex>\n${VERT_COLLAPSE}`)
  }
  m.customProgramCacheKey = () => key
}

// ------------------------------------------------------------- impostors

const IMP_VERT = /* glsl */ `
uniform vec4 uSpecies[8];
uniform vec4 uBandImp;
attribute vec4 aPos;
attribute vec4 aInfo;
varying vec2 vImpUv;
varying vec4 vImpCell;
varying vec2 vImpBand;
varying vec3 vImpRight;
varying vec3 vImpUp;
varying vec3 vImpFwd;
varying float vImpTint;
varying float vImpYaw;
`

const IMP_BEGIN = /* glsl */ `
vec4 sp = uSpecies[int(aInfo.x + 0.5)];
float s = aPos.w;
vec3 centre = aPos.xyz + vec3(0.0, sp.y * s, 0.0);
vec3 toCam = cameraPosition - centre;
float camDist = length(toCam);
vec3 vd = toCam / max(camDist, 1e-3);
vec3 right = cross(vec3(0.0, 1.0, 0.0), vd);
if (dot(right, right) < 1e-6) right = vec3(1.0, 0.0, 0.0);
right = normalize(right);
vec3 upv = cross(vd, right);
vec3 transformed = centre + (right * position.x + upv * position.y) * sp.x * s;
vImpUv = position.xy * 0.5 + 0.5;
// view direction in the tree's own frame picks the baked view
float yaw = aInfo.y;
float cy = cos(yaw), sy = sin(yaw);
vec3 ld = vec3(cy * vd.x - sy * vd.z, vd.y, sy * vd.x + cy * vd.z);
float az = atan(ld.z, ld.x);
az = az < 0.0 ? az + 6.2831853 : az;
float el = asin(clamp(vd.y, -1.0, 1.0));
vImpCell = vec4(az / 6.2831853 * 8.0, smoothstep(0.35, 0.7, el), aInfo.x, 0.0);
float d = distance(cameraPosition.xz, aPos.xz);
vImpBand = vec2(1.0 - smoothstep(uBandImp.x, uBandImp.y, d), 1.0 - smoothstep(uBandImp.z, uBandImp.w, d));
vImpRight = right;
vImpUp = upv;
vImpFwd = vd;
vImpTint = aInfo.z;
vImpYaw = yaw;
`

const IMP_BEGINNORMAL = /* glsl */ `
vec3 objectNormal = normalize(cameraPosition - aPos.xyz);
`

const IMP_FRAG_HEAD = /* glsl */ `
uniform sampler2D uImpColor;
uniform sampler2D uImpNormal;
varying vec2 vImpUv;
varying vec4 vImpCell;
varying vec2 vImpBand;
varying vec3 vImpRight;
varying vec3 vImpUp;
varying vec3 vImpFwd;
varying float vImpTint;
varying float vImpYaw;
vec3 impN;
${DITHER}
`

const IMP_FRAG_MAP = /* glsl */ `
{
  float h = treeDither();
  if (h < vImpBand.x || h >= vImpBand.y) discard;
  // nearest two azimuth views and the two elevation rows, picked by dither
  float a = vImpCell.x;
  float ai = floor(a);
  float col = mod(ai + (h < fract(a) ? 1.0 : 0.0), 8.0);
  float row = h < vImpCell.y ? 1.0 : 0.0;
  vec2 cell = vec2(col + row * 8.0, vImpCell.z);
  vec2 q = clamp(vImpUv, 0.004, 0.996);
  // species rows are baked top-down; texture v runs bottom-up
  vec2 uv = vec2((cell.x + q.x) / ${IMP_VIEWS.toFixed(1)}, 1.0 - (cell.y + 1.0 - q.y) / 8.0);
  vec4 c = texture2D(uImpColor, uv);
  vec2 dUv = fwidth(vImpUv) * ${IMP_CELL.toFixed(1)};
  float mip = max(0.0, log2(max(max(dUv.x, dUv.y), 1.0)));
  if (c.a * (1.0 + mip * 0.3) < 0.5) discard;
  diffuseColor.rgb = c.rgb * (1.0 + vImpTint * vec3(0.10, 0.06, -0.08));
  vec3 n = texture2D(uImpNormal, uv).xyz * 2.0 - 1.0;
  // baked in the tree's own frame; rotate by the instance yaw
  float cy = cos(vImpYaw), sy = sin(vImpYaw);
  impN = normalize(vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z));
}
`

const IMP_FRAG_NORMAL = /* glsl */ `
float faceDirection = 1.0;
vec3 normal = normalize((viewMatrix * vec4(impN, 0.0)).xyz);
vec3 nonPerturbedNormal = normal;
`

// Bake pass: unlit albedo (with the card AO) or the shading normal.
const BAKE_VERT = /* glsl */ `
attribute vec3 aLeaf;
varying vec2 vUv;
varying vec3 vN;
varying float vAO;
void main() {
  vUv = uv;
  vN = normalize(normal);
  vAO = aLeaf.z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const BAKE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uCut;
uniform float uMode;
uniform float uBarkAO;
varying vec2 vUv;
varying vec3 vN;
varying float vAO;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < uCut) discard;
  if (uMode < 0.5) gl_FragColor = vec4(c.rgb * mix(vAO, uBarkAO, step(uCut, -0.5)), 1.0);
  else gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, 1.0);
}
`

// ------------------------------------------------------------------ types

interface Chunk {
  cx: number
  cz: number
  /** source id -> packed records */
  lists: Map<string, Float32Array>
}

interface SpeciesSet {
  key: SpeciesKey
  spec: TreeSpecies
  near: TreeMeshes
  mid: TreeMeshes
  nearBark: THREE.InstancedMesh
  nearLeaves: THREE.InstancedMesh
  midBark: THREE.InstancedMesh
  midLeaves: THREE.InstancedMesh
  /** impostor sphere radius and centre height at scale 1 */
  impRadius: number
  impCentre: number
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string): THREE.InstancedMesh {
  const g = geo.clone()
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1)
  tint.setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('aTint', tint)
  const m = new THREE.InstancedMesh(g, mat, cap)
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  m.count = 0
  m.visible = false
  m.frustumCulled = false
  m.name = name
  return m
}

export class TreeField {
  readonly parent: THREE.Object3D
  ready = false
  enabled = true
  private species: SpeciesSet[] = []
  private chunks = new Map<string, Chunk>()
  private tiles = new Map<string, string[]>() // file -> chunk keys holding its trees
  private streamer: { tiles: Map<string, { state: string; group: THREE.Object3D | null }>; onReady: Array<(f: string, g: THREE.Object3D) => void> } | null = null
  private lastNear = new THREE.Vector3(1e9, 0, 1e9)
  private lastFar = new THREE.Vector3(1e9, 0, 1e9)
  private dirtyFar = true
  private shared = { uTime: { value: 0 }, uWind: { value: 0.35 } }
  private far: THREE.Mesh | null = null
  private farPos: THREE.InstancedBufferAttribute | null = null
  private farInfo: THREE.InstancedBufferAttribute | null = null
  private farMat: THREE.MeshStandardMaterial | null = null
  private renderer: THREE.WebGLRenderer | null = null
  private baked = false
  private impColor: THREE.WebGLRenderTarget | null = null
  private impNormal: THREE.WebGLRenderTarget | null = null
  private textures: THREE.Texture[] = []
  private leafAtlas: THREE.Texture | null = null
  private barkMaps: Record<string, THREE.Texture> = {}
  private frame = 0
  private readonly dummy = new THREE.Object3D()
  stats = { trees: 0, near: 0, mid: 0, far: 0, parkTiles: 0, parkTrees: 0 }

  constructor(parent: THREE.Object3D) {
    this.parent = parent
  }

  // ---------------------------------------------------------------- load

  async load(): Promise<this> {
    const loader = new THREE.TextureLoader()
    const tex = async (url: string, srgb: boolean) => {
      const t = await loader.loadAsync(url)
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      t.wrapS = THREE.RepeatWrapping
      t.wrapT = THREE.RepeatWrapping
      t.anisotropy = 4
      this.textures.push(t)
      return t
    }
    const [leaves, bb, bbn, bp, bpn] = await Promise.all([
      tex(TREE_TEXTURE_URLS.leaves, true),
      tex(TREE_TEXTURE_URLS.barkBroadleaf, true),
      tex(TREE_TEXTURE_URLS.barkBroadleafNormal, false),
      tex(TREE_TEXTURE_URLS.barkPine, true),
      tex(TREE_TEXTURE_URLS.barkPineNormal, false),
    ])
    leaves.wrapS = THREE.ClampToEdgeWrapping
    leaves.wrapT = THREE.ClampToEdgeWrapping
    this.leafAtlas = leaves
    this.barkMaps = { broadleaf: bb, broadleafN: bbn, pine: bp, pineN: bpn }

    const nearBand = new THREE.Vector4(0, 0, NEAR_R - NEAR_FADE, NEAR_R + NEAR_FADE)
    const midBand = new THREE.Vector4(NEAR_R - NEAR_FADE, NEAR_R + NEAR_FADE, MID_R - MID_FADE, MID_R + MID_FADE)
    const barkMat = (kind: 'broadleaf' | 'pine', band: THREE.Vector4, lod: string) => {
      const m = new THREE.MeshStandardMaterial({
        map: this.barkMaps[kind],
        normalMap: this.barkMaps[`${kind}N`],
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: 0.93,
        metalness: 0,
        color: kind === 'pine' ? 0xb8aa9a : 0xc8c2b8,
      })
      patchTree(m, false, band, this.shared, `tree-bark-${lod}`)
      return m
    }
    const leafMat = (band: THREE.Vector4, lod: string) => {
      const m = new THREE.MeshStandardMaterial({
        map: leaves,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: 0.82,
        metalness: 0,
      })
      patchTree(m, true, band, this.shared, `tree-leaves-${lod}`)
      return m
    }
    const depthMat = (leavesToo: boolean, band: THREE.Vector4) => {
      const m = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: leavesToo ? leaves : null,
        alphaTest: leavesToo ? 0.5 : 0,
      })
      patchDepth(m, leavesToo, band, this.shared, `tree-depth-${leavesToo ? 'l' : 'b'}`)
      return m
    }
    const mats = {
      nearBark: { broadleaf: barkMat('broadleaf', nearBand, 'near'), pine: barkMat('pine', nearBand, 'near') },
      midBark: { broadleaf: barkMat('broadleaf', midBand, 'mid'), pine: barkMat('pine', midBand, 'mid') },
      nearLeaves: leafMat(nearBand, 'near'),
      midLeaves: leafMat(midBand, 'mid'),
      depthBark: depthMat(false, nearBand),
      depthLeaves: depthMat(true, nearBand),
    }

    SPECIES_ORDER.forEach((key, i) => {
      const spec = TREE_SPECIES[key]
      const near = growTree(spec, 11 + i, 'near')
      const mid = growTree(spec, 11 + i, 'mid')
      const nearBark = instanced(near.branches, mats.nearBark[spec.bark], NEAR_CAP, `PROPS_TREE_${key}_near_bark`)
      const nearLeaves = instanced(near.leaves, mats.nearLeaves, NEAR_CAP, `PROPS_TREE_${key}_near_leaves`)
      const midBark = instanced(mid.branches, mats.midBark[spec.bark], MID_CAP, `PROPS_TREE_${key}_mid_bark`)
      const midLeaves = instanced(mid.leaves, mats.midLeaves, MID_CAP, `PROPS_TREE_${key}_mid_leaves`)
      // Only the near trees throw shadows: the sun's shadow camera covers a
      // few hundred metres and mid trees would be wasted fill there.
      nearBark.castShadow = true
      nearLeaves.castShadow = true
      nearBark.customDepthMaterial = mats.depthBark
      nearLeaves.customDepthMaterial = mats.depthLeaves
      for (const m of [nearBark, nearLeaves, midBark, midLeaves]) {
        m.receiveShadow = true
        this.parent.add(m)
      }
      const half = near.height / 2
      this.species.push({
        key, spec, near, mid, nearBark, nearLeaves, midBark, midLeaves,
        impRadius: Math.hypot(near.radius, half) * 1.02,
        impCentre: half,
      })
    })
    this._buildFar()
    this.ready = true
    return this
  }

  private _buildFar(): void {
    const quad = new THREE.PlaneGeometry(2, 2)
    const g = new THREE.InstancedBufferGeometry()
    g.index = quad.index
    g.setAttribute('position', quad.attributes.position)
    g.setAttribute('normal', quad.attributes.normal)
    g.setAttribute('uv', quad.attributes.uv)
    this.farPos = new THREE.InstancedBufferAttribute(new Float32Array(FAR_CAP * 4), 4)
    this.farInfo = new THREE.InstancedBufferAttribute(new Float32Array(FAR_CAP * 4), 4)
    this.farPos.setUsage(THREE.DynamicDrawUsage)
    this.farInfo.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('aPos', this.farPos)
    g.setAttribute('aInfo', this.farInfo)
    g.instanceCount = 0
    const sp = Array.from({ length: 8 }, (_, i) => {
      const s = this.species[i]
      return s ? new THREE.Vector4(s.impRadius, s.impCentre, 0, 0) : new THREE.Vector4()
    })
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 })
    const uniforms = {
      uImpColor: { value: null as THREE.Texture | null },
      uImpNormal: { value: null as THREE.Texture | null },
      uSpecies: { value: sp },
      uBandImp: { value: new THREE.Vector4(MID_R - MID_FADE, MID_R + MID_FADE, FAR_R - 200, FAR_R) },
    }
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${IMP_VERT}`)
        .replace('#include <beginnormal_vertex>', IMP_BEGINNORMAL)
        .replace('#include <begin_vertex>', IMP_BEGIN)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${IMP_FRAG_HEAD}`)
        .replace('#include <map_fragment>', IMP_FRAG_MAP)
        .replace('#include <normal_fragment_begin>', IMP_FRAG_NORMAL)
    }
    mat.customProgramCacheKey = () => 'tree-impostor'
    mat.userData.impUniforms = uniforms
    this.farMat = mat
    const mesh = new THREE.Mesh(g, mat)
    mesh.frustumCulled = false
    mesh.name = 'PROPS_TREE_impostors'
    mesh.receiveShadow = false
    // The renderer is only reachable from inside a render; remember it and
    // bake the impostor atlas on the next update, outside the frame.
    mesh.onBeforeRender = (renderer) => {
      this.renderer = renderer
    }
    this.far = mesh
    this.parent.add(mesh)
  }

  // ------------------------------------------------------------- impostors

  private _bake(): void {
    const r = this.renderer
    if (!r || !this.leafAtlas) return
    const mk = (srgb: boolean) => {
      const t = new THREE.WebGLRenderTarget(IMP_W, IMP_H, {
        depthBuffer: true,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
      })
      t.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      return t
    }
    this.impColor = mk(true)
    this.impNormal = mk(false)
    const scene = new THREE.Scene()
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)
    const matFor = (map: THREE.Texture, cut: number, mode: number) =>
      new THREE.ShaderMaterial({
        vertexShader: BAKE_VERT,
        fragmentShader: BAKE_FRAG,
        uniforms: {
          map: { value: map },
          uCut: { value: cut },
          uMode: { value: mode },
          uBarkAO: { value: 0.8 },
        },
        side: THREE.DoubleSide,
      })
    const prevTarget = r.getRenderTarget()
    const prevAuto = r.autoClear
    const prevColor = new THREE.Color()
    r.getClearColor(prevColor)
    const prevAlpha = r.getClearAlpha()
    const prevShadow = r.shadowMap.autoUpdate
    r.autoClear = false
    r.shadowMap.autoUpdate = false

    const disposables: THREE.Material[] = []
    for (const [pass, target] of [[0, this.impColor], [1, this.impNormal]] as const) {
      r.setRenderTarget(target)
      // clear to the mean leaf colour so mipmaps do not bleed black
      r.setClearColor(pass === 0 ? new THREE.Color(0x2c3a1c) : new THREE.Color(0x8080ff), 0)
      r.clear(true, true, false)
      this.species.forEach((s, row) => {
        const bark = matFor(this.barkMaps[s.spec.bark], -1, pass)
        const leaf = matFor(this.leafAtlas!, 0.5, pass)
        disposables.push(bark, leaf)
        scene.clear()
        scene.add(new THREE.Mesh(s.near.branches, bark))
        scene.add(new THREE.Mesh(s.near.leaves, leaf))
        const rad = s.impRadius
        cam.left = -rad
        cam.right = rad
        cam.top = rad
        cam.bottom = -rad
        cam.near = 0.1
        cam.far = rad * 4 + 10
        cam.updateProjectionMatrix()
        for (let v = 0; v < IMP_VIEWS; v++) {
          const az = ((v % 8) / 8) * Math.PI * 2
          const el = v < 8 ? 0.17 : 0.87
          const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el))
          const c = new THREE.Vector3(0, s.impCentre, 0)
          cam.position.copy(c).addScaledVector(dir, rad * 2 + 5)
          cam.up.set(0, 1, 0)
          cam.lookAt(c)
          cam.updateMatrixWorld()
          target.viewport.set(v * IMP_CELL, IMP_H - (row + 1) * IMP_CELL, IMP_CELL, IMP_CELL)
          target.scissor.copy(target.viewport)
          target.scissorTest = true
          r.setRenderTarget(target)
          r.render(scene, cam)
        }
      })
      target.scissorTest = false
      target.viewport.set(0, 0, IMP_W, IMP_H)
    }
    for (const m of disposables) m.dispose()
    r.setRenderTarget(prevTarget)
    r.autoClear = prevAuto
    r.setClearColor(prevColor, prevAlpha)
    r.shadowMap.autoUpdate = prevShadow

    const u = this.farMat!.userData.impUniforms
    u.uImpColor.value = this.impColor.texture
    u.uImpNormal.value = this.impNormal.texture
    this.baked = true
    this.dirtyFar = true
  }

  // ---------------------------------------------------------------- data

  private _chunk(x: number, z: number): Chunk {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    const key = `${cx},${cz}`
    let c = this.chunks.get(key)
    if (!c) {
      c = { cx, cz, lists: new Map() }
      this.chunks.set(key, c)
    }
    return c
  }

  /** Replace every tree from one source (a street layer or a park tile). */
  setSource(source: string, records: Float32Array): string[] {
    this.removeSource(source)
    const byChunk = new Map<Chunk, number[]>()
    for (let i = 0; i < records.length; i += REC) {
      const c = this._chunk(records[i], records[i + 2])
      let list = byChunk.get(c)
      if (!list) {
        list = []
        byChunk.set(c, list)
      }
      for (let k = 0; k < REC; k++) list.push(records[i + k])
    }
    const keys: string[] = []
    for (const [c, list] of byChunk) {
      c.lists.set(source, new Float32Array(list))
      keys.push(`${c.cx},${c.cz}`)
    }
    this.tiles.set(source, keys)
    this._touch()
    return keys
  }

  removeSource(source: string): void {
    const keys = this.tiles.get(source)
    if (!keys) return
    for (const k of keys) this.chunks.get(k)?.lists.delete(source)
    this.tiles.delete(source)
    this._touch()
  }

  private _touch(): void {
    this.lastNear.set(1e9, 0, 1e9)
    this.dirtyFar = true
    let n = 0
    for (const c of this.chunks.values()) for (const l of c.lists.values()) n += l.length / REC
    this.stats.trees = n
  }

  /** Species index of a key, for packing records. */
  speciesIndex(key: SpeciesKey): number {
    return SPECIES_ORDER.indexOf(key)
  }

  // ----------------------------------------------------------- park tiles

  /**
   * Watch a tile streamer: every tile's TREE_ cone mesh is hidden and its
   * trees are planted as real ones; they leave again with the tile.
   */
  attachStreamer(streamer: TreeField['streamer']): void {
    if (!streamer || this.streamer) return
    this.streamer = streamer
    streamer.onReady.push((file, group) => this._ingestTile(file, group))
    for (const [file, t] of streamer.tiles) {
      if (t.state === 'ready' && t.group) this._ingestTile(file, t.group)
    }
  }

  private _ingestTile(file: string, group: THREE.Object3D): void {
    applyParkGround(group)
    const recs: number[] = []
    group.updateMatrixWorld(true)
    group.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh || !mesh.name.toUpperCase().startsWith('TREE_')) return
      mesh.visible = false
      const geo = mesh.geometry
      const src = geo.attributes.position
      const pos = new Float32Array(src.count * 3)
      const v = new THREE.Vector3()
      for (let i = 0; i < src.count; i++) {
        v.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld)
        pos[i * 3] = v.x
        pos[i * 3 + 1] = v.y
        pos[i * 3 + 2] = v.z
      }
      const trees = extractConeTrees(pos, geo.index ? geo.index.array : null)
      for (const t of trees) {
        const seed = treeHash(Math.round(t.x * 10) * 73856093 ^ Math.round(t.z * 10) * 19349663)
        // The export's scatter is about a third of the real park's density.
        // Each placeholder becomes a small grove: the tree itself and one
        // companion 5-9 m away, so the canopy closes over the paths.
        for (let k = 0; k < 2; k++) {
          const s = k ? treeHash(seed + 0x9e3779b9) : seed
          const a = ((s >>> 7) % 6283) / 1000
          const r = k ? 5 + ((s >>> 13) % 400) / 100 : 0
          recs.push(
            t.x + Math.cos(a) * r, t.ground, t.z + Math.sin(a) * r,
            parkScale(t.height) * (0.9 + (s % 1000) / 1000 * 0.25) * (k ? 0.85 : 1),
            ((s >>> 10) % 6283) / 1000,
            ((s >>> 3) % 2000) / 1000 - 1,
            this.speciesIndex(parkSpecies(s)), 0,
          )
        }
      }
    })
    if (!recs.length) return
    this.setSource(`tile:${file}`, new Float32Array(recs))
    this.stats.parkTiles++
    this.stats.parkTrees += recs.length / REC
  }

  private _pruneTiles(): void {
    if (!this.streamer) return
    for (const source of [...this.tiles.keys()]) {
      if (!source.startsWith('tile:')) continue
      const t = this.streamer.tiles.get(source.slice(5))
      if (!t || t.state !== 'ready') {
        this.removeSource(source)
        this.stats.parkTiles--
      }
    }
  }

  // --------------------------------------------------------------- frame

  update(camera: THREE.Camera, dt: number): void {
    if (!this.ready || !this.enabled) return
    this.shared.uTime.value += dt
    if (!this.baked && this.renderer) this._bake()
    if (++this.frame % 30 === 0) this._pruneTiles()
    const cam = camera.position
    const dNear = Math.hypot(cam.x - this.lastNear.x, cam.z - this.lastNear.z)
    if (dNear > NEAR_REBUILD) {
      this.lastNear.copy(cam)
      this._rebuildNear(cam)
    }
    const dFar = Math.hypot(cam.x - this.lastFar.x, cam.z - this.lastFar.z)
    if (this.baked && (this.dirtyFar || dFar > FAR_REBUILD)) {
      this.lastFar.copy(cam)
      this.dirtyFar = false
      this._rebuildFar(cam)
    }
  }

  private _each(cam: THREE.Vector3, radius: number, fn: (l: Float32Array, i: number, d: number) => void): void {
    const r = Math.ceil(radius / CELL)
    const cx = Math.floor(cam.x / CELL)
    const cz = Math.floor(cam.z / CELL)
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const c = this.chunks.get(`${cx + dx},${cz + dz}`)
        if (!c) continue
        for (const l of c.lists.values()) {
          for (let i = 0; i < l.length; i += REC) {
            const d = Math.hypot(l[i] - cam.x, l[i + 2] - cam.z)
            if (d <= radius) fn(l, i, d)
          }
        }
      }
    }
  }

  private _put(mesh: THREE.InstancedMesh, l: Float32Array, i: number): void {
    if (mesh.count >= mesh.instanceMatrix.count) return
    const d = this.dummy
    d.position.set(l[i], l[i + 1], l[i + 2])
    d.rotation.set(0, l[i + 4], 0)
    d.scale.setScalar(l[i + 3])
    d.updateMatrix()
    const k = mesh.count++
    mesh.setMatrixAt(k, d.matrix)
    ;(mesh.geometry.attributes.aTint as THREE.InstancedBufferAttribute).setX(k, l[i + 5])
  }

  private _rebuildNear(cam: THREE.Vector3): void {
    for (const s of this.species) {
      s.nearBark.count = s.nearLeaves.count = s.midBark.count = s.midLeaves.count = 0
    }
    const slack = NEAR_REBUILD + 2
    const nearMax = NEAR_R + NEAR_FADE + slack
    const midMin = NEAR_R - NEAR_FADE - slack
    const midMax = this.baked ? MID_R + MID_FADE + slack : FAR_R
    this._each(cam, midMax, (l, i, d) => {
      const s = this.species[l[i + 6]]
      if (!s) return
      if (d < nearMax) {
        this._put(s.nearBark, l, i)
        this._put(s.nearLeaves, l, i)
      }
      if (d > midMin) {
        this._put(s.midBark, l, i)
        this._put(s.midLeaves, l, i)
      }
    })
    let near = 0
    let mid = 0
    for (const s of this.species) {
      for (const m of [s.nearBark, s.nearLeaves, s.midBark, s.midLeaves]) {
        m.visible = m.count > 0
        m.instanceMatrix.needsUpdate = true
        const t = m.geometry.attributes.aTint as THREE.InstancedBufferAttribute
        t.needsUpdate = true
      }
      near += s.nearBark.count
      mid += s.midBark.count
    }
    this.stats.near = near
    this.stats.mid = mid
  }

  private _rebuildFar(cam: THREE.Vector3): void {
    if (!this.far || !this.farPos || !this.farInfo) return
    const pos = this.farPos.array as Float32Array
    const info = this.farInfo.array as Float32Array
    let n = 0
    const minD = MID_R - MID_FADE - FAR_REBUILD - 5
    this._each(cam, FAR_R, (l, i, d) => {
      if (d < minD || n >= FAR_CAP) return
      pos[n * 4] = l[i]
      pos[n * 4 + 1] = l[i + 1]
      pos[n * 4 + 2] = l[i + 2]
      pos[n * 4 + 3] = l[i + 3]
      info[n * 4] = l[i + 6]
      info[n * 4 + 1] = l[i + 4]
      info[n * 4 + 2] = l[i + 5]
      info[n * 4 + 3] = 0
      n++
    })
    const g = this.far.geometry as THREE.InstancedBufferGeometry
    g.instanceCount = n
    this.farPos.clearUpdateRanges()
    this.farPos.addUpdateRange(0, n * 4)
    this.farPos.needsUpdate = true
    this.farInfo.clearUpdateRanges()
    this.farInfo.addUpdateRange(0, n * 4)
    this.farInfo.needsUpdate = true
    this.stats.far = n
  }

  dispose(): void {
    for (const s of this.species) {
      for (const m of [s.nearBark, s.nearLeaves, s.midBark, s.midLeaves]) {
        m.removeFromParent()
        m.geometry.dispose()
      }
      s.near.branches.dispose()
      s.near.leaves.dispose()
      s.mid.branches.dispose()
      s.mid.leaves.dispose()
    }
    this.far?.removeFromParent()
    this.far?.geometry.dispose()
    this.farMat?.dispose()
    this.impColor?.dispose()
    this.impNormal?.dispose()
    for (const t of this.textures) t.dispose()
    this.species = []
    this.chunks.clear()
  }
}
