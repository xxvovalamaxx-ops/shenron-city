/**
 * GLSL shared by every city surface shader (facades, far massing, streets).
 *
 * CITY_HASH_GLSL is a line-for-line port of hashU32/hashMix/hash01 in
 * city-lighting.ts. The window model (CITY_WINDOW_GLSL) then evaluates the
 * same `windowLitFromTable` the tests exercise, against the occupancy table
 * the CPU computes once per frame, so a lit window on screen is the lit
 * window the model says it is. uint arithmetic wraps mod 2^32 in GLSL ES 3.0
 * exactly like Math.imul does, and a negative column index converts to the
 * same bit pattern as JavaScript's `>>> 0`.
 *
 * The only divergence is the final float conversion: the shader keeps the top
 * 24 bits (exact in a float) where JavaScript divides the whole word. The two
 * differ by less than 2^-24, far below any threshold the model uses.
 */

export const CITY_HASH_GLSL = /* glsl */ `
uint cityHashU( uint x ) {
	x = ( x ^ ( x >> 16u ) ) * 0x45d9f3bu;
	x = ( x ^ ( x >> 16u ) ) * 0x45d9f3bu;
	return x ^ ( x >> 16u );
}
uint cityMix1( uint s, uint a ) {
	s = ( s ^ a ) * 0x9e3779b1u;
	return cityHashU( s );
}
uint cityMix2( uint s, uint a, uint b ) {
	s = ( s ^ a ) * 0x9e3779b1u;
	s = ( s ^ b ) * 0x9e3779b1u;
	return cityHashU( s );
}
uint cityMix3( uint s, uint a, uint b, uint c ) {
	s = ( s ^ a ) * 0x9e3779b1u;
	s = ( s ^ b ) * 0x9e3779b1u;
	s = ( s ^ c ) * 0x9e3779b1u;
	return cityHashU( s );
}
float cityU01( uint h ) {
	return float( h >> 8u ) * ( 1.0 / 16777216.0 );
}
// buildingSeed(): hashMix(worldSeed, bid) | 1
uint cityBuildingSeed( int worldSeed, int bid ) {
	return cityMix1( uint( worldSeed ), uint( bid ) ) | 1u;
}
`

/**
 * Needs the uniforms `uCityOcc[8]` (occupancyTable) and `uCityBuildingData`
 * / `uCityDataWidth` / `uCityDataHeight` (the baked per-building texel).
 */
export const CITY_WINDOW_GLSL = /* glsl */ `
struct CityBuilding {
	int kind;
	bool storefront;
	bool coreGlow;
	float density;
	float floorFill;
	uint seed;
};

CityBuilding cityBuilding( int bid ) {
	CityBuilding b;
	b.kind = 0;
	b.storefront = false;
	b.coreGlow = false;
	b.density = 0.6;
	b.floorFill = 0.6;
	b.seed = cityBuildingSeed( uCityWorldSeed, bid );
	int width = int( uCityDataWidth );
	if ( bid < 0 || bid >= width * int( uCityDataHeight ) ) return b;
	vec4 d = texelFetch( uCityBuildingData, ivec2( bid % width, bid / width ), 0 ) * 255.0;
	int kind = int( d.r + 0.5 );
	int flags = int( d.g + 0.5 );
	// unpackBuildingData(): out-of-range kinds fall back to residential
	b.kind = ( kind >= 0 && kind < 7 ) ? kind : 1;
	b.storefront = ( flags & 1 ) == 1;
	b.coreGlow = ( flags & 2 ) == 2;
	b.density = 0.3 + d.b * 0.006;
	b.floorFill = 0.2 + d.a * 0.007;
	return b;
}

// shapeRow()
float cityShapeRow( int kind, float base, float row ) {
	if ( row <= 0.0 ) return base;
	if ( kind == 1 ) return base * ( 1.0 - 0.18 * smoothstep( 18.0, 32.0, row ) );
	if ( kind == 2 ) return base * ( 1.0 - 0.45 * smoothstep( 24.0, 40.0, row ) );
	return base;
}

// windowLitFromTable()
bool cityWindowLit( CityBuilding b, int row, int col ) {
	if ( b.kind == 6 ) return false;
	float occupancy = uCityOcc[ b.kind ];
	if ( occupancy <= 0.0 ) return false;
	float th = cityShapeRow( b.kind, occupancy * b.density, float( row ) );
	if ( th <= 0.0 ) return false;
	if ( b.coreGlow && cityU01( cityMix2( b.seed, uint( row ), 0x5343u ) ) < 0.3 ) return true;
	if ( cityU01( cityMix2( b.seed, uint( row ), 0x5354u ) ) < 0.08 ) return true;
	return cityU01( cityMix2( b.seed, uint( row ), uint( col ) ) ) < th * b.floorFill;
}

// Expected lit share of a floor, for sub-pixel windows: the average of the
// decision above over columns, so distant facades glow at the right level
// without per-pixel hash noise.
float cityRowLitShare( CityBuilding b, int row ) {
	if ( b.kind == 6 ) return 0.0;
	float occupancy = uCityOcc[ b.kind ];
	if ( occupancy <= 0.0 ) return 0.0;
	float th = cityShapeRow( b.kind, occupancy * b.density, float( row ) );
	float always = cityU01( cityMix2( b.seed, uint( row ), 0x5354u ) ) < 0.08 ? 1.0 : 0.0;
	if ( b.coreGlow && cityU01( cityMix2( b.seed, uint( row ), 0x5343u ) ) < 0.3 ) always = 1.0;
	return max( always, clamp( th * b.floorFill, 0.0, 1.0 ) );
}

// Lamp colour per kind: cityWindowColour() of the Phase 3C shader.
vec3 cityLampColour( int kind, float jitter ) {
	if ( kind == 2 ) return vec3( 0.78, 0.84, 0.97 ) * ( 1.0 + jitter * 0.08 );
	if ( kind == 3 ) return vec3( 1.0, 0.74, 0.44 ) * ( 1.0 + jitter * 0.15 );
	if ( kind == 4 ) return vec3( 1.0, 0.76, 0.48 ) * ( 1.0 + jitter * 0.2 );
	if ( kind == 5 ) return vec3( 0.82, 0.88, 0.92 ) * ( 1.0 + jitter * 0.1 );
	if ( kind == 1 ) return vec3( 1.0, 0.8, 0.56 ) * ( 1.0 + jitter * 0.18 );
	return vec3( 1.0, 0.85, 0.66 ) * ( 1.0 + jitter * 0.14 );
}

// roomStyle(): x = dressing, y = warmth, z = wall palette index, w = cover
vec4 cityRoomStyle( uint seed, int row, int col ) {
	float h = cityU01( cityMix3( seed, uint( row ), uint( col ), 0x2f1u ) );
	float dressing = h < 0.42 ? 0.0 : h < 0.66 ? 1.0 : h < 0.88 ? 2.0 : 3.0;
	return vec4( dressing, fract( h * 7.31 ), floor( fract( h * 13.7 ) * 6.0 ), fract( h * 29.3 ) );
}

// shutterClosed() with the retail slot of the table
bool cityShutterClosed( uint seed, int shop ) {
	float open = uCityOcc[ 7 ];
	float th = 0.1 + 0.6 * clamp( 1.0 - open / 0.72, 0.0, 1.0 );
	return cityU01( cityMix2( seed, 0x5c7u, uint( shop ) ) ) < th;
}
`

