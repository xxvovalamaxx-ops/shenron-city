// sky.js — sky dome, sun and distance fog tuned for a 22 km world.
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

  // Balanced against the flattened ground materials, not against the white
  // ones the first export produced. Sun at 2.1 plus hemi at 1.05 blew the
  // land plane to pure white and left every north-facing wall black.
  const hemi = new THREE.HemisphereLight(0xbdd5f0, 0x4a453d, 1.5)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6)
  // late afternoon from the south-west, which is what puts light down the
  // numbered streets in Manhattan
  sun.position.set(-9000, 7000, 5200)
  scene.add(sun)

  // A dim opposing light so the shadow side of a facade still reads. Real
  // street canyons bounce a lot of light; without this half of every building
  // is a black silhouette.
  const fill = new THREE.DirectionalLight(0xa8c2de, 0.8)
  fill.position.set(6000, 3000, -6000)
  scene.add(fill)

  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

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
