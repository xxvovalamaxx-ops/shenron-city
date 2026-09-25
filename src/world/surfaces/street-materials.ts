/**
 * Street surfaces: asphalt, lane paint, sidewalk flags and kerbs, and the
 * open ground between them.
 *
 * One shader, four variants (STREET_KIND define), all MeshStandardMaterial
 * underneath so the sky environment, the sun's shadows and fog apply. The
 * layers are world-space and laid along Manhattan's street grid (29 degrees
 * off true north): the meshes carry no UVs, and flags, patches and seams that
 * run with the streets are most of what makes a pavement read as New York.
 *
 *   ROAD   patched, cracked asphalt; utility cuts, tar-sealed cracks,
 *          manhole covers; two texture scales so the 3 m repeat never shows
 *   PAINT  the same asphalt under worn lane paint (so a line blends into the
 *          road it sits on)
 *   WALK   concrete flags with joints, stained and replaced flags, gum spots;
 *          a concrete kerb on the vertical faces
 *   LOT    the island's catch-all ground: aged asphalt and concrete in large
 *          patches, for plazas, lots and anything the street layer misses
 *
 * Wet mode reads `uCityWetness` (the runtime clock's wetness, the value the
 * old road material used): porous darkening, a lower roughness, and puddles
 * from noise that go to a near-mirror so the environment and the bloomed
 * lights reflect. Night lighting is not baked in anywhere: the old
 * hash-placed emissive "street-light pools" and fake headlight dots are gone,
 * because street light is the lighting pass's job (pools under the real lamp
 * props), and a sodium tint belongs to the light, not to the asphalt.
 */
import * as THREE from 'three'
import { cityLightingUniforms } from '../city-lighting-uniforms'
import { CITY_HASH_GLSL, SURFACE_NOISE_GLSL } from './city-glsl'
import { attachSurfaceUniforms, ensureSurfaceTextures, SurfaceLayer } from './surface-textures'
import { registerSurfaceMaterial } from './surface-quality'

export const StreetKind = {
  ROAD: 0,
  PAINT: 1,
  WALK: 2,
  LOT: 3,
} as const

export type StreetKindValue = (typeof StreetKind)[keyof typeof StreetKind]

const VERTEX_PARS = /* glsl */ `
varying vec3 vSWorld;
varying vec3 vSNrm;
`

const VERTEX_BODY = /* glsl */ `
	vSWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vSNrm = normalize( mat3( modelMatrix ) * objectNormal );
`

const FRAG_PARS = /* glsl */ `
uniform float uCityPractical;
uniform float uCityWetness;
uniform int uCityWorldSeed;
uniform sampler2DArray uSurfAlbedo;
uniform sampler2DArray uSurfData;
uniform vec3 uSurfInvMean[ 7 ];
uniform vec3 uPaintColour;
varying vec3 vSWorld;
varying vec3 vSNrm;

${CITY_HASH_GLSL}
${SURFACE_NOISE_GLSL}

vec3 sNormalW;
float sRough;
float sMetal;

`