/** Cheap hash noise; no textures, so it costs ALU only. */
export const SURFACE_NOISE_GLSL = /* glsl */ `
float sHash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
vec2 sHash22( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.xx + p3.yz ) * p3.zy );
}
float sHash11( float p ) {
	p = fract( p * 0.1031 );
	p *= p + 33.33;
	p *= p + p;
	return fract( p );
}
float sNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = sHash12( i );
	float b = sHash12( i + vec2( 1.0, 0.0 ) );
	float c = sHash12( i + vec2( 0.0, 1.0 ) );
	float d = sHash12( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float sFbm( vec2 p ) {
	float v = sNoise( p ) * 0.5;
	v += sNoise( p * 2.03 + 17.1 ) * 0.25;
	v += sNoise( p * 4.11 + 41.7 ) * 0.125;
	return v / 0.875;
}
// Anti-aliased [a, b] window on x: one pixel of falloff from fwidth, so a
// facade at a grazing angle does not alias into stair-steps or speckle.
float sBand( float x, float a, float b ) {
	float w = max( fwidth( x ), 1e-5 );
	return clamp( ( x - a ) / w + 0.5, 0.0, 1.0 ) * clamp( ( b - x ) / w + 0.5, 0.0, 1.0 );
}
float sRect( vec2 p, vec2 lo, vec2 hi ) {
	return sBand( p.x, lo.x, hi.x ) * sBand( p.y, lo.y, hi.y );
}
// The same with the pixel footprint passed in, for use inside branches:
// derivatives are only defined in uniform control flow, so a shader that
// branches takes fwidth once, up front, and hands it down.
float sBandW( float x, float a, float b, float w ) {
	w = max( w, 1e-5 );
	return clamp( ( x - a ) / w + 0.5, 0.0, 1.0 ) * clamp( ( b - x ) / w + 0.5, 0.0, 1.0 );
}
float sRectW( vec2 p, vec2 lo, vec2 hi, vec2 w ) {
	return sBandW( p.x, lo.x, hi.x, w.x ) * sBandW( p.y, lo.y, hi.y, w.y );
}
// Tangent-space normal from the packed data array (RG = XY).
vec3 sUnpackNormal( vec2 rg, float strength ) {
	vec2 xy = ( rg * 2.0 - 1.0 ) * strength;
	return vec3( xy, sqrt( max( 1.0 - dot( xy, xy ), 0.0 ) ) );
}
`
