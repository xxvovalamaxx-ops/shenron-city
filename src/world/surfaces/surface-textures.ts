/**
 * The city's surface texture set: every facade, roof, road and sidewalk
 * material samples ONE pair of texture arrays.
 *
 *   uSurfAlbedo  sRGB albedo (AO multiplied in), 1024 px per layer
 *   uSurfData    R,G = OpenGL normal XY, B = roughness, 512 px per layer
 *
 * Two samplers for the whole city, whatever the material count, is what keeps
 * the facade inside the texture-unit budget next to MeshStandardMaterial's own
 * maps (env, shadows). Each array ships as one tall image with the layers
 * stacked top to bottom; WebGL2 uploads that straight into a
 * TEXTURE_2D_ARRAY, so there is no CPU decode or repack.
 *
 * Built by scripts/blender/pack_surface_textures.py from Poly Haven CC0
 * sources; see docs/Assets/ASSET_MANIFEST.json.
 *
 * Until the images arrive the uniforms hold a 1x1 array of each layer's mean
 * colour and a flat normal, so the shaders never sample an unbound array and
 * the first frame already has the right average tone.
 */
import * as THREE from 'three'

export const SURFACE_ALBEDO_URL = '/textures/surfaces/surface_albedo.jpg'
export const SURFACE_DATA_URL = '/textures/surfaces/surface_nrm_rough.png'

/** Layer index in both arrays. Order matches the pack script's LAYERS. */
export const SurfaceLayer = {
  BRICK_RED: 0,
  BRICK_BUFF: 1,
  LIMESTONE: 2,
  CONCRETE: 3,
  SHUTTER: 4,
  ASPHALT: 5,
  SIDEWALK: 6,
} as const

export const SURFACE_LAYER_COUNT = 7

/** Real-world size of one texture repeat, metres (Poly Haven dimensions). */
export const SURFACE_LAYER_SIZE_M = [3.0, 2.0, 3.0, 2.71, 2.0, 3.0, 1.8] as const

/**
 * Mean linear albedo of each layer, printed by the pack script. The facade
 * divides a texel by its layer mean before multiplying by the building's
 * palette colour, so a texture adds variation without moving the palette.
 */
export const SURFACE_MEAN_ALBEDO: ReadonlyArray<readonly [number, number, number]> = [
  [0.1272, 0.0696, 0.0465],
  [0.3876, 0.2667, 0.1671],
  [0.3646, 0.2796, 0.1708],
  [0.2579, 0.2296, 0.1569],
  [0.1907, 0.2027, 0.2125],
  [0.0803, 0.0792, 0.0708],
  [0.2205, 0.1835, 0.1476],
]

export interface SurfaceUniforms {
  uSurfAlbedo: THREE.IUniform<THREE.DataArrayTexture>
  uSurfData: THREE.IUniform<THREE.DataArrayTexture>
  /** 1 / mean albedo per layer, so the shader multiplies instead of divides. */
  uSurfInvMean: THREE.IUniform<THREE.Vector3[]>
}

function linearToSrgbByte(v: number): number {
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.round(Math.min(1, Math.max(0, s)) * 255)
}

function placeholder(kind: 'albedo' | 'data'): THREE.DataArrayTexture {
  const data = new Uint8Array(4 * SURFACE_LAYER_COUNT)
  for (let i = 0; i < SURFACE_LAYER_COUNT; i++) {
    const o = i * 4
    if (kind === 'albedo') {
      const m = SURFACE_MEAN_ALBEDO[i]
      data[o] = linearToSrgbByte(m[0])
      data[o + 1] = linearToSrgbByte(m[1])
      data[o + 2] = linearToSrgbByte(m[2])
    } else {
      data[o] = 128
      data[o + 1] = 128
      data[o + 2] = 200
    }
    data[o + 3] = 255
  }
  const tex = new THREE.DataArrayTexture(data, 1, 1, SURFACE_LAYER_COUNT)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.colorSpace = kind === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

export const surfaceUniforms: SurfaceUniforms = {
  uSurfAlbedo: { value: placeholder('albedo') },
  uSurfData: { value: placeholder('data') },
  uSurfInvMean: {
    value: SURFACE_MEAN_ALBEDO.map((m) => new THREE.Vector3(1 / m[0], 1 / m[1], 1 / m[2])),
  },
}

let requested = false

/**
 * Upload one vertically stacked strip as a texture array. The image object
 * goes straight into texSubImage3D (a TexImageSource is legal there), which
 * slices it by `height`; flipY must stay false for 3D uploads, so layer 0 is
 * the top of the image and the shaders sample v downward.
 */
function arrayFromStrip(image: HTMLImageElement | ImageBitmap, colour: boolean): THREE.DataArrayTexture {
  const w = image.width
  const layers = Math.max(1, Math.round(image.height / w))
  const tex = new THREE.DataArrayTexture(null, w, w, layers)
  ;(tex.image as unknown as { data: unknown }).data = image
  tex.format = THREE.RGBAFormat
  tex.type = THREE.UnsignedByteType
  tex.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.flipY = false
  tex.premultiplyAlpha = false
  tex.unpackAlignment = 4
  // Roads and pavements are seen at grazing angles from eye height; without
  // anisotropy the asphalt mips to mush three metres ahead of the player.
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

/**
 * Start loading the arrays once. Idempotent; every surface material calls it
 * from its constructor, so whichever system builds first pays the request.
 */
export function ensureSurfaceTextures(): void {
  if (requested || typeof document === 'undefined') return
  requested = true
  const load = (url: string, colour: boolean, apply: (t: THREE.DataArrayTexture) => void) => {
    new THREE.ImageLoader().load(
      url,
      (image) => {
        if (image.height % image.width !== 0) {
          console.warn('[surfaces] strip is not a whole number of square layers:', url)
          return
        }
        const previous = colour ? surfaceUniforms.uSurfAlbedo.value : surfaceUniforms.uSurfData.value
        apply(arrayFromStrip(image, colour))
        previous.dispose()
      },
      undefined,
      (err) => console.warn('[surfaces] texture array failed to load:', url, err),
    )
  }
  load(SURFACE_ALBEDO_URL, true, (t) => { surfaceUniforms.uSurfAlbedo.value = t })
  load(SURFACE_DATA_URL, false, (t) => { surfaceUniforms.uSurfData.value = t })
}

/** Attach the shared array uniforms to a compiling program. */
export function attachSurfaceUniforms(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uSurfAlbedo = surfaceUniforms.uSurfAlbedo
  shader.uniforms.uSurfData = surfaceUniforms.uSurfData
  shader.uniforms.uSurfInvMean = surfaceUniforms.uSurfInvMean
}