const FRAG_BODY = /* glsl */ `
{
	vec3 P = vSWorld;
	vec3 n = normalize( vSNrm );
	// Manhattan grid frame: x across the avenues, y along them
	vec2 g = vec2( dot( P.xz, vec2( 0.875, 0.485 ) ), dot( P.xz, vec2( 0.485, -0.875 ) ) );
	vec2 fwG = fwidth( g );
	float fwM = max( fwG.x, fwG.y );
	float dist = length( P - cameraPosition );
	float wet = uCityWetness;
	float nearK = 1.0 - smoothstep( 40.0, 220.0, dist );

	vec3 col;
	float rough;
	float metal = 0.0;
	vec3 nW = vec3( 0.0, 1.0, 0.0 );
	float puddleBias = 0.0;
	float porous = 0.5;   // how much a wet surface darkens

	// asphalt (road, paint base, lots); two scales blended by noise so the
	// 3 m texture repeat never lines up across a wide avenue
	vec2 auv = g / 3.0;
	vec2 auvX = dFdx( auv );
	vec2 auvY = dFdy( auv );
	vec2 buv = g / 7.3 + vec2( 0.31, 0.77 );
	vec2 buvX = dFdx( buv );
	vec2 buvY = dFdy( buv );

#if STREET_KIND == 2
	// derivatives up front: top and kerb faces share quads along every edge
	vec2 fuv = g / 4.5;
	vec2 fuvX = dFdx( fuv );
	vec2 fuvY = dFdy( fuv );
	vec3 kt = normalize( vec3( n.z, 0.0, -n.x ) + 1e-5 );
	vec2 kuv = vec2( dot( P.xz, kt.xz ), -P.y ) / 2.71;
	vec2 kuvX = dFdx( kuv );
	vec2 kuvY = dFdy( kuv );
	if ( n.y > 0.6 ) {
		// ---- sidewalk flags: the texture's joints at ~1.1 m, on the grid
		vec3 a = textureGrad( uSurfAlbedo, vec3( fuv, 6.0 ), fuvX, fuvY ).rgb;
		col = a * 1.25;
		vec2 flag = floor( g / 1.125 );
		vec2 fh = sHash22( flag + 91.0 );
		col *= 0.88 + 0.24 * fh.x;
		// stained flags and the odd new one
		col = mix( col, col * vec3( 0.72, 0.7, 0.68 ), step( 0.86, fh.y ) );
		col = mix( col, col * 1.22, step( fh.y, 0.05 ) );
		// gum: dark flat spots, the most New York thing on a sidewalk
		vec2 gc = floor( g / 0.4 );
		vec2 gh = sHash22( gc + 13.0 );
		float gd = length( g - ( gc + 0.2 + 0.6 * gh ) * 0.4 );
		float gum = ( 1.0 - smoothstep( 0.025, 0.025 + fwM, gd ) ) * step( gh.x, 0.1 ) * nearK;
		col = mix( col, vec3( 0.06, 0.055, 0.05 ), gum * 0.8 );
		col *= 0.82 + 0.3 * sFbm( g * 0.06 );
		rough = 0.88;
		porous = 0.35;
#if SURFACE_Q > 0
		vec4 td = textureGrad( uSurfData, vec3( fuv, 6.0 ), fuvX, fuvY );
		vec3 nT = sUnpackNormal( td.rg, 0.9 * nearK );
		nW = normalize( vec3( 0.875, 0.0, 0.485 ) * nT.x + vec3( 0.485, 0.0, -0.875 ) * nT.y + vec3( 0.0, 1.0, 0.0 ) * nT.z );
		rough = mix( rough, td.b, 0.5 );
#endif
	} else {
		// ---- kerb: concrete with a dirty foot
		vec3 a = textureGrad( uSurfAlbedo, vec3( kuv, 3.0 ), kuvX, kuvY ).rgb * uSurfInvMean[ 3 ];
		col = vec3( 0.3, 0.29, 0.27 ) * a;
		col *= 0.6 + 0.4 * smoothstep( 12.05, 12.2, P.y );
		nW = n;
		rough = 0.8;
		porous = 0.3;
	}
#else
	vec3 a1 = textureGrad( uSurfAlbedo, vec3( auv, 5.0 ), auvX, auvY ).rgb;
	vec3 a2 = textureGrad( uSurfAlbedo, vec3( buv, 5.0 ), buvX, buvY ).rgb;
	float blendN = smoothstep( 0.35, 0.65, sNoise( g * 0.045 ) );
	col = mix( a1, a2, blendN ) * 1.15;
	// sun-bleached older asphalt vs fresh dark resurfacing, in big patches
	float aged = sFbm( g * 0.018 + 3.0 );
	col *= mix( 0.72, 1.38, aged );
	rough = 0.9;
#if STREET_KIND == 3
	// open ground: old concrete slabs over large areas, asphalt elsewhere
	vec2 suv = g / 4.5;
	vec3 conc = textureGrad( uSurfAlbedo, vec3( suv, 6.0 ), dFdx( suv ), dFdy( suv ) ).rgb * 1.1;
	float slabs = smoothstep( 0.45, 0.55, sFbm( g * 0.01 + 11.0 ) );
	col = mix( col, conc * ( 0.75 + 0.3 * sFbm( g * 0.05 ) ), slabs );
	porous = mix( 0.5, 0.35, slabs );
#endif
	// utility cuts: rectangles on a 7 x 4 m grid, tar-sealed at the edges
	vec2 cellSz = vec2( 7.0, 4.0 );
	vec2 cell = floor( g / cellSz );
	vec2 cf = g - cell * cellSz;
	vec2 ph = sHash22( cell + 3.1 );
	float ph2 = sHash12( cell + 8.7 );
	vec2 plo = vec2( 0.3 + ph.y * 1.5, 0.3 + ph.x * 1.2 );
	vec2 psz = vec2( 1.2 + ph2 * 4.8, 0.7 + ph.y * 2.2 );
	float patchM = sRectW( cf, plo, plo + psz, fwG ) * step( ph.x, 0.3 );
	float seal = patchM * ( 1.0 - sRectW( cf, plo + 0.05, plo + psz - 0.05, fwG ) );
	col = mix( col, col * ( ph2 < 0.5 ? 0.62 : 1.3 ), patchM );
	col = mix( col, vec3( 0.018 ), seal * 0.9 );
	puddleBias += patchM * 0.12;
	// tar-sealed cracks: thin glossy snakes
	float cn = sNoise( g * 0.32 + 5.0 );
	float cw = fwidth( cn );
	float crack = ( 1.0 - smoothstep( 0.01, 0.01 + cw * 1.5, abs( cn - 0.5 ) ) ) * smoothstep( 0.62, 0.75, sNoise( g * 0.11 + 2.0 ) );
	col = mix( col, vec3( 0.02 ), crack * 0.7 );
	float sealRough = max( seal, crack );
	// manhole and utility covers
	vec2 mc = floor( g / 11.0 );
	vec2 mh = sHash22( mc + 17.0 );
	vec2 mpos = ( mc + 0.25 + mh * 0.5 ) * 11.0;
	vec2 md = g - mpos;
	float mr = length( md );
	float isCover = step( sHash12( mc + 41.0 ), 0.16 );
	float cover = ( 1.0 - smoothstep( 0.34, 0.34 + fwM, mr ) ) * isCover;
	float rim = cover * smoothstep( 0.28, 0.3, mr );
	float studs = step( 0.5, fract( md.x * 9.0 ) ) * step( 0.5, fract( md.y * 9.0 ) ) * nearK;
	vec3 iron = vec3( 0.055, 0.05, 0.045 ) * ( 0.8 + 0.5 * studs ) * ( 1.0 - 0.4 * rim );
	col = mix( col, iron, cover );
	rough = mix( rough, 0.42, sealRough * 0.7 );
	rough = mix( rough, 0.45 + 0.2 * studs, cover );
	metal = cover * 0.7;
#if SURFACE_Q > 0
	vec4 td = textureGrad( uSurfData, vec3( auv, 5.0 ), auvX, auvY );
	vec3 nT = sUnpackNormal( td.rg, 1.0 * nearK );
	nW = normalize( vec3( 0.875, 0.0, 0.485 ) * nT.x + vec3( 0.485, 0.0, -0.875 ) * nT.y + vec3( 0.0, 1.0, 0.0 ) * nT.z );
	rough = mix( rough, clamp( td.b, 0.6, 1.0 ), 0.5 * ( 1.0 - cover ) );
	nW = normalize( mix( nW, vec3( 0.0, 1.0, 0.0 ), cover * 0.7 ) );
#endif
#if STREET_KIND == 1
	// worn lane paint over the same asphalt: tyres wear it through in
	// blotches, and the texture's grain shows in what is left
	float lum = dot( a1, vec3( 0.333 ) ) * 8.0;
	float wear = sFbm( g * vec2( 0.9, 0.35 ) + 21.0 );
	float paint = smoothstep( 0.28, 0.46, wear * 0.75 + lum * 0.2 + 0.08 );
	col = mix( col, uPaintColour * ( 0.85 + 0.25 * lum ), paint );
	rough = mix( rough, 0.62, paint );
	porous = mix( porous, 0.25, paint );
	nW = normalize( mix( nW, vec3( 0.0, 1.0, 0.0 ), paint * 0.6 ) );
	metal = 0.0;
#endif
#endif

	// ---- wet: porous darkening, a sheen, then puddles in the low spots
	{
		float wetK = wet * ( n.y > 0.6 ? 1.0 : 0.6 );
		col *= 1.0 - min( porous * 1.25, 0.75 ) * wetK;
		rough = mix( rough, 0.3, wetK * 0.85 );
		float pn = sFbm( g * 0.16 + 7.0 ) * 0.75 + sNoise( g * 0.8 + 1.0 ) * 0.25 + puddleBias;
#if STREET_KIND == 2
		float edge = 0.84;
#else
		float edge = 0.8;
#endif
		float puddle = smoothstep( edge - 0.16 * wetK, edge - 0.13 * wetK, pn ) * wetK * step( 0.6, n.y );
		col *= 1.0 - 0.45 * puddle;
		rough = mix( rough, 0.02, puddle );
		metal *= 1.0 - puddle;
		nW = normalize( mix( nW, vec3( 0.0, 1.0, 0.0 ), max( puddle, wetK * 0.5 ) ) );
	}

	diffuseColor.rgb = col;
	sNormalW = nW;
	sRough = rough;
	sMetal = metal;
}
`

