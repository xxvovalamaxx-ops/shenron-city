/**
 * The vehicle family on the GPU: one GLB, two ways of drawing it.
 *
 * `public/models/vehicles/vehicles.glb` is authored by
 * `scripts/blender/vehicles/build_vehicles.py`: six original, fictional
 * kinds, each a root node with a LOD0 body (paint, glass, trim, lamps,
 * interior …), one shared wheel mesh placed four times, and two cheap LODs.
 * Materials are identified by name (`VEH_paint`, `VEH_glass`, …) and are
 * replaced here, so the look lives in code, not in the export.
 *
 * - Hero cars (the player's car, parked and dev-spawned cars — a handful)
 *   clone the node graph with real per-car materials: clearcoat paint that
 *   reflects `scene.environment`, see-through glass with the interior
 *   behind it, and per-car lamp materials whose emissive the rig drives.
 * - Traffic (hundreds) uses merged geometries per kind and LOD with a
 *   per-vertex `zone` attribute (the paint mask and every other material
 *   slot), drawn by one instanced material whose per-instance attributes
 *   carry the paint colour and the lamp state. See {@link createFleetMaterial}.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const VEHICLE_MODEL_URL = '/models/vehicles/vehicles.glb'

/** Kinds authored in the GLB. Specs (vehicle-specs.ts) map legacy kinds onto these. */
export const MODEL_KINDS = ['sedan', 'taxi', 'police', 'suv', 'van', 'coupe'] as const
export type ModelKind = (typeof MODEL_KINDS)[number]

/** The per-vertex material zone. Order matters: it is baked into the shader. */
export const ZONES = [
  'paint',
  'glass',
  'trim',
  'chrome',
  'rubber',
  'rim',
  'headlight',
  'taillight',
  'indicator',
  'interior',
  'plate',
  'well',
  'livery',
  'livery_dark',
  'lightbar_red',
  'lightbar_blue',
  'taxi_sign',
] as const
export type ZoneName = (typeof ZONES)[number]
export const ZONE_ID: Readonly<Record<ZoneName, number>> = Object.fromEntries(
  ZONES.map((name, i) => [name, i]),
) as Record<ZoneName, number>

/** Linear base colour, roughness and metalness of every non-paint zone. */
const ZONE_LOOK: Record<ZoneName, { color: number; rough: number; metal: number }> = {
  paint: { color: 0xffffff, rough: 0.34, metal: 0.18 },
  glass: { color: 0x07090b, rough: 0.03, metal: 0.0 },
  trim: { color: 0x0b0b0c, rough: 0.5, metal: 0.0 },
  chrome: { color: 0xe6e8ec, rough: 0.12, metal: 1.0 },
  rubber: { color: 0x121212, rough: 0.92, metal: 0.0 },
  rim: { color: 0xa9acb2, rough: 0.28, metal: 1.0 },
  headlight: { color: 0x9aa2aa, rough: 0.16, metal: 0.25 },
  taillight: { color: 0x4a0606, rough: 0.12, metal: 0.0 },
  indicator: { color: 0x6a3a06, rough: 0.12, metal: 0.0 },
  interior: { color: 0x101012, rough: 0.9, metal: 0.0 },
  plate: { color: 0xd6d6cc, rough: 0.5, metal: 0.0 },
  well: { color: 0x050505, rough: 1.0, metal: 0.0 },
  livery: { color: 0x0b1f5c, rough: 0.32, metal: 0.1 },
  livery_dark: { color: 0x0a0a0a, rough: 0.35, metal: 0.0 },
  lightbar_red: { color: 0x5a0808, rough: 0.1, metal: 0.0 },
  lightbar_blue: { color: 0x081a66, rough: 0.1, metal: 0.0 },
  taxi_sign: { color: 0xe6d6a2, rough: 0.35, metal: 0.0 },
}

export interface WheelNode {
  tag: 'FL' | 'FR' | 'RL' | 'RR'
  position: THREE.Vector3
  quaternion: THREE.Quaternion
}

export interface VehicleKindAsset {
  kind: ModelKind
  /** The GLB node for this kind (template, never added to the scene). */
  template: THREE.Object3D
  /** Hero body meshes (one per material), in the kind's local frame. */
  bodyParts: THREE.Mesh[]
  /** Hero wheel meshes (one per material), hub at the origin. */
  wheelParts: THREE.Mesh[]
  wheels: WheelNode[]
  wheelRadius: number
  /** Merged traffic geometries with a `zone` attribute. */
  fleet: { lod0: THREE.BufferGeometry; lod1: THREE.BufferGeometry; lod2: THREE.BufferGeometry }
  /** Merged wheel with a `zone` attribute, for the traffic wheel instances. */
  fleetWheel: THREE.BufferGeometry
  /** Headlight lens centroids (left, right) and taillight centroids, local metres. */
  headlights: THREE.Vector3[]
  taillights: THREE.Vector3[]
  bounds: THREE.Box3
}

