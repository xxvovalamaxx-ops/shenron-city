/**
 * Image-based lighting baked from the procedural sky.
 *
 * The sky shader (in its ENV_BAKE variant, with the skyline ring and street)
 * is rendered into a small cube, and the cube is prefiltered by
 * PMREMGenerator into `scene.environment`. Every MeshStandardMaterial and —
 * since three r16x — every Lambert and Phong material samples it for diffuse
 * irradiance, and the standard ones also for specular reflections. That is the
 * ambient light for the whole city: blue sky fill in the shade, warm bounce at
 * golden hour, a sodium-and-windows glow at night.
 *
 * The bake re-runs only when the sky has changed enough to see (the sun has
 * moved about a degree, the cloud cover or rain has shifted, the camera
 * climbed into a different altitude band), and never more often than
 * `MIN_INTERVAL` seconds. The PMREM target is reused, so the environment
 * texture object never changes and no material recompiles.
 *
 * At night the Poly Haven "modern buildings night" HDR (loaded by
 * NightEnvironment) is blended into the bake over the procedural skyline, so
 * glossy surfaces reflect a real lit street rather than a pattern.
 */
import * as THREE from 'three'
import { createSkyMaterial, type SkyUniforms } from './sky-material'

const MIN_INTERVAL = 1.5
const MAX_INTERVAL = 30

// The HDR is exposed for a bright light-polluted sky (median sky radiance
// ~1.5, street ~0.16, lamps up to 4e5). Only its street band is used — the
// sky above stays ours — with the lamp hot spots clamped first, then scaled
// into the night bake's range, so wet roads and car paint reflect a lit
// street without the lamps turning into the city's ambient.
const HDR_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = position;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
	gl_Position.z = gl_Position.w;
}
`

const HDR_FRAGMENT = /* glsl */ `
uniform sampler2D uHdr;
uniform float uOpacity;
varying vec3 vDir;
void main() {
	vec3 d = normalize( vDir );
	vec2 uv = vec2( atan( d.z, d.x ) * 0.15915494 + 0.5, asin( clamp( d.y, - 1.0, 1.0 ) ) * 0.31830989 + 0.5 );
	// Clamp the lamp hot spots before scaling, or a 400k-nit bulb becomes
	// the whole city's ambient.
	vec3 c = min( texture2D( uHdr, uv ).rgb, vec3( 6.0 ) ) * 0.1;
	float band = smoothstep( 0.1, - 0.03, d.y );
	gl_FragColor = vec4( c, uOpacity * band );
}
`

export interface EnvironmentKey {
  sunX: number
  sunY: number
  sunZ: number
  cover: number
  rain: number
  night: number
  altitudeBand: number
}

/** Pure decision: has the sky changed enough since the last bake to re-bake? */
export function environmentNeedsBake(
  last: EnvironmentKey | null,
  next: EnvironmentKey,
  secondsSince: number,
): boolean {
  if (!last) return true
  if (secondsSince < MIN_INTERVAL) return false
  if (secondsSince > MAX_INTERVAL) return true
  const dot = last.sunX * next.sunX + last.sunY * next.sunY + last.sunZ * next.sunZ
  // about 1.1 degrees of sun travel
  if (dot < 0.99982) return true
  if (Math.abs(last.cover - next.cover) > 0.03) return true
  if (Math.abs(last.rain - next.rain) > 0.04) return true
  if (Math.abs(last.night - next.night) > 0.03) return true
  return last.altitudeBand !== next.altitudeBand
}

/** Coarse altitude bands: the skyline ring shrinks as the camera climbs. */
export function altitudeBand(cameraY: number, groundY: number): number {
  const h = Math.max(0, cameraY - groundY)
  if (h < 40) return 0
  if (h < 120) return 1
  if (h < 300) return 2
  return 3
}

export function skylineScaleForBand(band: number): number {
  return [1, 0.75, 0.45, 0.25][Math.max(0, Math.min(3, band))]
}

export class EnvironmentBaker {
  readonly texture: THREE.Texture
  private readonly renderer: THREE.WebGLRenderer
  private readonly pmrem: THREE.PMREMGenerator
  readonly cubeTarget: THREE.WebGLCubeRenderTarget
  private readonly cubeCamera: THREE.CubeCamera
  private readonly pmremTarget: THREE.WebGLRenderTarget
  private readonly scene = new THREE.Scene()
  private readonly skyMaterial: THREE.ShaderMaterial
  private readonly hdrMaterial: THREE.ShaderMaterial
  private readonly hdrMesh: THREE.Mesh
  private last: EnvironmentKey | null = null
  private sinceBake = 0
  bakes = 0

  constructor(renderer: THREE.WebGLRenderer, uniforms: SkyUniforms, size = 256) {
    this.renderer = renderer
    this.pmrem = new THREE.PMREMGenerator(renderer)
    this.cubeTarget = new THREE.WebGLCubeRenderTarget(size, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
    })
    this.cubeCamera = new THREE.CubeCamera(0.5, 50, this.cubeTarget)
    this.scene.add(this.cubeCamera)

    // Four octaves are plenty for a prefiltered ambient.
    this.skyMaterial = createSkyMaterial(uniforms, { envBake: true, octaves: 4 })
    const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), this.skyMaterial)
    dome.frustumCulled = false
    this.scene.add(dome)

    this.hdrMaterial = new THREE.ShaderMaterial({
      name: 'AtmosphereNightHdr',
      uniforms: { uHdr: { value: null }, uOpacity: { value: 0 } },
      vertexShader: HDR_VERTEX,
      fragmentShader: HDR_FRAGMENT,
      side: THREE.BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
    this.hdrMesh = new THREE.Mesh(new THREE.SphereGeometry(8, 48, 24), this.hdrMaterial)
    this.hdrMesh.renderOrder = 10
    this.hdrMesh.visible = false
    this.hdrMesh.frustumCulled = false
    this.scene.add(this.hdrMesh)

    // First bake allocates the PMREM target; later bakes reuse it.
    this.pmremTarget = this.pmrem.fromCubemap(this.cubeTarget.texture)
    this.texture = this.pmremTarget.texture
  }

  /** The night HDR, blended into the lower hemisphere after dark. */
  setNightHdr(texture: THREE.Texture | null): void {
    this.hdrMaterial.uniforms.uHdr.value = texture
    this.last = null
  }

  /** Force the next update to re-bake (quality change, first frame). */
  invalidate(): void {
    this.last = null
  }

  update(dt: number, key: EnvironmentKey, hdrOpacity: number): boolean {
    this.sinceBake += dt
    if (!environmentNeedsBake(this.last, key, this.sinceBake)) return false
    this.last = key
    this.sinceBake = 0

    const hasHdr = !!this.hdrMaterial.uniforms.uHdr.value && hdrOpacity > 0.01
    this.hdrMesh.visible = hasHdr
    this.hdrMaterial.uniforms.uOpacity.value = hdrOpacity

    this.cubeCamera.update(this.renderer, this.scene)
    this.pmrem.fromCubemap(this.cubeTarget.texture, this.pmremTarget)
    this.bakes++
    return true
  }

  dispose(): void {
    this.pmrem.dispose()
    this.cubeTarget.dispose()
    this.pmremTarget.dispose()
    this.skyMaterial.dispose()
    this.hdrMaterial.dispose()
    this.hdrMesh.geometry.dispose()
    for (const child of this.scene.children) {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) mesh.geometry.dispose()
    }
  }
}
