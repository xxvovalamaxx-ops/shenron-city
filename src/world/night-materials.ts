/**
 * Phase 3C night materials: lit windows on the real OSM building facades.
 *
 * The island's BLD_* meshes carry `_bid` (per-building id, decoded by Draco)
 * and the baked building-lighting texture maps that id to a night
 * personality. Both the window and road shaders are injected into
 * MeshStandardMaterial via onBeforeCompile, so every standard feature —
 * lighting, shadows, fog, vertex colours, tone mapping — keeps working and
 * the only added cost is a fragment term.
 *
 * Determinism: every pattern decision is a pure integer hash of
 * (world seed, bid, floor, column). Nothing reads a clock or a random
 * source, so a fixed seed reproduces the exact same city and a different
 * seed only moves windows. The GLSL mirrors the tested JS model in
 * src/world/city-lighting.ts.
 *
 * Daytime off-state: every emissive term is multiplied by uCityPractical,
 * which is 0 in daylight, so the day render is unchanged apart from a
 * uniform branch. Cost during the day is a handful of ALU ops per fragment.
 */
import * as THREE from 'three'
import type { QualityPreset } from './palette'
import { cityLightingUniforms } from './city-lighting-uniforms'

/* ------------------------------------------------------------------ hash -- */

const CITY_HASH_GLSL = /* glsl */ `
uint cityHashU( uint x ) {
	x = ( x ^ ( x >> 16u ) ) * 73062203u;
	x = ( x ^ ( x >> 16u ) ) * 73062203u;
	x = x ^ ( x >> 16u );
	return x;
}
float cityHash01( int seed, int a, int b, int c ) {
	uint h = uint( seed ) ^ 0x9e3779b9u;
	h = ( h ^ uint( a ) ) * 2654435769u;
	h = ( h ^ uint( b ) ) * 2654435769u;
	h = ( h ^ uint( c ) ) * 2654435769u;
	return float( cityHashU( h ) ) * 0.00000000023283064365386963;
}
`

const CITY_NIGHT_PARS_VERTEX = /* glsl */ `
attribute float _bid;
varying vec3 vCityWorldPos;
varying vec3 vCityNormal;
varying float vCityBid;
`

const CITY_NIGHT_BEGIN_VERTEX = /* glsl */ `
	vCityWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vCityNormal = normalize( mat3( modelMatrix ) * transformedNormal );
	vCityBid = _bid;
`

