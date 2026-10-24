// sky.js — the key light, the fallback ambient and the fog for a 22 km world.
//
// The visible sky is the procedural dome in world/atmosphere (sun, moon,
// stars, clouds, city glow), and the ambient is image-based light baked from
// it. What is created here is the plumbing the weather engine drives:
//
//   sun  — the one shadow-casting key light: the sun by day, the moon at night
//   hemi — a low floor of ambient for the frames before the first IBL bake
//   fill — kept for API compatibility, not added to the scene: the IBL does
//          the bounce light it used to fake, and an extra directional light
//          is a full light loop in every lit fragment for nothing
//
// Fog stays a THREE.Fog so every material compiles its fog chunk; the
// atmosphere replaces the chunk's maths with height fog and a sun-tinted haze.
//
// The clip range matters more here than the lighting does. Phase 1 hit heavy
// depth-buffer speckle across the ground plane at city scale; the cause was a
// 24-bit depth buffer stretched from a 4 m near plane to 90 km. The fix that
// worked in Blender applies here too: keep the near plane far out and the far
// plane no larger than the world actually needs.

import * as THREE from 'three'

export function buildSky(scene, renderer) {
  const sky = new THREE.Color(0x8fb6dd)
  const haze = new THREE.Color(0xb9cfe4)

  scene.background = sky
  // fog starts past the near band so street level stays crisp, and closes
  // before the far plane so tiles that have not streamed in are not obvious
  scene.fog = new THREE.Fog(haze, 2600, 26000)

  const hemi = new THREE.HemisphereLight(0xbdd5f0, 0x4a453d, 0.15)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff2dc, 3.0)
  // late afternoon from the south-west, which is what puts light down the
  // numbered streets in Manhattan; the weather re-aims it every frame
  sun.position.set(-9000, 7000, 5200)
  sun.name = 'ATMOSPHERE_key'
  scene.add(sun)

  const fill = new THREE.DirectionalLight(0xa8c2de, 0)
  fill.position.set(6000, 3000, -6000)

  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0

  return { sun, hemi, fill }
}

// Called when the camera mode changes: a street-level near plane would kill
// depth precision at skyline range, and a skyline near plane would clip the
// pavement, so the two modes get different ranges.
export function applyClip(camera, mode) {
  if (mode === 'walk') {
    camera.near = 0.25
    camera.far = 14000
  } else {
    camera.near = 12
    camera.far = 45000
  }
  camera.updateProjectionMatrix()
}
