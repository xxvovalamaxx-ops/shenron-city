/**
 * City surface materials: the texture-array contract, the street material
 * routing, quality tiers and the facade material's construction.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  SURFACE_ALBEDO_URL,
  SURFACE_DATA_URL,
  SURFACE_LAYER_COUNT,
  SURFACE_LAYER_SIZE_M,
  SURFACE_MEAN_ALBEDO,
  SurfaceLayer,
  surfaceUniforms,
} from './surface-textures'
import { StreetKind, getStreetMaterial, isStreetMaterial, streetMaterialForMesh } from './street-materials'
import { getSurfaceQuality, registerSurfaceMaterial, setSurfaceQuality, surfaceQualityLevel } from './surface-quality'
import { getFarMassingMaterial } from './far-massing'
import { FACADE_FRAG_BODY, FACADE_FRAG_HEAD, FacadeMaterial } from '../../city/facade.js'
import { getBuildingNightMaterial, getRoadNightMaterial, isCityNightMaterial } from '../night-materials'

const publicFile = (webPath: string) => new URL(`../../../public${webPath}`, import.meta.url)

/** Width and height from a PNG IHDR or a JPEG SOF marker. */
function imageSize(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const v = new DataView(bytes.buffer, bytes.byteOffset)
    return { width: v.getUint32(16), height: v.getUint32(20) }
  }
  let o = 2
  while (o < bytes.length) {
    if (bytes[o] !== 0xff) throw new Error('bad JPEG marker')
    const marker = bytes[o + 1]
    const len = (bytes[o + 2] << 8) | bytes[o + 3]
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: (bytes[o + 5] << 8) | bytes[o + 6], width: (bytes[o + 7] << 8) | bytes[o + 8] }
    }
    o += 2 + len
  }
  throw new Error('no SOF marker')
}

