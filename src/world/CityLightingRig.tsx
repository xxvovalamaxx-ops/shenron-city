/**
 * Drives the Phase 3C city-night lighting from the existing day-cycle clock.
 *
 * One component owns the practicals/hour/wetness uniforms, exactly like
 * SkyRig owns the sun: the sky and the windows share the same clock and the
 * same `practicals` curve, so they cannot disagree about whether it is night.
 *
 * The per-building data texture (kind, storefront flags, density) is baked by
 * scripts/build-city-lighting.mjs and fetched here once. Until it arrives the
 * practicals stay at 0, so nothing renders half-lit.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { rt } from '../gameplay/runtime'
import { normaliseHour, skyAt } from './daycycle'
import { cityLightingUniforms } from './city-lighting-uniforms'
import { DEFAULT_WORLD_SEED } from './city-lighting'
import { cityNightModeFor, setCityNightMode } from './night-materials'
import type { QualityPreset } from './palette'

const DATA_BIN = '/models/manhattan/building-lighting.bin'
const DATA_JSON = '/models/manhattan/building-lighting.json'

/**
 * QA switch: `?cityLighting=0` keeps the materials but forces the practicals
 * to 0, i.e. the shader early-returns exactly like a pre-Phase-3C build. It
 * exists so the frame-time regression of the lighting can be measured in the
 * same tree that ships it.
 */
function cityLightingRequested(): boolean {
  if (typeof location === 'undefined') return true
  return new URLSearchParams(location.search).get('cityLighting') !== '0'
}

interface DataHeader {
  texture?: { width?: number; height?: number }
}

export function CityLightingRig({ quality }: { quality: QualityPreset }) {
  const readyRef = useRef(false)
  const textureRef = useRef<THREE.DataTexture | null>(null)
  const smooth = useRef(0)
  const nightMode = useRef(true)
  const enabled = useRef(cityLightingRequested())

  const header = useMemo<DataHeader | null>(() => null, [])

  useEffect(() => {
    if (!enabled.current) {
      cityLightingUniforms.uCityPractical.value = 0
      cityLightingUniforms.uCityPatternQuality.value = 0
      nightMode.current = false
      setCityNightMode(false)
      return
    }
    void (async () => {
      try {
        // THREE's FileLoader rather than fetch: the standalone boundary
        // forbids raw network calls in the game code, and FileLoader gets the
        // same same-origin data through the same cache.
        const jsonLoader = new THREE.FileLoader()
        const binLoader = new THREE.FileLoader()
        binLoader.setResponseType('arraybuffer')
        const [metaText, bytes] = await Promise.all([
          jsonLoader.loadAsync(DATA_JSON) as Promise<string>,
          binLoader.loadAsync(DATA_BIN) as Promise<ArrayBuffer>,
        ])
        const meta = JSON.parse(metaText) as DataHeader
        const data = new Uint8Array(bytes)
        const width = meta.texture?.width ?? 512
        const height = meta.texture?.height ?? Math.ceil(56476 / width)

        const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat)
        texture.flipY = false
        texture.magFilter = THREE.NearestFilter
        texture.minFilter = THREE.NearestFilter
        texture.generateMipmaps = false
        texture.needsUpdate = true

        cityLightingUniforms.uCityBuildingData.value = texture
        cityLightingUniforms.uCityDataWidth.value = width
        cityLightingUniforms.uCityDataHeight.value = height
        cityLightingUniforms.uCityWorldSeed.value = DEFAULT_WORLD_SEED
        textureRef.current = texture
        readyRef.current = true
      } catch (err) {
        console.warn('[CityLightingRig] failed to load building-lighting data:', err)
      }
    })()

    return () => {
      readyRef.current = false
      cityLightingUniforms.uCityBuildingData.value = null
      if (textureRef.current) {
        textureRef.current.dispose()
        textureRef.current = null
      }
    }
  }, [header])

  useFrame((_, rawDt) => {
    if (!enabled.current) return
    if (!readyRef.current || rt.paused) return
    const dt = Math.min(rawDt, 1 / 20)
    const hour = normaliseHour(rt.clock.hour)
    cityLightingUniforms.uCityHour.value = hour

    // Practicals is already a smooth day-cycle curve; a gentle lerp on top
    // guarantees no flicker even if an hour jumps (captures, debug tools).
    // Once converged, snap exactly so deterministic captures are bit-identical.
    const target = skyAt(hour, rt.clock.weather).practicals
    const error = target - smooth.current
    if (Math.abs(error) < 1e-4) smooth.current = target
    else smooth.current += error * Math.min(1, dt * 0.5)
    cityLightingUniforms.uCityPractical.value = smooth.current
    cityLightingUniforms.uCityWetness.value = rt.clock.weather.wetness

    // Day and night are two cached program variants; flipping once per
    // dusk/dawn (with hysteresis) keeps the daylight shader at baseline cost.
    const mode = cityNightModeFor(smooth.current, nightMode.current)
    if (mode !== nightMode.current) {
      nightMode.current = mode
      setCityNightMode(mode)
    }
  })

  useEffect(() => {
    cityLightingUniforms.uCityPatternQuality.value = quality === 'low' ? 0 : 1
  }, [quality])

  return null
}