const materials = new Map<number, THREE.MeshStandardMaterial>()

const PAINT: Record<string, THREE.Color> = {
  white: new THREE.Color(0.62, 0.61, 0.58),
  yellow: new THREE.Color(0.55, 0.36, 0.04),
}

function build(kind: StreetKindValue, paint: 'white' | 'yellow' = 'white'): THREE.MeshStandardMaterial {
  ensureSurfaceTextures()
  const paintColour = { value: PAINT[paint].clone() }
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 })
  // Named clear of the weather's legacy wetness regex: this shader does its
  // own wet look from uCityWetness, and a second darkening would double it.
  material.name = `city-surface-${['tarmac', 'lines', 'flags', 'ground'][kind]}${kind === StreetKind.PAINT ? `-${paint}` : ''}`
  material.defines = { STREET_KIND: kind }
  if (kind === StreetKind.PAINT) {
    material.polygonOffset = true
    material.polygonOffsetFactor = -1
    material.polygonOffsetUnits = -2
  } else if (kind === StreetKind.LOT) {
    // The island's base ground lies a few centimetres under roads, parks and
    // sidewalks, which is nothing at 500 m in a 24-bit depth buffer. Pushed
    // back, it can only ever show where nothing else covers it.
    material.polygonOffset = true
    material.polygonOffsetFactor = 2
    material.polygonOffsetUnits = 4
  }
  material.onBeforeCompile = (shader) => {
    for (const [name, uniform] of Object.entries(cityLightingUniforms)) {
      shader.uniforms[name] = uniform
    }
    attachSurfaceUniforms(shader)
    shader.uniforms.uPaintColour = paintColour
    shader.vertexShader = VERTEX_PARS + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${VERTEX_BODY}`,
    )
    shader.fragmentShader = FRAG_PARS + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_BODY}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = sRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = sMetal;')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = normalize( ( viewMatrix * vec4( sNormalW, 0.0 ) ).xyz );',
      )
  }
  material.customProgramCacheKey = () => `city-street-v2-${kind}`
  material.userData.cityShared = true
  material.userData.citySurface = kind
  return registerSurfaceMaterial(material)
}

/** One shared material per kind (and paint colour) for the whole city. */
export function getStreetMaterial(kind: StreetKindValue, paint: 'white' | 'yellow' = 'white'): THREE.MeshStandardMaterial {
  const key = kind === StreetKind.PAINT ? (paint === 'yellow' ? 11 : 10) : kind
  let material = materials.get(key)
  if (!material) {
    material = build(kind, paint)
    materials.set(key, material)
  }
  return material
}

/**
 * Which street material a tile mesh gets, by its exporter name. Null means
 * "leave the exporter's material alone" (water, parks, bridges, trees).
 */
export function streetMaterialForMesh(name: string): THREE.MeshStandardMaterial | null {
  const upper = name.toUpperCase()
  if (upper.startsWith('ROADMARK_Y')) return getStreetMaterial(StreetKind.PAINT, 'yellow')
  if (upper.startsWith('ROADMARK')) return getStreetMaterial(StreetKind.PAINT, 'white')
  if (upper.startsWith('ROAD_')) return getStreetMaterial(StreetKind.ROAD)
  if (upper.startsWith('SIDEWALK')) return getStreetMaterial(StreetKind.WALK)
  if (upper === 'LAND_MANHATTAN') return getStreetMaterial(StreetKind.LOT)
  return null
}

/** True for materials owned by this module (tile disposal must skip them). */
export function isStreetMaterial(material: THREE.Material): boolean {
  return material.userData.citySurface !== undefined
}

/** For tests and tools: the surface layer each street kind samples. */
export const STREET_LAYERS = {
  [StreetKind.ROAD]: SurfaceLayer.ASPHALT,
  [StreetKind.PAINT]: SurfaceLayer.ASPHALT,
  [StreetKind.WALK]: SurfaceLayer.SIDEWALK,
  [StreetKind.LOT]: SurfaceLayer.ASPHALT,
} as const
