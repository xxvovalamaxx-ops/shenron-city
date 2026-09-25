/**
 * Loads the Poly Haven night-city HDR for the night half of the IBL bake.
 *
 * The scene's environment is no longer a fixed photo: it is baked from the
 * procedural sky every time the light changes (world/atmosphere/environment).
 * This HDR is blended into that bake after dark, so glossy car paint and
 * glass reflect a real lit street at night instead of an empty sky. It is
 * never a visible skybox.
 *
 * HDR: "Modern Buildings Night" by Greg Zaal — CC0
 * Exact source and attribution are recorded in docs/Assets/ASSET_MANIFEST.csv.
 */
import { useEffect } from 'react'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { setNightHdr } from './atmosphere/night-hdr'

const HDR_PATH = '/hdr/modern_buildings_night_1k.hdr'

export function NightEnvironment() {
  useEffect(() => {
    const loader = new HDRLoader()
    let disposed = false
    let loaded: { dispose(): void } | null = null

    loader.load(
      HDR_PATH,
      (texture) => {
        if (disposed) {
          texture.dispose()
          return
        }
        loaded = texture
        setNightHdr(texture)
      },
      undefined,
      (err) => {
        if (!disposed) console.warn('[NightEnvironment] HDR load failed:', err)
      },
    )

    return () => {
      disposed = true
      setNightHdr(null)
      loaded?.dispose()
    }
  }, [])

  return null
}
