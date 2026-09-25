/**
 * Street-light pools: the warm puddles of light under every lamp at night.
 *
 * A few hundred real point lights would cost a few hundred light loops in
 * every lit fragment of the city. Instead each resident PROP_streetlight gets
 * two instanced, additive quads:
 *
 *   - a ground pool under the lamp head with a soft radial falloff (on a wet
 *     road it stretches toward the camera into the long glossy streak a wet
 *     street actually shows);
 *   - a small camera-facing glow at the lamp head, bright enough to bloom.
 *
 * Positions are read (read-only) from the props layer's streetlight
 * InstancedMesh, and rebuilt only when that mesh's instance buffer changes,
 * which is when the props layer re-culls around the camera. Everything is
 * gated on `practicals`, so the pass does not draw at all by day.
 */
import * as THREE from 'three'

/** Pure: where the head and pool sit in the lamp's local frame. */
export function lampHeadLocal(bounds: THREE.Box3): { head: THREE.Vector3; pool: THREE.Vector3 } {
  // The authored lamp is a pole at the origin with its arm along +x; the
  // head hangs just below the arm's tip.
  const tipX = Number.isFinite(bounds.max.x) ? bounds.max.x : 3
  const topY = Number.isFinite(bounds.max.y) ? bounds.max.y : 9
  const x = Math.max(0, tipX - 0.3)
  return { head: new THREE.Vector3(x, Math.max(1, topY - 0.35), 0), pool: new THREE.Vector3(x, 0, 0) }
}

const POOL_VERTEX = /* glsl */ `
uniform float uWet;
uniform float uRadius;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
	vec4 center = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	vSeed = fract( sin( dot( center.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	// On a wet road the reflection stretches toward the viewer.
	vec2 toCam = cameraPosition.xz - center.xz;
	float camDist = length( toCam );
	vec2 along = camDist > 1e-3 ? toCam / camDist : vec2( 0.0, 1.0 );
	vec2 across = vec2( - along.y, along.x );
	float stretch = 1.0 + uWet * 0.8;
	vec2 offset = across * position.x * uRadius + along * ( position.y * uRadius * stretch + uWet * uRadius * 0.4 * ( position.y * 0.5 + 0.5 ) );
	vec3 world = vec3( center.x + offset.x, center.y, center.z + offset.y );
	vUv = position.xy;
	vFade = 1.0 - smoothstep( 220.0, 340.0, camDist );
	gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}
`

const POOL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uWet;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
	float r = length( vUv );
	float pool = pow( max( 1.0 - r * r, 0.0 ), 2.4 );
	// a hot core right under the head
	pool += 0.6 * pow( max( 1.0 - r * 2.2, 0.0 ), 2.0 );
	// A mix of sodium and newer LED heads, like the real city.
	vec3 col = mix( uColor, vec3( 1.0, 0.86, 0.7 ), step( 0.7, vSeed ) );
	float I = uIntensity * ( 0.8 + 0.4 * vSeed ) * ( 1.0 + uWet * 0.3 );
	gl_FragColor = vec4( col * pool * I * vFade, 1.0 );
}
`

const GLOW_VERTEX = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
	vec4 center = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
	vSeed = fract( sin( dot( center.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
	vec4 mv = viewMatrix * center;
	float dist = length( mv.xyz );
	// Grow slightly with distance so far lamps stay a few pixels wide.
	float size = uSize * ( 1.0 + dist * 0.006 );
	mv.xy += position.xy * size;
	vUv = position.xy;
	vFade = 1.0 - smoothstep( 260.0, 360.0, dist );
	gl_Position = projectionMatrix * mv;
}
`