export interface VehicleAssets {
  kinds: Map<ModelKind, VehicleKindAsset>
}

let assetsPromise: Promise<VehicleAssets> | null = null
let loadedAssets: VehicleAssets | null = null

/** Load (once) and prepare the vehicle family. */
export function loadVehicleAssets(): Promise<VehicleAssets> {
  if (!assetsPromise) {
    assetsPromise = new GLTFLoader()
      .loadAsync(VEHICLE_MODEL_URL)
      .then((gltf) => {
        loadedAssets = prepare(gltf.scene)
        return loadedAssets
      })
      .catch((error) => {
        assetsPromise = null
        throw error
      })
  }
  return assetsPromise
}

/** The prepared assets if they have finished loading, else null. */
export function vehicleAssetsIfReady(): VehicleAssets | null {
  return loadedAssets
}

function zoneOf(material: THREE.Material | THREE.Material[]): ZoneName {
  const m = Array.isArray(material) ? material[0] : material
  const name = (m?.name ?? '').replace(/^VEH_/, '') as ZoneName
  return name in ZONE_ID ? name : 'trim'
}

function meshesUnder(node: THREE.Object3D | undefined): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  node?.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh)
  })
  return out
}

/**
 * Merge a multi-material node into one geometry with a per-vertex `zone`.
 * `transform` bakes an extra matrix (for LODs with nested nodes it is the
 * node's local matrix relative to the kind root).
 */
function mergeZoned(
  meshes: THREE.Mesh[],
  relativeTo: THREE.Object3D,
  skip: ReadonlySet<ZoneName> = new Set(),
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  relativeTo.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(relativeTo.matrixWorld).invert()
  for (const mesh of meshes) {
    const zone = zoneOf(mesh.material)
    if (skip.has(zone)) continue
    const g = new THREE.BufferGeometry()
    const src = mesh.geometry
    g.setAttribute('position', src.getAttribute('position').clone())
    g.setAttribute('normal', src.getAttribute('normal').clone())
    if (src.index) g.setIndex(src.index.clone())
    const count = src.getAttribute('position').count
    const zones = new Float32Array(count).fill(ZONE_ID[zone])
    g.setAttribute('zone', new THREE.BufferAttribute(zones, 1))
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)
    g.applyMatrix4(m)
    parts.push(g.index ? g : g)
  }
  const indexed = parts.every((p) => p.index)
  const merged = mergeGeometries(indexed ? parts : parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)
  if (!merged) throw new Error('vehicle merge failed')
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  return merged
}

function centroidOf(meshes: THREE.Mesh[], relativeTo: THREE.Object3D, side: number): THREE.Vector3 {
  const acc = new THREE.Vector3()
  let n = 0
  const inv = new THREE.Matrix4().copy(relativeTo.matrixWorld).invert()
  const v = new THREE.Vector3()
  for (const mesh of meshes) {
    const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)
    const pos = mesh.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      if (Math.sign(v.x) !== side) continue
      acc.add(v)
      n++
    }
  }
  return n > 0 ? acc.divideScalar(n) : acc
}

function prepare(scene: THREE.Object3D): VehicleAssets {
  scene.updateMatrixWorld(true)
  const kinds = new Map<ModelKind, VehicleKindAsset>()
  for (const kind of MODEL_KINDS) {
    const template = scene.getObjectByName(kind)
    if (!template) continue
    const bodyNode = template.getObjectByName(`${kind}_body`)
    const bodyParts = meshesUnder(bodyNode)
    const wheels: WheelNode[] = []
    let wheelParts: THREE.Mesh[] = []
    for (const tag of ['FL', 'FR', 'RL', 'RR'] as const) {
      const node = template.getObjectByName(`${kind}_wheel_${tag}`)
      if (!node) continue
      wheels.push({ tag, position: node.position.clone(), quaternion: node.quaternion.clone() })
      if (wheelParts.length === 0) wheelParts = meshesUnder(node)
    }
    // The wheel meshes, re-expressed around their own hub (identity node).
    const hubParts = wheelParts.map((mesh) => {
      const clone = new THREE.Mesh(mesh.geometry, mesh.material)
      clone.name = mesh.name
      return clone
    })
    const hubRoot = new THREE.Group()
    for (const part of hubParts) hubRoot.add(part)
    const fleetWheel = mergeZoned(hubParts, hubRoot)

    const lod1 = meshesUnder(template.getObjectByName(`${kind}_lod1`))
    const lod2 = meshesUnder(template.getObjectByName(`${kind}_lod2`))
    const lampHead = bodyParts.filter((m) => zoneOf(m.material) === 'headlight')
    const lampTail = bodyParts.filter((m) => zoneOf(m.material) === 'taillight')
    const bounds = new THREE.Box3()
    for (const mesh of bodyParts) {
      mesh.geometry.computeBoundingBox()
      bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrix))
    }
    kinds.set(kind, {
      kind,
      template,
      bodyParts,
      wheelParts: hubParts,
      wheels,
      wheelRadius: wheels[0]?.position.y ?? 0.34,
      fleet: {
        lod0: mergeZoned(bodyParts, template, new Set<ZoneName>(['interior'])),
        lod1: mergeZoned(lod1, template),
        lod2: mergeZoned(lod2, template),
      },
      fleetWheel,
      headlights: [centroidOf(lampHead, template, 1), centroidOf(lampHead, template, -1)],
      taillights: [centroidOf(lampTail, template, 1), centroidOf(lampTail, template, -1)],
      bounds,
    })
  }
  return { kinds }
}

