/**
 * Image-based lighting for the city, at every hour of the day.
 *
 * This replaces `NightEnvironment`, which did the same job with one night HDR
 * and correctly faded it to nothing across dawn so it would not light a noon
 * scene. The consequence was that the daytime city had no environment lighting
 * at all: from roughly 07:00 to 17:00 `scene.environmentIntensity` was zero, so
 * glass, car paint and every metal surface had nothing to reflect but the
 * analytic sun. That is most of why the daytime city read flat.
 *
 * Four Poly Haven HDRs now cover the clock (see `environment-schedule.ts` for
 * the curve and the attribution). Two are live at a time and are mixed on the
 * GPU before pre-filtering, because switching outright from a dawn map to a
 * midday one is a visible flash across every reflective surface simultaneously.
 *
 * As before: this is lighting, never a visible skybox. `scene.background` stays
 * whatever sky.js and weather.js have installed and is not touched here.
 */
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import * as THREE from 'three'

import { rt } from '../gameplay/runtime'
import { useSimulationStage } from '../gameplay/useSimulationStage'
import {
  ENVIRONMENT_MAPS,
  ENVIRONMENT_MAP_IDS,
  environmentDelta,
  environmentForHour,
  type EnvironmentBlend,
  type EnvironmentMapId,
} from './environment-schedule'

/**
 * Blend weight change that justifies re-filtering.
 *
 * Mixing and pre-filtering a 1K equirect costs a few milliseconds — nothing
 * once in a while, unacceptable every frame. At 0.02 a full crossfade costs 50
 * rebuilds, spread across the hours the schedule gives it.
 */
const REBUILD_THRESHOLD = 0.02

/** The mixed map is the size of the sources; anything larger invents detail. */
const BLEND_WIDTH = 1024
const BLEND_HEIGHT = 512

const BLEND_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const BLEND_FRAGMENT = /* glsl */ `
  uniform sampler2D mapFrom;
  uniform sampler2D mapTo;
  uniform float blend;
  varying vec2 vUv;
  void main() {
    // Mixed in linear radiance, which is what an HDR already holds. Mixing
    // after any tone curve would darken the midpoint of every crossfade.
    gl_FragColor = mix(texture2D(mapFrom, vUv), texture2D(mapTo, vUv), blend);
  }
`

interface Rig {
  pmrem: THREE.PMREMGenerator
  target: THREE.WebGLRenderTarget
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  material: THREE.ShaderMaterial
  geometry: THREE.PlaneGeometry
  maps: Map<EnvironmentMapId, THREE.DataTexture>
  /** The PMREM currently installed on the scene, owned here so it can be freed. */
  filtered: THREE.Texture | null
}

export function CityEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const rig = useRef<Rig | null>(null)
  const applied = useRef<EnvironmentBlend | null>(null)

  useEffect(() => {
    let disposed = false

    const pmrem = new THREE.PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()

    const target = new THREE.WebGLRenderTarget(BLEND_WIDTH, BLEND_HEIGHT, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    })
    // PMREMGenerator reads `mapping` to decide how to project the source.
    target.texture.mapping = THREE.EquirectangularReflectionMapping

    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.ShaderMaterial({
      vertexShader: BLEND_VERTEX,
      fragmentShader: BLEND_FRAGMENT,
      uniforms: {
        mapFrom: { value: null },
        mapTo: { value: null },
        blend: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const blendScene = new THREE.Scene()
    blendScene.add(new THREE.Mesh(geometry, material))

    const current: Rig = {
      pmrem,
      target,
      scene: blendScene,
      camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      material,
      geometry,
      maps: new Map(),
      filtered: null,
    }
    rig.current = current

    const loader = new HDRLoader()
    for (const id of ENVIRONMENT_MAP_IDS) {
      loader.load(
        ENVIRONMENT_MAPS[id],
        (texture) => {
          if (disposed) {
            texture.dispose()
            return
          }
          texture.mapping = THREE.EquirectangularReflectionMapping
          current.maps.set(id, texture)
          // Force a rebuild: the map the current hour wants may have just
          // arrived, and without this the scene keeps whatever was filtered
          // from the maps that happened to load first.
          applied.current = null
        },
        undefined,
        (err) => {
          if (!disposed) console.warn(`[CityEnvironment] ${id} HDR load failed:`, err)
        },
      )
    }

    // Exposed for the QA harnesses, alongside __cityWorld / __rt / __simulation
    // / __hud / __vehicleSim / __cityAudio. A `diagnostics()` rather than a
    // handle on the scene: whether the city is lit is a question about what the
    // renderer ended up with, and handing a probe the mutable scene graph
    // invites it to answer a different question than the one being asked.
    if (typeof window !== 'undefined') {
      ;(window as unknown as { __cityEnvironment: unknown }).__cityEnvironment = {
        diagnostics: () => ({
          hasEnvironment: !!scene.environment,
          environmentIsTexture: scene.environment?.isTexture === true,
          intensity: scene.environmentIntensity,
          mapsLoaded: [...current.maps.keys()],
          applied: applied.current,
          /** The sky owns this; if it ever equals the environment, IBL leaked into it. */
          backgroundIsEnvironment:
            scene.background !== null && scene.background === scene.environment,
        }),
      }
    }

    return () => {
      disposed = true
      rig.current = null
      applied.current = null
      if (typeof window !== 'undefined') {
        delete (window as unknown as { __cityEnvironment?: unknown }).__cityEnvironment
      }
      if (scene.environment === current.filtered) scene.environment = null
      current.filtered?.dispose()
      for (const texture of current.maps.values()) texture.dispose()
      current.maps.clear()
      current.material.dispose()
      current.geometry.dispose()
      current.target.dispose()
      current.pmrem.dispose()
      scene.environmentIntensity = 1
    }
  }, [gl, scene])

  // Presentation only: reads the clock, writes the environment. Integrates
  // nothing, so it is safe on a paused frame — the city must stay lit behind
  // the pause menu.
  useSimulationStage('city-environment', 'presentation', () => {
    const current = rig.current
    if (!current) return

    const wanted = environmentForHour(rt.clock.hour)
    // Intensity is a scalar and free, so it tracks the clock every frame even
    // when the filtered map is being reused.
    scene.environmentIntensity = wanted.intensity

    const from = current.maps.get(wanted.from)
    const to = current.maps.get(wanted.to)
    // A map still in flight means there is nothing honest to filter yet.
    if (!from || !to) return

    const previous = applied.current
    if (previous && environmentDelta(previous, wanted) < REBUILD_THRESHOLD) return

    current.material.uniforms.mapFrom.value = from
    current.material.uniforms.mapTo.value = to
    current.material.uniforms.blend.value = wanted.blend

    const previousTarget = gl.getRenderTarget()
    gl.setRenderTarget(current.target)
    gl.render(current.scene, current.camera)
    gl.setRenderTarget(previousTarget)

    const filtered = current.pmrem.fromEquirectangular(current.target.texture).texture
    // The old PMREM is released only after the new one is installed, so the
    // scene is never momentarily unlit. Without this the generator allocates a
    // fresh cube target on every rebuild and leakcheck would find them.
    const stale = current.filtered
    current.filtered = filtered
    scene.environment = filtered
    stale?.dispose()

    applied.current = wanted
  })

  return null
}