const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
	float r = length( vUv );
	float glow = exp( - r * r * 9.0 ) * 1.6 + exp( - r * 3.0 ) * 0.25;
	glow *= 1.0 - smoothstep( 0.8, 1.0, r );
	vec3 col = mix( uColor, vec3( 1.0, 0.88, 0.74 ), step( 0.7, vSeed ) );
	gl_FragColor = vec4( col * glow * uIntensity * vFade, 1.0 );
}
`

export class LightPools {
  readonly group = new THREE.Group()
  private readonly pools: THREE.InstancedMesh
  private readonly glows: THREE.InstancedMesh
  private readonly poolMaterial: THREE.ShaderMaterial
  private readonly glowMaterial: THREE.ShaderMaterial
  private readonly capacity: number
  private source: THREE.InstancedMesh | null = null
  private sourceVersion = -1
  private local: { head: THREE.Vector3; pool: THREE.Vector3 } | null = null
  private readonly m = new THREE.Matrix4()
  private readonly v = new THREE.Vector3()
  private readonly t = new THREE.Matrix4()

  constructor(capacity = 1024) {
    this.capacity = capacity
    this.group.name = 'ATMOSPHERE_light_pools'

    const quad = new THREE.PlaneGeometry(2, 2)
    this.poolMaterial = new THREE.ShaderMaterial({
      name: 'AtmosphereLightPool',
      uniforms: {
        uColor: { value: new THREE.Color(1.0, 0.56, 0.24) },
        uIntensity: { value: 0 },
        uWet: { value: 0 },
        uRadius: { value: 8.5 },
      },
      vertexShader: POOL_VERTEX,
      fragmentShader: POOL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      fog: false,
    })
    this.pools = new THREE.InstancedMesh(quad, this.poolMaterial, capacity)
    this.pools.count = 0
    this.pools.frustumCulled = false
    this.pools.renderOrder = -5
    this.pools.name = 'ATMOSPHERE_pools'

    this.glowMaterial = new THREE.ShaderMaterial({
      name: 'AtmosphereLampGlow',
      uniforms: {
        uColor: { value: new THREE.Color(1.0, 0.6, 0.28) },
        uIntensity: { value: 0 },
        uSize: { value: 0.9 },
      },
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    })
    this.glows = new THREE.InstancedMesh(quad, this.glowMaterial, capacity)
    this.glows.count = 0
    this.glows.frustumCulled = false
    this.glows.name = 'ATMOSPHERE_lamp_glows'

    this.group.add(this.pools, this.glows)
    this.group.visible = false
  }

  /** The props layer's streetlight instances, or null until it has loaded. */
  setSource(mesh: THREE.InstancedMesh | null): void {
    if (mesh === this.source) return
    this.source = mesh
    this.sourceVersion = -1
    this.local = null
    if (mesh) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      this.local = lampHeadLocal(mesh.geometry.boundingBox ?? new THREE.Box3())
    }
  }

  update(practicals: number, wetness: number): void {
    const on = practicals > 0.01
    this.group.visible = on && !!this.source
    if (!this.group.visible || !this.source || !this.local) return

    this.poolMaterial.uniforms.uIntensity.value = 0.3 * practicals
    this.poolMaterial.uniforms.uWet.value = wetness
    this.glowMaterial.uniforms.uIntensity.value = 5.5 * practicals

    const src = this.source
    const version = src.instanceMatrix.version
    if (version === this.sourceVersion) return
    this.sourceVersion = version

    src.updateWorldMatrix(true, false)
    const n = Math.min(src.count, this.capacity)
    const arr = src.instanceMatrix.array as Float32Array
    for (let i = 0; i < n; i++) {
      this.m.fromArray(arr, i * 16).premultiply(src.matrixWorld)
      this.v.copy(this.local.pool).applyMatrix4(this.m)
      // The instance scale carries the prop's size; the pool keeps its own.
      this.t.makeTranslation(this.v.x, this.v.y + 0.03, this.v.z)
      this.pools.setMatrixAt(i, this.t)
      this.v.copy(this.local.head).applyMatrix4(this.m)
      this.t.makeTranslation(this.v.x, this.v.y, this.v.z)
      this.glows.setMatrixAt(i, this.t)
    }
    this.pools.count = n
    this.glows.count = n
    this.pools.instanceMatrix.needsUpdate = true
    this.glows.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.group.removeFromParent()
    this.pools.geometry.dispose()
    this.poolMaterial.dispose()
    this.glowMaterial.dispose()
    this.pools.dispose()
    this.glows.dispose()
  }
}