// ── Hero materials ───────────────────────────────────────────────────────────

export type VehicleQuality = 'low' | 'medium' | 'high'

/** The live quality preset, published by App.tsx on the document element. */
export function currentVehicleQuality(): VehicleQuality {
  const q = typeof document === 'undefined' ? undefined : document.documentElement.dataset.qualityPreset
  return q === 'low' || q === 'high' ? q : 'medium'
}

let sharedHero: Partial<Record<ZoneName, THREE.Material>> | null = null
let sharedHeroQuality: VehicleQuality | null = null

function standard(zone: ZoneName, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const look = ZONE_LOOK[zone]
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(look.color),
    roughness: look.rough,
    metalness: look.metal,
    ...extra,
  })
  m.name = `VEH_${zone}`
  return m
}

function sharedHeroMaterials(quality: VehicleQuality): Partial<Record<ZoneName, THREE.Material>> {
  if (sharedHero && sharedHeroQuality === quality) return sharedHero
  const glass =
    quality === 'low'
      ? standard('glass', { roughness: 0.08 })
      : new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(ZONE_LOOK.glass.color),
          roughness: 0.02,
          metalness: 0,
          transparent: true,
          opacity: 0.62,
          envMapIntensity: 1.4,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
        })
  glass.name = 'VEH_glass'
  sharedHero = {
    glass,
    trim: standard('trim'),
    chrome: standard('chrome', { envMapIntensity: 1.3 }),
    rubber: standard('rubber'),
    rim: standard('rim'),
    interior: standard('interior'),
    plate: standard('plate'),
    well: standard('well'),
    livery: standard('livery'),
    livery_dark: standard('livery_dark'),
  }
  sharedHeroQuality = quality
  return sharedHero
}

/** Per-car materials the rig drives: paint colour and lamp emissive. */
export interface HeroMaterials {
  paint: THREE.MeshStandardMaterial
  headlight: THREE.MeshStandardMaterial
  taillight: THREE.MeshStandardMaterial
  indicator: THREE.MeshStandardMaterial
  lightbarRed: THREE.MeshStandardMaterial
  lightbarBlue: THREE.MeshStandardMaterial
  taxiSign: THREE.MeshStandardMaterial
  owned: THREE.Material[]
}

export function createHeroMaterials(paint: number, quality: VehicleQuality): HeroMaterials {
  const look = ZONE_LOOK.paint
  const paintMat: THREE.MeshStandardMaterial =
    quality === 'low'
      ? standard('paint', { color: new THREE.Color(paint) })
      : new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(paint),
          roughness: look.rough,
          metalness: look.metal,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          envMapIntensity: 1.1,
        })
  paintMat.name = 'VEH_paint'
  const lamp = (zone: ZoneName, emissive: number) =>
    standard(zone, { emissive: new THREE.Color(emissive), emissiveIntensity: 0, toneMapped: true })
  const headlight = lamp('headlight', 0xfff1dc)
  const taillight = lamp('taillight', 0xff1408)
  const indicator = lamp('indicator', 0xff8a10)
  const lightbarRed = lamp('lightbar_red', 0xff1010)
  const lightbarBlue = lamp('lightbar_blue', 0x2050ff)
  const taxiSign = lamp('taxi_sign', 0xffd890)
  return {
    paint: paintMat,
    headlight,
    taillight,
    indicator,
    lightbarRed,
    lightbarBlue,
    taxiSign,
    owned: [paintMat, headlight, taillight, indicator, lightbarRed, lightbarBlue, taxiSign],
  }
}

