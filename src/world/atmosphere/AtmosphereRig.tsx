/**
 * Mounts the sky dome, the image-based lighting bake and the street-light
 * pools, and keeps them in step with the weather's published atmosphere.
 *
 * The weather engine (city/weather.js) decides what the sky is; this rig only
 * draws it. Everything here is per-frame uniform writes and a throttled
 * environment bake — no React state changes after mount.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../../gameplay/runtime'
import { cityWorld } from '../../city/registry.js'
import type { QualityPreset } from '../palette'
import { atmosphere, lightingUniforms } from './lighting-state'
import { installAtmosphereChunks } from './shader-chunks'
import { createSkyMaterial, createSkyUniforms, type SkyUniforms } from './sky-material'
import { altitudeBand, EnvironmentBaker, skylineScaleForBand } from './environment'
import { nightHdr } from './night-hdr'
import { LightPools } from './light-pools'

// Before any material compiles: three caches built-in programs by their
// parameters, so a chunk patched after the first frame would never be seen.
installAtmosphereChunks()

const GROUND_Y = 12.4

function copyRgb(target: THREE.Color, c: { r: number; g: number; b: number }, scale = 1): void {
  target.setRGB(c.r * scale, c.g * scale, c.b * scale)
}

function syncSkyUniforms(u: SkyUniforms): void {
  const s = atmosphere.state
  u.uMoonDir.value.set(s.moon.x, s.moon.y, s.moon.z)
  copyRgb(u.uZenith.value, s.zenith)
  copyRgb(u.uHorizon.value, s.horizon)
  copyRgb(u.uMie.value, s.mieColor)
  copyRgb(u.uSunDisk.value, s.sunDiskColor)
  copyRgb(u.uMoonColor.value, s.moonColor)
  copyRgb(u.uLightPollution.value, s.lightPollution)
  copyRgb(u.uCloudLit.value, s.cloudLit)
  copyRgb(u.uCloudShade.value, s.cloudShade)
  copyRgb(u.uKeyColor.value, s.keyColor, s.keyIntensity)
  u.uKeyDir.value.set(s.keyDir.x, Math.max(0.05, s.keyDir.y), s.keyDir.z).normalize()
  copyRgb(u.uNightAmbient.value, s.nightAmbient)
  u.uSunDiskI.value = s.sunDiskIntensity
  u.uMoonI.value = s.moonIntensity
  u.uStars.value = s.stars
  u.uCover.value = s.cover
  u.uNight.value = s.night
  u.uPracticals.value = s.practicals
}

export function AtmosphereRig({ quality }: { quality: QualityPreset }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  const uniforms = useMemo(() => createSkyUniforms(), [])
  const dome = useMemo(() => {
    const material = createSkyMaterial(uniforms, { octaves: quality === 'low' ? 3 : 5 })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), material)
    mesh.name = 'ATMOSPHERE_sky'
    mesh.frustumCulled = false
    // Last among opaques: early-z rejects every pixel a building covers.
    mesh.renderOrder = 1_000_000
    mesh.onBeforeRender = (_r, _s, camera) => {
      mesh.position.copy(camera.position)
      mesh.updateMatrixWorld()
      mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld)
    }
    return mesh
  }, [uniforms, quality])

  const baker = useMemo(
    () => new EnvironmentBaker(gl, uniforms, quality === 'low' ? 128 : 256),
    [gl, uniforms, quality],
  )
  const pools = useMemo(() => new LightPools(), [])
  const hdrVersion = useRef(-1)
  const version = useRef(-1)
  const clock = useRef(0)

  useEffect(() => {
    scene.add(dome)
    return () => {
      scene.remove(dome)
      dome.geometry.dispose()
      ;(dome.material as THREE.Material).dispose()
    }
  }, [scene, dome])

  useEffect(() => {
    const previous = scene.environment
    scene.environment = baker.texture
    if (import.meta.env.DEV) {
      ;(globalThis as unknown as { __atmosphereBaker: EnvironmentBaker }).__atmosphereBaker = baker
    }
    hdrVersion.current = -1
    return () => {
      if (scene.environment === baker.texture) scene.environment = previous
      scene.environmentIntensity = 1
      baker.dispose()
    }
  }, [scene, baker])

  useEffect(() => {
    scene.add(pools.group)
    return () => pools.dispose()
  }, [scene, pools])

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20)
    const frozen = rt.captureFrozen || rt.paused
    if (!frozen) clock.current += dt
    uniforms.uTime.value = clock.current
    lightingUniforms.uAtmoTime.value = clock.current

    if (version.current !== atmosphere.version) {
      version.current = atmosphere.version
      syncSkyUniforms(uniforms)
    }
    const cam = state.camera.position
    uniforms.uCamPos.value.copy(cam)
    uniforms.uCloudOffset.value.set(atmosphere.cloudOffset.x, atmosphere.cloudOffset.y)

    const s = atmosphere.state
    atmosphere.wetness = rt.clock.weather.wetness
    lightingUniforms.uAtmoWetness.value = atmosphere.wetness

    if (hdrVersion.current !== nightHdr.version) {
      hdrVersion.current = nightHdr.version
      baker.setNightHdr(nightHdr.texture)
    }
    const band = altitudeBand(cam.y, GROUND_Y)
    uniforms.uSkyline.value = skylineScaleForBand(band)
    baker.update(
      dt,
      {
        sunX: s.sun.x,
        sunY: s.sun.y,
        sunZ: s.sun.z,
        cover: s.cover,
        rain: s.rain,
        night: s.practicals,
        altitudeBand: band,
      },
      0.6 * s.practicals,
    )
    scene.environmentIntensity = s.envIntensity

    const lamp = cityWorld.props?.meshes.get('PROP_streetlight') as THREE.InstancedMesh | undefined
    pools.setSource(lamp ?? null)
    pools.update(s.practicals, atmosphere.wetness)
  })

  return null
}