describe('surface texture arrays', () => {
  it('describe every layer once', () => {
    expect(Object.keys(SurfaceLayer).length).toBe(SURFACE_LAYER_COUNT)
    expect(new Set(Object.values(SurfaceLayer)).size).toBe(SURFACE_LAYER_COUNT)
    expect(SURFACE_LAYER_SIZE_M.length).toBe(SURFACE_LAYER_COUNT)
    expect(SURFACE_MEAN_ALBEDO.length).toBe(SURFACE_LAYER_COUNT)
    for (const m of SURFACE_MEAN_ALBEDO) {
      for (const c of m) {
        expect(c).toBeGreaterThan(0.02)
        expect(c).toBeLessThan(0.6)
      }
    }
    expect(surfaceUniforms.uSurfInvMean.value.length).toBe(SURFACE_LAYER_COUNT)
  })

  it('ship as strips of whole square layers, in the pack script order', () => {
    for (const [url, size] of [[SURFACE_ALBEDO_URL, 1024], [SURFACE_DATA_URL, 512]] as const) {
      const { width, height } = imageSize(new Uint8Array(readFileSync(publicFile(url))))
      expect(width).toBe(size)
      expect(height).toBe(size * SURFACE_LAYER_COUNT)
    }
    const script = String(readFileSync(new URL('../../../scripts/blender/pack_surface_textures.py', import.meta.url), 'utf8'))
    const layers = [...script.matchAll(/^\s+'([a-z0-9_]+)',\s+# (\d)/gm)].map((m) => Number(m[2]))
    expect(layers).toEqual([...Array(SURFACE_LAYER_COUNT).keys()])
  })

  it('start from a placeholder of the right shape before the images land', () => {
    const albedo = surfaceUniforms.uSurfAlbedo.value
    expect(albedo.isDataArrayTexture).toBe(true)
    expect(albedo.image.depth).toBe(SURFACE_LAYER_COUNT)
    expect(albedo.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(surfaceUniforms.uSurfData.value.colorSpace).toBe(THREE.NoColorSpace)
  })
})

describe('street materials', () => {
  it('route tile meshes by exporter name', () => {
    expect(streetMaterialForMesh('ROAD_+00_-03')).toBe(getStreetMaterial(StreetKind.ROAD))
    expect(streetMaterialForMesh('SIDEWALK_+00_-03')).toBe(getStreetMaterial(StreetKind.WALK))
    expect(streetMaterialForMesh('ROADMARK_W_+00_-03')).toBe(getStreetMaterial(StreetKind.PAINT, 'white'))
    expect(streetMaterialForMesh('ROADMARK_Y_+00_-03')).toBe(getStreetMaterial(StreetKind.PAINT, 'yellow'))
    expect(streetMaterialForMesh('LAND_manhattan')).toBe(getStreetMaterial(StreetKind.LOT))
    for (const keep of ['WATER_ocean', 'PARK_ground', 'TREE_+00_-03', 'BRIDGE_decks', 'LAND_context']) {
      expect(streetMaterialForMesh(keep)).toBeNull()
    }
  })

  it('are shared, standard-based and clear of the weather wetness regex', () => {
    const legacyWet = /asphalt|concrete|kerb|walk|road|paint|land/i
    for (const kind of Object.values(StreetKind)) {
      const m = getStreetMaterial(kind)
      expect(m).toBeInstanceOf(THREE.MeshStandardMaterial)
      expect(getStreetMaterial(kind)).toBe(m)
      expect(legacyWet.test(m.name)).toBe(false)
      expect(isStreetMaterial(m)).toBe(true)
      expect(m.userData.cityShared).toBe(true)
      expect(m.defines?.STREET_KIND).toBe(kind)
    }
    expect(getStreetMaterial(StreetKind.PAINT, 'white')).not.toBe(getStreetMaterial(StreetKind.PAINT, 'yellow'))
  })

  it('the old night-material entry points return the unified materials', () => {
    const road = getRoadNightMaterial({ quality: 'medium' })
    expect(road).toBe(getStreetMaterial(StreetKind.ROAD))
    expect(isCityNightMaterial(road)).toBe(true)
    const building = getBuildingNightMaterial({ quality: 'high' })
    expect(building).toBe(getBuildingNightMaterial({ quality: 'low' }))
    expect(building.name).toBe('city-facade')
    expect(isCityNightMaterial(building)).toBe(true)
  })
})

describe('quality tiers', () => {
  it('map presets to one define and follow changes', () => {
    expect(surfaceQualityLevel('low')).toBe(0)
    expect(surfaceQualityLevel('medium')).toBe(1)
    expect(surfaceQualityLevel('high')).toBe(2)
    const m = registerSurfaceMaterial(new THREE.MeshStandardMaterial())
    const before = getSurfaceQuality()
    setSurfaceQuality('low')
    expect(m.defines?.SURFACE_Q).toBe(0)
    expect(getStreetMaterial(StreetKind.ROAD).defines?.SURFACE_Q).toBe(0)
    expect(getFarMassingMaterial().defines?.SURFACE_Q).toBe(0)
    setSurfaceQuality('high')
    expect(m.defines?.SURFACE_Q).toBe(2)
    setSurfaceQuality(before)
  })
})

describe('facade material', () => {
  it('builds without the city payload, from id-hashed families', () => {
    const f = new FacadeMaterial(null)
    expect(f.material).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(f.material.defines?.SURFACE_Q).toBeDefined()
    const data = f.buildings.image.data as Uint8Array
    // floors never zero (zero is the suppression sentinel)
    for (let i = 0; i < 4000; i++) expect(data[i * 4 + 1]).toBeGreaterThan(0)
    expect(f.suppress([5, 9])).toBe(2)
    expect(data[5 * 4 + 1]).toBe(0)
    expect(f.unsuppress()).toBe(2)
    expect(data[5 * 4 + 1]).toBeGreaterThan(0)
    f.dispose()
  })

  it('packs five palette rows and the per-building geometry texture', () => {
    const f = new FacadeMaterial(null)
    expect(f.palette.image.height).toBe(5)
    expect(f.geometry.image.width).toBe(256)
    expect(f.geometry.type).toBe(THREE.FloatType)
    f.dispose()
  })

  it('sizes its GLSL layer table from the texture constants', () => {
    expect(FACADE_FRAG_HEAD).toContain(`float[ 7 ]( ${SURFACE_LAYER_SIZE_M.map((v) => (Number.isInteger(v) ? v.toFixed(1) : String(v))).join(', ')} )`)
    // derivatives are taken before the wall/roof branch, never inside it
    const branch = FACADE_FRAG_BODY.indexOf('if ( abs( n.y ) < 0.7 )')
    expect(branch).toBeGreaterThan(0)
    expect(FACADE_FRAG_BODY.slice(branch)).not.toMatch(/\bfwidth\(|\bdFdx\(|\bdFdy\(|\btexture\(/)
  })
})
