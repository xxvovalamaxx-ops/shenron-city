/**
 * Driving effects: skid marks, tyre smoke and crash sparks.
 *
 * All three are fixed-size ring buffers, so their cost never grows with play
 * time: one instanced draw for the marks and one point draw each for smoke
 * and sparks. Particles are animated on the GPU from their birth time, birth
 * position and velocity; the CPU only writes the slot a new particle lands
 * in. Everything here is visual — the simulation never reads it back.
 */
import * as THREE from 'three'

// ── Skid marks ───────────────────────────────────────────────────────────────

const SKID_CAPACITY = 1400

/**
 * Tyre marks: a ring buffer of flat quads laid on the road between
 * successive rear-wheel contact points while a tyre slides. Old marks are
 * overwritten, oldest first; each mark fades with the strength it was laid
 * with.
 */
export class SkidMarks {
  readonly mesh: THREE.InstancedMesh
  private next = 0
  private used = 0
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly e = new THREE.Euler()
  private readonly c = new THREE.Color()

  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1)
    geometry.rotateX(-Math.PI / 2)
    const material = new THREE.MeshBasicMaterial({
      color: 0x050505,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    })
    // The instance colour's red channel carries the mark's strength (alpha).
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef USE_INSTANCING_COLOR
  diffuseColor.a *= vColor.r;
  diffuseColor.rgb = diffuse;
#endif`,
      )
    }
    material.customProgramCacheKey = () => 'vehicle-skid-v1'
    this.mesh = new THREE.InstancedMesh(geometry, material, SKID_CAPACITY)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SKID_CAPACITY * 3), 3)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    this.mesh.name = 'vehicle-skidmarks'
  }

  /** Lay one mark from a to b (world), `width` metres wide. */
  add(a: THREE.Vector3, b: THREE.Vector3, width: number, strength: number): void {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 0.02 || len > 3) return
    const i = this.next
    this.next = (this.next + 1) % SKID_CAPACITY
    this.used = Math.min(SKID_CAPACITY, this.used + 1)
    this.p.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.025, (a.z + b.z) / 2)
    this.e.set(0, Math.atan2(dx, dz), 0)
    this.q.setFromEuler(this.e)
    // +2 cm overlap so consecutive quads join without gaps
    this.s.set(width, 1, len + 0.02)
    this.m.compose(this.p, this.q, this.s)
    this.mesh.setMatrixAt(i, this.m)
    this.mesh.setColorAt(i, this.c.setRGB(Math.min(1, strength), 0, 0))
    this.mesh.count = this.used
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
  }
}

// ── GPU particles ────────────────────────────────────────────────────────────

interface ParticleOptions {
  capacity: number
  life: number
  additive: boolean
  vertex: string
  fragment: string
}

/**
 * A ring buffer of GPU-animated points. Each particle stores its birth
 * position, velocity, birth time and a per-particle size/seed; the shaders
 * do the rest.
 */
class ParticleRing {
  readonly points: THREE.Points
  readonly material: THREE.ShaderMaterial
  private readonly origin: THREE.BufferAttribute
  private readonly velocity: THREE.BufferAttribute
  private readonly birth: THREE.BufferAttribute
  private readonly seed: THREE.BufferAttribute
  private next = 0
  private readonly capacity: number

