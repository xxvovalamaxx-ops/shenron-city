/**
 * Hand-off point for the night HDR.
 *
 * NightEnvironment loads the Poly Haven equirect; the environment baker in
 * AtmosphereRig blends it into the night bake. The version lets the rig pick
 * up a (re)load without either side importing the other.
 */
import type * as THREE from 'three'

export const nightHdr: { texture: THREE.Texture | null; version: number } = {
  texture: null,
  version: 0,
}

export function setNightHdr(texture: THREE.Texture | null): void {
  nightHdr.texture = texture
  nightHdr.version++
}
