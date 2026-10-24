/**
 * The sun's shadow map follows the camera without swimming.
 *
 * One directional shadow map covers the playable area around the camera,
 * pushed forward along the view so most of its texels land on what is on
 * screen. Two things keep it stable:
 *
 *   - the centre is snapped to whole shadow texels in light space, so walking
 *     slides the map by exact texels and edges do not crawl;
 *   - the covered extent only changes in coarse altitude steps, so the texel
 *     size is constant while walking or driving.
 *
 * The light sits far up the sun direction (`LIGHT_DISTANCE`) with a deep
 * frustum, so a tower several blocks toward a low sun still casts into the
 * area. Pure maths, so the snapping is unit-tested.
 */
import * as THREE from 'three'

export const LIGHT_DISTANCE = 2600

export interface ShadowPreset {
  mapSize: number
  /** Half-width of the covered square at street level, metres. */
  halfExtent: number
}

export function shadowPresetFor(quality: 'low' | 'medium' | 'high'): ShadowPreset | null {
  if (quality === 'high') return { mapSize: 2048, halfExtent: 230 }
  if (quality === 'medium') return { mapSize: 1024, halfExtent: 170 }
  return null
}

/** Coarse extent steps with altitude: the aerial view needs reach, not detail. */
export function halfExtentForAltitude(base: number, heightAboveGround: number): number {
  const h = Math.max(0, heightAboveGround)
  if (h < 60) return base
  if (h < 160) return base * 1.6
  if (h < 400) return base * 2.8
  return base * 4
}

const _basis = new THREE.Matrix4()
const _inv = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _up = new THREE.Vector3()
const _fwd = new THREE.Vector3()

/**
 * Snap a world-space point to the shadow texel grid of a light shining along
 * `-toLight`. Returns the snapped world point (written into `out`).
 */
export function snapToShadowTexels(
  point: THREE.Vector3,
  toLight: THREE.Vector3,
  texelSize: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  _up.set(0, 1, 0)
  if (Math.abs(toLight.y) > 0.999) _up.set(0, 0, 1)
  // Light-space basis: z along the light, x/y across it.
  _basis.lookAt(toLight, new THREE.Vector3(0, 0, 0), _up)
  _inv.copy(_basis).invert()
  _p.copy(point).applyMatrix4(_inv)
  _p.x = Math.round(_p.x / texelSize) * texelSize
  _p.y = Math.round(_p.y / texelSize) * texelSize
  return out.copy(_p).applyMatrix4(_basis)
}

/**
 * Place the light and its target for this frame.
 *
 * @param toLight unit vector toward the key light
 */
export function placeShadowCamera(
  light: THREE.DirectionalLight,
  camera: THREE.Camera,
  toLight: THREE.Vector3,
  groundY: number,
  preset: ShadowPreset,
): number {
  const height = camera.position.y - groundY
  const half = halfExtentForAltitude(preset.halfExtent, height)
  const texel = (2 * half) / preset.mapSize

  camera.getWorldDirection(_fwd)
  _fwd.y = 0
  const len = _fwd.length()
  const centre = new THREE.Vector3(camera.position.x, groundY, camera.position.z)
  if (len > 0.1) centre.addScaledVector(_fwd, (0.5 * half) / len)
  snapToShadowTexels(centre, toLight, texel, centre)

  light.target.position.copy(centre)
  light.position.copy(centre).addScaledVector(toLight, LIGHT_DISTANCE)
  light.target.updateMatrixWorld()
  light.updateMatrixWorld()

  const cam = light.shadow.camera
  if (cam.right !== half || cam.far !== LIGHT_DISTANCE + 700) {
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.near = 1
    cam.far = LIGHT_DISTANCE + 700
    cam.updateProjectionMatrix()
  }
  return texel
}