  constructor(opts: ParticleOptions) {
    this.capacity = opts.capacity
    const g = new THREE.BufferGeometry()
    this.origin = new THREE.BufferAttribute(new Float32Array(opts.capacity * 3), 3)
    this.velocity = new THREE.BufferAttribute(new Float32Array(opts.capacity * 3), 3)
    const births = new Float32Array(opts.capacity).fill(-1e6)
    this.birth = new THREE.BufferAttribute(births, 1)
    this.seed = new THREE.BufferAttribute(new Float32Array(opts.capacity), 1)
    for (const attr of [this.origin, this.velocity, this.birth, this.seed]) attr.setUsage(THREE.DynamicDrawUsage)
    // three needs a `position` to size the draw; the shader never reads it
    g.setAttribute('position', this.origin)
    g.setAttribute('aVelocity', this.velocity)
    g.setAttribute('aBirth', this.birth)
    g.setAttribute('aSeed', this.seed)
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: opts.life },
        uLight: { value: new THREE.Color(1, 1, 1) },
        uScale: { value: 400 },
      },
      vertexShader: opts.vertex,
      fragmentShader: opts.fragment,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.points = new THREE.Points(g, this.material)
    this.points.frustumCulled = false
    this.points.renderOrder = 2
  }

  emit(pos: THREE.Vector3, vel: THREE.Vector3, time: number, seed: number): void {
    const i = this.next
    this.next = (this.next + 1) % this.capacity
    this.origin.setXYZ(i, pos.x, pos.y, pos.z)
    this.velocity.setXYZ(i, vel.x, vel.y, vel.z)
    this.birth.setX(i, time)
    this.seed.setX(i, seed)
    for (const attr of [this.origin, this.velocity, this.birth, this.seed]) attr.needsUpdate = true
  }

  set time(t: number) {
    this.material.uniforms.uTime.value = t
  }

  dispose(): void {
    this.points.geometry.dispose()
    this.material.dispose()
  }
}

const SMOKE_VERTEX = /* glsl */ `
attribute vec3 aVelocity;
attribute float aBirth;
attribute float aSeed;
uniform float uTime;
uniform float uLife;
uniform float uScale;
varying float vAlpha;
varying float vSeed;
void main() {
  float age = uTime - aBirth;
  float t = clamp(age / uLife, 0.0, 1.0);
  // drag: travel eases out; smoke rises and billows
  float travel = (1.0 - exp(-2.2 * age)) / 2.2;
  vec3 p = position + aVelocity * travel + vec3(0.0, 0.55 * age, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = mix(0.7, 4.2, sqrt(t)) * (0.8 + 0.4 * aSeed);
  gl_PointSize = age < 0.0 || t >= 1.0 ? 0.0 : uScale * size / max(0.1, -mv.z);
  vAlpha = (1.0 - t) * smoothstep(0.0, 0.08, age) * 0.5;
  vSeed = aSeed;
}
`

const SMOKE_FRAGMENT = /* glsl */ `
uniform vec3 uLight;
varying float vAlpha;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float soft = smoothstep(0.5, 0.0, r);
  float puff = 0.85 + 0.15 * sin((c.x + vSeed) * 17.0) * sin((c.y - vSeed) * 13.0);
  gl_FragColor = vec4(uLight * 0.82 * puff, vAlpha * soft * soft);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const SPARK_VERTEX = /* glsl */ `
attribute vec3 aVelocity;
attribute float aBirth;
attribute float aSeed;
uniform float uTime;
uniform float uLife;
uniform float uScale;
varying float vHeat;
void main() {
  float age = uTime - aBirth;
  float life = uLife * (0.5 + 0.5 * aSeed);
  float t = clamp(age / life, 0.0, 1.0);
  vec3 p = position + aVelocity * age + vec3(0.0, -4.9 * age * age, 0.0);
  p.y = max(p.y, position.y - 0.9);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = age < 0.0 || t >= 1.0 ? 0.0 : uScale * 0.06 / max(0.1, -mv.z);
  vHeat = 1.0 - t;
}
`

const SPARK_FRAGMENT = /* glsl */ `
varying float vHeat;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (length(c) > 0.5) discard;
  vec3 col = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.5), vHeat);
  gl_FragColor = vec4(col * (2.0 + 6.0 * vHeat), vHeat);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class TyreSmoke extends ParticleRing {
  constructor() {
    super({ capacity: 640, life: 2.6, additive: false, vertex: SMOKE_VERTEX, fragment: SMOKE_FRAGMENT })
    this.points.name = 'vehicle-smoke'
  }

  /** Scene light level for the smoke tint (0 night … 1 noon). */
  setLight(level: number): void {
    const l = 0.18 + 0.82 * Math.max(0, Math.min(1, level))
    this.material.uniforms.uLight.value.setRGB(l, l, l * 1.02)
  }
}

export class Sparks extends ParticleRing {
  constructor() {
    super({ capacity: 260, life: 0.7, additive: true, vertex: SPARK_VERTEX, fragment: SPARK_FRAGMENT })
    this.points.name = 'vehicle-sparks'
  }
}