/** Material for one hero part, by the zone the GLB material names. */
export function heroMaterialFor(
  zone: ZoneName,
  own: HeroMaterials,
  quality: VehicleQuality,
): THREE.Material {
  switch (zone) {
    case 'paint':
      return own.paint
    case 'headlight':
      return own.headlight
    case 'taillight':
      return own.taillight
    case 'indicator':
      return own.indicator
    case 'lightbar_red':
      return own.lightbarRed
    case 'lightbar_blue':
      return own.lightbarBlue
    case 'taxi_sign':
      return own.taxiSign
    default:
      return sharedHeroMaterials(quality)[zone] ?? sharedHeroMaterials(quality).trim!
  }
}

export function heroZoneOf(mesh: THREE.Mesh): ZoneName {
  return zoneOf(mesh.material)
}

// ── The instanced fleet material ─────────────────────────────────────────────

/** Shared clock for lightbar strobes, advanced by whoever renders traffic. */
export const vehicleShaderTime = { value: 0 }

/**
 * One material for every traffic instance. Per-instance attributes:
 *
 *   instanceColor  paint (the `paint` zone only — the mask)
 *   instLight      x brake 0..1, y headlights 0..1, z lightbar phase (<0 off),
 *                  w taxi sign lit 0..1
 *
 * Per-vertex `zone` picks colour, roughness, metalness, clearcoat and the
 * lamp emissive from small uniform tables, so a whole car is one draw per
 * kind and LOD.
 */
export function createFleetMaterial(quality: VehicleQuality): THREE.MeshStandardMaterial {
  const physical = quality !== 'low'
  const material: THREE.MeshStandardMaterial = physical
    ? new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: ZONE_LOOK.paint.rough,
        metalness: ZONE_LOOK.paint.metal,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 1.0,
      })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1 })
  material.name = 'VEH_fleet'
  const colors = ZONES.map((z) => new THREE.Color(ZONE_LOOK[z].color))
  const rm = ZONES.map((z) => new THREE.Vector2(ZONE_LOOK[z].rough, ZONE_LOOK[z].metal))
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uZoneColor = { value: colors }
    shader.uniforms.uZoneRM = { value: rm }
    shader.uniforms.uVehTime = vehicleShaderTime
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float zone;
#ifdef USE_INSTANCING
attribute vec4 instLight;
#endif
varying float vZone;
varying vec4 vLight;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vZone = zone;
#ifdef USE_INSTANCING
vLight = instLight;
#else
vLight = vec4(0.0, 0.0, -1.0, 0.0);
#endif`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uZoneColor[${ZONES.length}];
uniform vec2 uZoneRM[${ZONES.length}];
uniform float uVehTime;
varying float vZone;
varying vec4 vLight;
float vehStrobe(float t, float phase) {
  // double flash per half cycle: on-off-on-off
  float c = fract(t * 1.6 + phase);
  float a = step(0.0, c) * step(c, 0.12) + step(0.2, c) * step(c, 0.32);
  return a;
}`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
int vehZone = int(vZone + 0.5);
if (vehZone != ${ZONE_ID.paint}) {
  diffuseColor.rgb = uZoneColor[vehZone];
  roughnessFactor = uZoneRM[vehZone].x;
  metalnessFactor = uZoneRM[vehZone].y;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float heads = vLight.y;
  if (vehZone == ${ZONE_ID.headlight}) totalEmissiveRadiance += vec3(1.0, 0.93, 0.82) * (0.03 + heads * 5.0);
  else if (vehZone == ${ZONE_ID.taillight}) totalEmissiveRadiance += vec3(1.0, 0.05, 0.02) * (heads * 1.1 + vLight.x * 4.0);
  else if (vehZone == ${ZONE_ID.taxi_sign}) totalEmissiveRadiance += vec3(1.0, 0.82, 0.5) * vLight.w * 1.6;
  else if (vLight.z >= 0.0 && vehZone == ${ZONE_ID.lightbar_red}) totalEmissiveRadiance += vec3(1.0, 0.04, 0.03) * vehStrobe(uVehTime, vLight.z) * 9.0;
  else if (vLight.z >= 0.0 && vehZone == ${ZONE_ID.lightbar_blue}) totalEmissiveRadiance += vec3(0.1, 0.25, 1.0) * vehStrobe(uVehTime, vLight.z + 0.5) * 9.0;
}`,
      )
    if (physical) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  if (vehZone != ${ZONE_ID.paint} && vehZone != ${ZONE_ID.glass} && vehZone != ${ZONE_ID.livery}) material.clearcoat = 0.0;
#endif`,
      )
    }
  }
  material.customProgramCacheKey = () => `vehicle-fleet-v1-${physical ? 'p' : 's'}`
  return material
}

/** Strobe pattern, mirrored in the fleet shader, for hero lightbars. */
export function lightbarStrobe(t: number, phase: number): number {
  const c = ((t * 1.6 + phase) % 1 + 1) % 1
  return (c <= 0.12 ? 1 : 0) + (c >= 0.2 && c <= 0.32 ? 1 : 0)
}