const CITY_NIGHT_PARS_FRAGMENT = /* glsl */ `
uniform float uCityPractical;
uniform float uCityHour;
uniform int uCityWorldSeed;
uniform float uCityWetness;
uniform sampler2D uCityBuildingData;
uniform float uCityDataWidth;
uniform float uCityDataHeight;
uniform float uCityPatternQuality;
uniform float uCityGroundY;
uniform int uCityDebugMode;
varying vec3 vCityWorldPos;
varying vec3 vCityNormal;
varying float vCityBid;

#ifdef CITY_NIGHT
${CITY_HASH_GLSL}

const int KIND_MIXED = 0;
const int KIND_RESIDENTIAL = 1;
const int KIND_OFFICE = 2;
const int KIND_HOTEL = 3;
const int KIND_RETAIL = 4;
const int KIND_INDUSTRIAL = 5;
const int KIND_DARK = 6;

vec3 cityWindowColour( int kind, float jitter ) {
	if ( kind == KIND_OFFICE ) return vec3( 0.78, 0.83, 0.95 ) * ( 1.0 + jitter * 0.08 );
	if ( kind == KIND_HOTEL ) return vec3( 1.0, 0.78, 0.45 ) * ( 1.0 + jitter * 0.15 );
	if ( kind == KIND_RETAIL ) return vec3( 1.0, 0.72, 0.4 ) * ( 1.0 + jitter * 0.2 );
	if ( kind == KIND_INDUSTRIAL ) return vec3( 0.8, 0.85, 0.9 ) * ( 1.0 + jitter * 0.1 );
	if ( kind == KIND_RESIDENTIAL ) return vec3( 1.0, 0.85, 0.62 ) * ( 1.0 + jitter * 0.18 );
	return vec3( 1.0, 0.88, 0.7 ) * ( 1.0 + jitter * 0.14 );
}

vec3 cityWindowGlow( vec3 p, vec3 n, float bidF ) {
	if ( uCityPractical < 0.004 ) return vec3( 0.0 );
	if ( uCityDebugMode == 1 ) return vec3( 1.0, 0.5, 0.2 );
	if ( uCityDebugMode == 2 ) {
		float b = clamp( bidF / 57000.0, 0.0, 1.0 );
		return vec3( b, 1.0 - b, 0.0 );
	}
	if ( uCityDebugMode == 3 ) {
		int dbid = int( floor( bidF + 0.5 ) );
		vec4 d = texelFetch( uCityBuildingData, ivec2( dbid % int( uCityDataWidth ), dbid / int( uCityDataWidth ) ), 0 );
		return vec3( d.r / 7.0, d.g / 3.0, d.b / 255.0 );
	}
	if ( uCityDebugMode == 4 ) {
		float hh = cityHash01( uCityWorldSeed ^ int( floor( bidF + 0.5 ) ), 3, 7, 0 );
		return vec3( hh, hh, hh );
	}
	if ( uCityDebugMode == 5 ) return vec3( 0.0 ); // buildings off, roads on
	// Roofs and pavement skip the whole window pass: they cannot face the
	// street. This is also the biggest single cost cut at street level.
	if ( abs( n.y ) > 0.7 ) return vec3( 0.0 );
	int bid = int( floor( bidF + 0.5 ) );
	if ( bid < 0 ) return vec3( 0.0 );
	int width = int( uCityDataWidth );
	int height = int( uCityDataHeight );
	if ( bid >= width * height ) return vec3( 0.0 );
	vec4 d = texelFetch( uCityBuildingData, ivec2( bid % width, bid / width ), 0 );
	int kind = int( d.r );
	int flags = int( d.g );
	if ( kind == KIND_DARK ) return vec3( 0.0 );
	bool storefront = ( flags & 1 ) == 1;
	bool coreGlow = ( flags & 2 ) == 2;
	float density = 0.3 + d.b * 0.006;
	float floorFill = 0.2 + d.a * 0.007;

	int seed = uCityWorldSeed ^ bid;

	// Night fraction and occupancy follow the same smooth shoulders as the
	// daycycle clock; a different hour only drifts this, never jumps it.
	float hour = uCityHour;
	float night = 1.0 - smoothstep( 4.5, 6.5, hour ) + smoothstep( 18.5, 20.5, hour );
	float base = 0.5;
	float evening = 0.1;
	if ( kind == KIND_RESIDENTIAL ) { base = 0.66; evening = 0.05; }
	else if ( kind == KIND_OFFICE ) { base = 0.1; evening = 0.06; }
	else if ( kind == KIND_HOTEL ) { base = 0.85; evening = 0.0; }
	else if ( kind == KIND_RETAIL ) { base = 0.14; evening = 0.22; }
	else if ( kind == KIND_INDUSTRIAL ) { base = 0.16; evening = 0.04; }
	float ev = smoothstep( 17.0, 19.0, hour ) * ( 1.0 - smoothstep( 20.5, 23.0, hour ) );
	float occ = night * ( base + evening * ev );

	float rowU = ( p.y - uCityGroundY ) / 3.0;
	if ( rowU < -0.5 ) return vec3( 0.0 );
	int frow = int( floor( rowU ) );

	float th = occ * density;
	if ( kind == KIND_RESIDENTIAL ) th *= 1.0 - 0.18 * smoothstep( 18.0, 32.0, float( frow ) );
	else if ( kind == KIND_OFFICE ) th *= 1.0 - 0.45 * smoothstep( 24.0, 40.0, float( frow ) );

	// Facade-aligned world grid: the along-facade axis is picked from the
	// normal, so diagonal buildings still read as a window grid.
	float ax = abs( n.x ) > abs( n.z ) ? p.z : p.x;
	float colJitter = ( cityHash01( seed, 0x1103, 0, 0 ) * 2.0 - 1.0 ) * 0.9;
	float cuv = ( ax + colJitter ) / 3.3;
	float cellX = fract( cuv );
	float cellY = fract( rowU );
	int icol = int( floor( cuv ) );

	// fwidth-smoothed window mask: sub-pixel windows dissolve into the
	// aggregate facade glow instead of shimmering — the LOD-compatible
	// distant representation.
	float fwx = fwidth( cuv );
	float fwy = fwidth( rowU );
	float winW = 0.13 + 0.06 * density;
	float maskX = 1.0 - smoothstep( 0.0, fwx, abs( cellX - 0.5 ) - ( 0.5 - winW ) );
	float maskY = 1.0 - smoothstep( 0.0, fwy, abs( cellY - 0.5 ) - 0.13 );
	float mask = maskX * maskY;

	float lit = 0.0;
	// One hash feeds the lit decision, the colour jitter and the storefront
	// variation, so a facade costs four hash calls, not eight.
	float hc = cityHash01( seed, frow, icol, 0x17 );
	if ( uCityPatternQuality > 0.5 ) {
		lit = hc < th * floorFill ? 1.0 : 0.0;
		// Service cores and stairwell rows stay lit regardless of occupancy.
		float rowAlways = cityHash01( seed, frow, 0x5343, 0 );
		if ( rowAlways < ( coreGlow ? 0.38 : 0.08 ) ) lit = 1.0;
	} else {
		// Coarse preset: whole-floor decision, no per-column hash.
		float r = cityHash01( seed, frow, 0x1122, 0x1122 );
		lit = r < th ? 1.0 : 0.0;
	}

	float jitter = fract( hc * 7.31 ) * 2.0 - 1.0;
	vec3 glow = cityWindowColour( kind, jitter ) * mask * lit * uCityPractical * 1.35;

	// Ground-floor storefront band: the retail spine of the city. Brighter
	// than the windows above it, warm, with hash-varied sign panels.
	if ( storefront && frow == 0 ) {
		float band = 1.0 - smoothstep( 0.0, 0.35, abs( cellY - 0.5 ) - 0.22 );
		float s1 = cityHash01( seed, 0x77, icol, 0 );
		float signPanel = s1 < 0.22 ? 1.45 : 1.0;
		float sBright = ( 0.45 + 0.55 * fract( s1 * 5.3 ) ) * signPanel;
		glow += vec3( 1.0, 0.74, 0.47 ) * band * sBright * uCityPractical * 2.0;
	}
	return glow;
}
#endif
`

