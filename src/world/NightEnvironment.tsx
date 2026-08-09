/**
 * The night-city HDR, applied as image-based lighting *when it is night*.
 *
 * The HDR provides soft fill light and subtle reflections on metallic and
 * glossy surfaces. The background stays whatever sky.js and weather.js have
 * installed — this is lighting, never a visible skybox.
 *
 * It used to be applied once and left. The effect's dependency array is
 * [gl, scene], neither of which changes after mount, and nothing in the file
 * referenced the clock — so a *night* environment map lit the city at every
 * hour, including noon. That is the defect the Opus brief names in as many
 * words ("no fixed night HDR lighting the daytime city incorrectly") and it is
 * why the first frames of a fresh session read almost black.
 *
 * Now the intensity follows `nightFactor`, the same curve city-lighting.ts
 * uses to decide when windows come on, so the environment and the windows
 * agree about when night is. At noon it contributes nothing; the sun and
 * hemisphere lights from buildSky own the daytime look.
 *
 * HDR: "Modern Buildings Night" by Greg Zaal — CC0
 * Exact source and attribution are recorded in docs/Assets/ASSET_MANIFEST.csv.
 */
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { PMREMGenerator } from 'three'
import { rt } from '../gameplay/runtime'
import { useSimulationStage } from '../gameplay/useSimulationStage'
import { nightFactor } from './city-lighting'

const HDR_PATH = '/hdr/modern_buildings_night_1k.hdr'
/** Intensity at full night. Scaled to zero across dawn and dusk. */
const ENVIRONMENT_INTENSITY = 0.2

export function NightEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  /** Null until the HDR lands; the intensity must not be driven before then. */
  const ready = useRef(false)

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()

    const loader = new HDRLoader()
    let disposed = false

    loader.load(
      HDR_PATH,
      (texture) => {
        if (disposed) {
          texture.dispose()
          return
        }
        const envMap = pmrem.fromEquirectangular(texture).texture
        scene.environment = envMap
        scene.environmentIntensity = environmentIntensityFor(rt.clock.hour)
        ready.current = true
        texture.dispose()
        pmrem.dispose()
      },
      undefined,
      (err) => {
        if (!disposed) console.warn('[NightEnvironment] HDR load failed:', err)
      },
    )

    return () => {
      disposed = true
      if (scene.environment) {
        scene.environment.dispose()
        scene.environment = null
      }
      scene.environmentIntensity = 1
      ready.current = false
      pmrem.dispose()
    }
  }, [gl, scene])

  // Presentation only: reads the clock, writes one scalar, integrates nothing.
  // Safe on a paused frame, which is why it does not check `paused` — the
  // environment must stay lit behind the pause menu.
  useSimulationStage('night-environment', 'presentation', () => {
    if (!ready.current) return
    scene.environmentIntensity = environmentIntensityFor(rt.clock.hour)
  })

  return null
}

/**
 * Environment-map intensity for an hour of the day.
 *
 * Zero through the middle of the day so a night HDR contributes nothing to a
 * noon scene, rising to ENVIRONMENT_INTENSITY at full night. Kept pure and
 * exported so the curve is testable without a renderer.
 */
export function environmentIntensityFor(hour: number): number {
  if (!Number.isFinite(hour)) return 0
  return ENVIRONMENT_INTENSITY * nightFactor(hour as Parameters<typeof nightFactor>[0])
}
