/**
 * Loads the Poly Haven night-city HDR and applies it as scene environment.
 *
 * The HDR provides soft fill light and subtle reflections on metallic/glossy
 * surfaces. Background stays the near-black solid color — the HDR is only
 * used for image-based lighting, not as a visible skybox.
 *
 * HDR: "Modern Buildings Night" by Greg Zaal — CC0
 * Exact source and attribution are recorded in docs/Assets/ASSET_MANIFEST.csv.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { PMREMGenerator } from 'three'

const HDR_PATH = '/hdr/modern_buildings_night_1k.hdr'

export function NightEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl)
    pmrem.compileEquirectangularShader()

    const loader = new RGBELoader()
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
      pmrem.dispose()
    }
  }, [gl, scene])

  return null
}