const CITY_ROAD_PARS_FRAGMENT = /* glsl */ `
uniform float uCityPractical;
uniform float uCityHour;
uniform float uCityWetness;
uniform int uCityWorldSeed;
varying vec3 vCityWorldPos;
varying vec3 vCityNormal;

#ifdef CITY_NIGHT
${CITY_HASH_GLSL}

vec3 cityRoadLighting( vec3 p, vec3 n ) {
	if ( uCityPractical < 0.004 ) return vec3( 0.0 );
	if ( abs( n.y ) < 0.85 ) return vec3( 0.0 );
	vec2 pz = p.xz;
	vec3 glow = vec3( 0.0 );
	float fw = max( fwidth( pz.x ), fwidth( pz.y ) );

	// Streetlight pools on the 30 m street grid, placed by hash so the same
	// streets light the same way every night. The four cells containing the
	// pixel cover every pool within light range (sigma 6 m).
	vec2 c0 = floor( pz / 30.0 );
	for ( int i = 0; i < 4; i++ ) {
		vec2 off = vec2( float( i & 1 ), float( i >> 1 ) );
		vec2 c = c0 + off;
		int ci = int( c.x ) * 73856093 ^ int( c.y ) * 19349663;
		float hp = cityHash01( ci, 1, 0, 0 );
		if ( hp > 0.72 ) continue;
		vec2 pos = c * 30.0 + vec2( fract( hp * 3.1 ), fract( hp * 5.7 ) ) * 18.0 - vec2( 9.0 );
		vec2 d = pz - pos;
		float dist2 = dot( d, d );
		float pool = exp( -dist2 / 72.0 );
		float bright = 0.55 + 0.45 * fract( hp * 9.3 );
		glow += vec3( 1.0, 0.75, 0.45 ) * pool * bright * 0.85;
	}

	// Deterministic vehicle lights: parked and drifting traffic as small
	// headlight/taillight pairs on the street. Time-gated by uCityPractical
	// like everything else; no live traffic telemetry exists here.
	vec2 v0 = floor( pz / 9.0 );
	for ( int i = 0; i < 4; i++ ) {
		vec2 off = vec2( float( i & 1 ), float( i >> 1 ) );
		vec2 c = v0 + off;
		int ci = int( c.x ) * 196613 ^ int( c.y ) * 3467;
		float hc = cityHash01( ci, 5, 0, 0 );
		if ( hc > 0.09 ) continue;
		bool tail = fract( hc * 3.7 ) > 0.5;
		bool vertical = fract( hc * 7.9 ) > 0.5;
		vec2 pos = c * 9.0 + vec2( fract( hc * 11.3 ), fract( hc * 13.7 ) ) * 6.0 - vec2( 3.0 );
		vec2 d = pz - pos;
		float along = vertical ? d.y : d.x;
		float across = vertical ? d.x : d.y;
		float head = abs( along ) - 0.65;
		float spotA = 1.0 - smoothstep( 0.22, 0.22 + fw, sqrt( head * head + across * across ) );
		vec3 colour = tail ? vec3( 1.0, 0.14, 0.1 ) : vec3( 1.0, 0.95, 0.8 );
		glow += colour * spotA * ( tail ? 0.4 : 0.34 );
	}

	// Wet asphalt carries the glow further; dry reads tight.
	return glow * uCityPractical * ( 0.7 + 0.5 * uCityWetness );
}
#endif
`

