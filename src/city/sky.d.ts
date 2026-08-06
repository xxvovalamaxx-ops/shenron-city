import type { Camera, DirectionalLight, HemisphereLight, Scene, WebGLRenderer } from 'three'

export declare function buildSky(
  scene: Scene,
  renderer: WebGLRenderer,
): { sun: DirectionalLight; hemi: HemisphereLight; fill: DirectionalLight }

export declare function applyClip(camera: Camera, mode: 'walk' | string): void
