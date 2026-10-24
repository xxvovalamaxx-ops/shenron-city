/**
 * Park lawns that read as grass rather than green paint.
 *
 * The base tile's PARK_ground is one flat-coloured mesh. This swaps in a
 * copy of its material with a world-space tint: two octaves of value noise
 * mottle lush and dry patches at 6–40 m, a fine grain breaks up the surface
 * near the camera, and the park's texture comes from the meadow grass photo
 * (MEADOW_TEXTURES.mediumGrass) sampled as a small tiling detail. No geometry
 * and one texture fetch, so it costs nothing measurable on any preset.
 */
import * as THREE from 'three'
import { MEADOW_TEXTURES } from '../meadow-assets'

const VERT_HEAD = /* glsl */ `
varying vec3 vParkWorld;
`
const VERT_BODY = /* glsl */ `
vParkWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`

const FRAG_HEAD = /* glsl */ `
uniform sampler2D uParkDetail;
varying vec3 vParkWorld;
float parkHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float parkNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = parkHash(i);
  float b = parkHash(i + vec2(1.0, 0.0));
  float c = parkHash(i + vec2(0.0, 1.0));
  float d = parkHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`

const FRAG_BODY = /* glsl */ `
{
  vec2 w = vParkWorld.xz;
  float broad = parkNoise(w / 38.0) * 0.65 + parkNoise(w / 11.0) * 0.35;
  float fine = parkNoise(w * 0.9);
  vec3 lush = vec3(0.105, 0.20, 0.055);
  vec3 dry = vec3(0.23, 0.25, 0.10);
  vec3 grass = mix(lush, dry, smoothstep(0.35, 0.8, broad));
  // the grass photo as a 1.5 m detail, weighted by its own brightness
  vec3 detail = texture2D(uParkDetail, w / 1.5).rgb;
  float lum = dot(detail, vec3(0.3, 0.55, 0.15));
  grass *= 0.72 + 0.56 * clamp(lum * 2.2, 0.0, 1.0);
  grass *= 0.9 + 0.2 * fine;
  diffuseColor.rgb = grass;
}
`

/** Replace the lawn material on any PARK_ground mesh under `root`. */
export function applyParkGround(root: THREE.Object3D): boolean {
  let done = false
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || mesh.name.toUpperCase() !== 'PARK_GROUND') return
    if (mesh.userData.parkGround) return
    // Patch a clone rather than a fresh material: the lawn is coplanar with
    // the land mesh and relies on the exporter's depth offset settings.
    const src = mesh.material as THREE.Material
    const mat = src.clone()
    if ((mat as THREE.MeshStandardMaterial).roughness !== undefined) (mat as THREE.MeshStandardMaterial).roughness = 0.95
    const detail = new THREE.TextureLoader().load(MEADOW_TEXTURES.mediumGrass.albedo)
    detail.wrapS = THREE.RepeatWrapping
    detail.wrapT = THREE.RepeatWrapping
    detail.colorSpace = THREE.SRGBColorSpace
    detail.anisotropy = 4
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uParkDetail = { value: detail }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_BODY}`)
    }
    mat.customProgramCacheKey = () => 'park-ground'
    mesh.material = mat
    mesh.receiveShadow = true
    mesh.userData.parkGround = true
    done = true
  })
  return done
}