/* ------------------------------------------------------------------ hooks -- */

const CITY_NIGHT_CACHE_KEY = 'city-night-v1'
const CITY_ROAD_CACHE_KEY = 'city-road-v1'

function vertexHook(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = CITY_NIGHT_PARS_VERTEX + '\n' + shader.vertexShader
  shader.vertexShader = shader.vertexShader.replace(
    '#include <worldpos_vertex>',
    '#include <worldpos_vertex>\n' + CITY_NIGHT_BEGIN_VERTEX,
  )
}

function attachCityUniforms(shader: THREE.WebGLProgramParametersWithUniforms) {
  for (const [name, uniform] of Object.entries(cityLightingUniforms)) {
    shader.uniforms[name] = uniform
  }
}

function buildingFragmentHook(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = CITY_NIGHT_PARS_FRAGMENT + '\n' + shader.fragmentShader
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n#ifdef CITY_NIGHT\n\ttotalEmissiveRadiance += cityWindowGlow( vCityWorldPos, vCityNormal, vCityBid );\n#endif',
  )
  attachCityUniforms(shader)
}

function roadFragmentHook(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = CITY_ROAD_PARS_FRAGMENT + '\n' + shader.fragmentShader
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n#ifdef CITY_NIGHT\n\ttotalEmissiveRadiance += cityRoadLighting( vCityWorldPos, vCityNormal );\n#endif',
  )
  attachCityUniforms(shader)
}

/**
 * Day and night compile as two cached program variants of the same material.
 * In daylight the CITY_NIGHT block is compiled out entirely, so the daytime
 * cost of the lighting is one uniform branch — this is what keeps the day
 * pass at baseline frame time. The rig flips this once per dusk/dawn with
 * hysteresis, so it never oscillates.
 */
export function setCityNightMode(enabled: boolean): void {
  for (const material of buildingMaterialCache.values()) {
    if (enabled) material.defines = { CITY_NIGHT: '' }
    else delete material.defines?.CITY_NIGHT
    material.needsUpdate = true
  }
  for (const material of roadMaterialCache.values()) {
    if (enabled) material.defines = { CITY_NIGHT: '' }
    else delete material.defines?.CITY_NIGHT
    material.needsUpdate = true
  }
}

/** Night mode with hysteresis: on once practical > 0.55, off once < 0.45. */
export function cityNightModeFor(practical: number, current: boolean): boolean {
  if (current) return practical > 0.45
  return practical > 0.55
}

/* -------------------------------------------------------------- factories -- */

interface NightMaterialOptions {
  quality: QualityPreset
}

const buildingMaterialCache = new Map<QualityPreset, THREE.MeshStandardMaterial>()
const roadMaterialCache = new Map<QualityPreset, THREE.MeshStandardMaterial>()

/**
 * One shared material per quality preset for every BLD_* mesh in the city.
 * Sharing matters: a program compiled once per preset, not once per tile.
 */
export function getBuildingNightMaterial(options: NightMaterialOptions): THREE.MeshStandardMaterial {
  const cached = buildingMaterialCache.get(options.quality)
  if (cached) return cached

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.08,
    side: THREE.DoubleSide,
  })
  material.onBeforeCompile = (shader) => {
    vertexHook(shader)
    buildingFragmentHook(shader)
  }
  material.customProgramCacheKey = () => CITY_NIGHT_CACHE_KEY
  material.userData.cityNight = true
  cityLightingUniforms.uCityPatternQuality.value = options.quality === 'low' ? 0 : 1
  buildingMaterialCache.set(options.quality, material)
  return material
}

/** One shared material per quality preset for every ROAD_* mesh. */
export function getRoadNightMaterial(options: NightMaterialOptions): THREE.MeshStandardMaterial {
  const cached = roadMaterialCache.get(options.quality)
  if (cached) return cached

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.02,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `
varying vec3 vCityWorldPos;
varying vec3 vCityNormal;
` + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n\tvCityWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvCityNormal = normalize( mat3( modelMatrix ) * transformedNormal );',
    )
    roadFragmentHook(shader)
  }
  material.customProgramCacheKey = () => CITY_ROAD_CACHE_KEY
  material.userData.cityNight = true
  roadMaterialCache.set(options.quality, material)
  return material
}

/** Materials owned by the city-night system, so tile disposal must skip them. */
export function isCityNightMaterial(material: THREE.Material): boolean {
  return material.userData.cityNight === true
}

// Dev-only handle for the perf A/B: flips the compiled variant in-page, so
// the frame-time cost of the lighting is measured against identical content.
if (import.meta.env.DEV) {
  ;(globalThis as unknown as { __setCityNightMode: typeof setCityNightMode }).__setCityNightMode =
    setCityNightMode
}
