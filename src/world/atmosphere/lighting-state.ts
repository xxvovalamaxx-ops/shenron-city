/**
 * The live lighting state, shared with every shader that wants it.
 *
 * Two audiences:
 *
 * 1. `lightingUniforms` — `{ value }` uniform objects for other workstreams'
 *    patched materials (the facade and road shaders, car paint). Assign them
 *    into `shader.uniforms` inside `onBeforeCompile` and the one write per
 *    frame from the weather reaches every program:
 *
 *      material.onBeforeCompile = (shader) => {
 *        Object.assign(shader.uniforms, lightingUniforms)
 *        // GLSL: uniform vec3 uAtmoSunDirection; uniform float uAtmoNight; ...
 *      }
 *
 *    | uniform              | type  | meaning                                             |
 *    |----------------------|-------|-----------------------------------------------------|
 *    | uAtmoSunDirection    | vec3  | world, unit, toward the sun (can point below y=0)   |
 *    | uAtmoKeyDirection    | vec3  | world, unit, toward the shadow-casting key light    |
 *    | uAtmoKeyColor        | vec3  | key light colour x intensity, linear                |
 *    | uAtmoSkyZenith       | vec3  | sky radiance straight up, linear                    |
 *    | uAtmoSkyHorizon      | vec3  | sky radiance at the horizon, linear                 |
 *    | uAtmoHaze            | vec3  | haze colour looking away from the sun, linear       |
 *    | uAtmoNight           | float | 0 day .. 1 night (sun 12 degrees down)              |
 *    | uAtmoPracticals      | float | 0..1 street lights / neon / windows switched on     |
 *    | uAtmoGolden          | float | 0..1 golden-hour strength                           |
 *    | uAtmoWetness         | float | 0 dry .. 1 standing water (lags the rain)           |
 *    | uAtmoTime            | float | seconds, for animated effects                       |
 *
 * 2. `atmosphereGlobals` — plain `{x,y,z}` objects fed into the globally
 *    patched fog and shadow chunks (see shader-chunks.ts). They are plain
 *    objects on purpose: three deep-clones Vector3/Color uniform values per
 *    material, but copies a plain object by reference, so one write here
 *    reaches every built-in material's program.
 *
 * `atmosphere` mirrors the whole AtmosphereState for TypeScript/JS readers
 * (the post grade, light pools, HUD) together with a version counter that
 * increments whenever the sky is recomputed.
 */
import * as THREE from 'three'
import type { AtmosphereState } from './model'
import { atmosphereAt } from './model'

export interface PlainVec3 {
  x: number
  y: number
  z: number
}

export interface PlainVec4 extends PlainVec3 {
  w: number
}

export const atmosphereGlobals = {
  /** Toward the sun, world space. */
  sunDir: { x: 0, y: 1, z: 0 } as PlainVec3,
  hazeSun: { x: 0.7, y: 0.72, z: 0.75 } as PlainVec3,
  hazeAway: { x: 0.6, y: 0.68, z: 0.78 } as PlainVec3,
  /** x: extinction per metre, y: extra extinction at street level, z: height falloff (1/m), w: street level y. */
  fog: { x: 0.00006, y: 0.001, z: 1 / 90, w: 12.4 } as PlainVec4,
  /** x: fully-hazed distance, y: sun-glow exponent, z: enabled (0 = three's stock fog), w: haze start distance. */
  fog2: { x: 24000, y: 8, z: 0, w: 30 } as PlainVec4,
}

export const lightingUniforms = {
  uAtmoSunDirection: { value: new THREE.Vector3(0, 1, 0) },
  uAtmoKeyDirection: { value: new THREE.Vector3(0, 1, 0) },
  uAtmoKeyColor: { value: new THREE.Color(1, 1, 1) },
  uAtmoSkyZenith: { value: new THREE.Color(0.1, 0.2, 0.5) },
  uAtmoSkyHorizon: { value: new THREE.Color(0.5, 0.6, 0.7) },
  uAtmoHaze: { value: new THREE.Color(0.5, 0.6, 0.7) },
  uAtmoNight: { value: 0 },
  uAtmoPracticals: { value: 0 },
  uAtmoGolden: { value: 0 },
  uAtmoWetness: { value: 0 },
  uAtmoTime: { value: 0 },
}

export type LightingUniforms = typeof lightingUniforms

interface AtmosphereRuntime {
  state: AtmosphereState
  /** Increments every time `state` is recomputed. */
  version: number
  /** Wind drift of the cloud deck, metres. */
  cloudOffset: { x: number; y: number }
  /** 0..1, lags rain. */
  wetness: number
}

export const atmosphere: AtmosphereRuntime = {
  state: atmosphereAt({ hour: 17, cover: 0.35, rain: 0 }),
  version: 0,
  cloudOffset: { x: 0, y: 0 },
  wetness: 0,
}

/** Publish a freshly computed state to every consumer. */
export function publishAtmosphere(state: AtmosphereState, groundY: number): void {
  atmosphere.state = state
  atmosphere.version++

  const g = atmosphereGlobals
  g.sunDir.x = state.sun.x
  g.sunDir.y = state.sun.y
  g.sunDir.z = state.sun.z
  g.hazeSun.x = state.hazeSun.r
  g.hazeSun.y = state.hazeSun.g
  g.hazeSun.z = state.hazeSun.b
  g.hazeAway.x = state.hazeAway.r
  g.hazeAway.y = state.hazeAway.g
  g.hazeAway.z = state.hazeAway.b
  g.fog.x = state.fogDensity
  g.fog.y = state.heightFogDensity
  g.fog.z = state.heightFogFalloff
  g.fog.w = groundY
  g.fog2.x = state.fogFar
  g.fog2.y = 6 + 10 * (1 - state.golden)
  g.fog2.z = 1

  const u = lightingUniforms
  u.uAtmoSunDirection.value.set(state.sun.x, state.sun.y, state.sun.z)
  u.uAtmoKeyDirection.value.set(state.keyDir.x, state.keyDir.y, state.keyDir.z)
  u.uAtmoKeyColor.value
    .setRGB(state.keyColor.r, state.keyColor.g, state.keyColor.b)
    .multiplyScalar(state.keyIntensity)
  u.uAtmoSkyZenith.value.setRGB(state.zenith.r, state.zenith.g, state.zenith.b)
  u.uAtmoSkyHorizon.value.setRGB(state.horizon.r, state.horizon.g, state.horizon.b)
  u.uAtmoHaze.value.setRGB(state.hazeAway.r, state.hazeAway.g, state.hazeAway.b)
  u.uAtmoNight.value = state.night
  u.uAtmoPracticals.value = state.practicals
  u.uAtmoGolden.value = state.golden
}

// Dev-only handle so captures and the console can inspect the live sky.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __atmosphere: unknown }).__atmosphere = {
    atmosphere,
    atmosphereGlobals,
    lightingUniforms,
  }
}
