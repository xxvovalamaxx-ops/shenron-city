/**
 * The sky dome: gradient, sun, moon, stars, city glow and a cloud deck.
 *
 * One shader, drawn on a camera-centred sphere pinned to the far plane (so it
 * is always behind the city and costs nothing where buildings cover it — it
 * is drawn last among opaques and early-z rejects those pixels).
 *
 * The same shader, with `ENV_BAKE` defined, renders the environment cube the
 * image-based lighting is filtered from. In that variant the lower part of
 * the sphere is a procedural skyline and street instead of open sky: from
 * street level a Manhattan facade sees buildings, not horizon, and car paint
 * should reflect a row of lit windows at night rather than empty haze.
 *
 * Sky model: an art-directed Rayleigh-style gradient (zenith to a bright
 * horizon, with the (1 + mu^2) phase lift toward and away from the sun), a
 * Henyey-Greenstein Mie lobe around the sun, a limb-darkened sun disk hot
 * enough to bloom, twilight carried by the shared haze function, and at night
 * a moon, hashed stars and orange light pollution over the horizon.
 *
 * Clouds: a 2D fbm deck at 2.2 km, intersected per pixel along the view ray,
 * so the perspective is right from the street and from the air. Lighting is a
 * two-tap density gradient toward the sun (bright sunward rims, darker bases)
 * plus a forward-scatter silver lining; coverage follows the weather.
 */
import * as THREE from 'three'
import { ATMO_HAZE_GLSL, atmosphereFogUniforms } from './shader-chunks'

export const CLOUD_BASE_ALTITUDE = 2200

export interface SkyUniforms {
  [name: string]: THREE.IUniform
  uMoonDir: THREE.IUniform<THREE.Vector3>
  uZenith: THREE.IUniform<THREE.Color>
  uHorizon: THREE.IUniform<THREE.Color>
  uMie: THREE.IUniform<THREE.Color>
  uSunDisk: THREE.IUniform<THREE.Color>
  uMoonColor: THREE.IUniform<THREE.Color>
  uLightPollution: THREE.IUniform<THREE.Color>
  uCloudLit: THREE.IUniform<THREE.Color>
  uCloudShade: THREE.IUniform<THREE.Color>
  uKeyColor: THREE.IUniform<THREE.Color>
  uKeyDir: THREE.IUniform<THREE.Vector3>
  uNightAmbient: THREE.IUniform<THREE.Color>
  uCamPos: THREE.IUniform<THREE.Vector3>
  uCloudOffset: THREE.IUniform<THREE.Vector2>
  uSunDiskI: THREE.IUniform<number>
  uMoonI: THREE.IUniform<number>
  uStars: THREE.IUniform<number>
  uCover: THREE.IUniform<number>
  uNight: THREE.IUniform<number>
  uPracticals: THREE.IUniform<number>
  uTime: THREE.IUniform<number>
  uSkyline: THREE.IUniform<number>
}

/** One uniform set shared by the dome and the environment bake. */
export function createSkyUniforms(): SkyUniforms {
  return {
    ...atmosphereFogUniforms(),
    uMoonDir: { value: new THREE.Vector3(0, 0.5, 0.8).normalize() },
    uZenith: { value: new THREE.Color(0.05, 0.15, 0.45) },
    uHorizon: { value: new THREE.Color(0.45, 0.55, 0.7) },
    uMie: { value: new THREE.Color(1, 0.9, 0.8) },
    uSunDisk: { value: new THREE.Color(1, 0.95, 0.9) },
    uMoonColor: { value: new THREE.Color(0.85, 0.9, 1) },
    uLightPollution: { value: new THREE.Color(0, 0, 0) },
    uCloudLit: { value: new THREE.Color(1, 1, 1) },
    uCloudShade: { value: new THREE.Color(0.5, 0.55, 0.62) },
    uKeyColor: { value: new THREE.Color(1, 1, 1) },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uNightAmbient: { value: new THREE.Color(0, 0, 0) },
    uCamPos: { value: new THREE.Vector3() },
    uCloudOffset: { value: new THREE.Vector2() },
    uSunDiskI: { value: 40 },
    uMoonI: { value: 0 },
    uStars: { value: 0 },
    uCover: { value: 0.35 },
    uNight: { value: 0 },
    uPracticals: { value: 0 },
    uTime: { value: 0 },
    uSkyline: { value: 1 },
  }
}

const VERTEX = /* glsl */ `
varying vec3 vSkyDir;
void main() {
	// The dome is centred on the camera and never rotated, so the local
	// position is the view direction.
	vSkyDir = position;
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	gl_Position = projectionMatrix * mv;
	// Pin to the far plane: behind everything, and early-z rejected.
	gl_Position.z = gl_Position.w;
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 atmoSunDir;
uniform vec3 atmoHazeSun;
uniform vec3 atmoHazeAway;
uniform vec4 atmoFog;
uniform vec4 atmoFog2;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uMie;
uniform vec3 uSunDisk;
uniform vec3 uMoonColor;
uniform vec3 uLightPollution;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uKeyColor;
uniform vec3 uKeyDir;
uniform vec3 uNightAmbient;
uniform vec3 uCamPos;
uniform vec2 uCloudOffset;
uniform float uSunDiskI;
uniform float uMoonI;
uniform float uStars;
uniform float uCover;
uniform float uNight;
uniform float uPracticals;
uniform float uTime;
uniform float uSkyline;
varying vec3 vSkyDir;

${ATMO_HAZE_GLSL}

float skyHash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

float skyHash13( vec3 p3 ) {
	p3 = fract( p3 * 0.1031 );
	p3 += dot( p3, p3.zyx + 31.32 );
	return fract( ( p3.x + p3.y ) * p3.z );
}

float skyNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = skyHash12( i );
	float b = skyHash12( i + vec2( 1.0, 0.0 ) );
	float c = skyHash12( i + vec2( 0.0, 1.0 ) );
	float d = skyHash12( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

float skyFbm( vec2 p ) {
	float v = 0.0;
	float a = 0.5;
	mat2 rot = mat2( 0.8, 0.6, - 0.6, 0.8 );
	for ( int i = 0; i < CLOUD_OCTAVES; i ++ ) {
		v += a * skyNoise( p );
		p = rot * p * 2.03 + vec2( 17.1, 9.3 );
		a *= 0.5;
	}
	return v;
}

float henyeyGreenstein( float mu, float g ) {
	float g2 = g * g;
	return ( 1.0 - g2 ) / ( 12.566371 * pow( max( 1.0 + g2 - 2.0 * g * mu, 1e-4 ), 1.5 ) );
}

// Cloud deck: rgb colour, a coverage.
vec4 skyClouds( vec3 dir, float mu, vec3 haze ) {
	float height = ${CLOUD_BASE_ALTITUDE.toFixed(1)} - uCamPos.y;
	if ( dir.y < 0.015 || height < 50.0 ) return vec4( 0.0 );
	float t = height / dir.y;
	vec2 p = ( uCamPos.xz + dir.xz * t + uCloudOffset ) / 2600.0;

	// A slow domain warp breaks the fbm's grid into drifting cloud streets.
	vec2 warp = vec2( skyNoise( p * 0.35 + 3.1 ), skyNoise( p * 0.35 - 7.7 ) ) - 0.5;
	p += warp * 0.9;

	float n = skyFbm( p );
	float threshold = mix( 0.70, 0.26, uCover );
	float density = smoothstep( threshold, threshold + 0.24, n );
	if ( density <= 0.001 ) return vec4( 0.0 );

	// Density gradient toward the sun: thinner sunward means lit.
	vec2 toSun = atmoSunDir.xz;
	float sunLen = length( toSun );
	toSun = sunLen > 1e-3 ? toSun / sunLen : vec2( 0.0, 1.0 );
	float nSun = skyFbm( p + toSun * 0.09 );
	float shade = clamp( ( nSun - n ) * 5.0 + 0.45, 0.0, 1.0 );
	float thick = smoothstep( threshold, threshold + 0.55, n );
	vec3 col = mix( uCloudLit, uCloudShade, clamp( shade * 0.75 + thick * 0.55, 0.0, 1.0 ) );

	// Silver lining: thin edges glow when the sun is behind them.
	float edge = 1.0 - smoothstep( 0.0, 0.8, density );
	col += uMie * henyeyGreenstein( mu, 0.62 ) * edge * 2.2;

	// Far cloud dissolves into the horizon haze.
	float far = 1.0 - exp( - t / 26000.0 );
	col = mix( col, haze, far * 0.85 );
	float fade = smoothstep( 0.015, 0.14, dir.y ) * ( 1.0 - far * 0.55 );
	return vec4( col, density * fade * mix( 0.92, 1.0, uCover ) );
}

vec3 skyStars( vec3 dir ) {
	vec3 p = dir * 190.0;
	vec3 cell = floor( p );
	float h = skyHash13( cell );
	if ( h < 0.972 ) return vec3( 0.0 );
	vec3 offset = vec3( skyHash13( cell + 11.3 ), skyHash13( cell + 23.1 ), skyHash13( cell + 37.7 ) ) - 0.5;
	vec3 f = fract( p ) - 0.5 - offset * 0.6;
	float px = max( length( fwidth( p ) ), 1e-4 );
	float radius = max( px * 0.9, 0.035 );
	float star = smoothstep( radius, 0.0, length( f ) ) * ( 0.04 / radius );
	float twinkle = 0.75 + 0.25 * sin( uTime * ( 1.3 + h * 7.0 ) + h * 91.0 );
	float mag = pow( ( h - 0.972 ) / 0.028, 3.0 );
	vec3 tint = mix( vec3( 0.75, 0.85, 1.0 ), vec3( 1.0, 0.9, 0.75 ), skyHash13( cell + 5.0 ) );
	return tint * star * mag * twinkle * 0.9;
}

vec3 skyMoon( vec3 dir ) {
	float md = dot( dir, uMoonDir );
	const float R = 0.0235;              // angular radius, exaggerated for a game
	vec3 col = uMoonColor * ( pow( max( md, 0.0 ), 900.0 ) * 0.25 + pow( max( md, 0.0 ), 60.0 ) * 0.02 );
	float cosR = cos( R );
	if ( md > cosR ) {
		// Reconstruct the lit sphere: disk coordinates in the moon's tangent plane.
		vec3 up = abs( uMoonDir.y ) < 0.99 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
		vec3 tx = normalize( cross( up, uMoonDir ) );
		vec3 ty = cross( uMoonDir, tx );
		vec2 uv = vec2( dot( dir, tx ), dot( dir, ty ) ) / sin( R );
		float r2 = dot( uv, uv );
		vec3 n = normalize( tx * uv.x + ty * uv.y - uMoonDir * sqrt( max( 1.0 - r2, 0.0 ) ) );
		// Waning gibbous: lit from a direction off to one side of the viewer.
		vec3 lightDir = normalize( - uMoonDir + tx * 0.55 + ty * 0.1 );
		float lit = clamp( dot( - n, - lightDir ) * 1.2 + 0.08, 0.0, 1.0 );
		float maria = skyFbm( uv * 2.2 + 4.0 );
		float albedo = mix( 1.0, 0.62, smoothstep( 0.45, 0.62, maria ) );
		float edge = smoothstep( 1.0, 0.92, r2 );
		col += uMoonColor * albedo * lit * edge * 3.2;
	}
	return col * uMoonI;
}

#ifdef ENV_BAKE
// The city around the viewer, as radiance an environment map can hold:
// building silhouettes up to ~15 degrees and the street below. Their
// brightness is estimated from the actual light (albedo x (key + sky)), so
// a shaded facade gets warm bounce off sunlit walls and pavement, which is
// most of what keeps a street canyon from going black.
vec3 cityAmbient() {
	return mix( uZenith, uHorizon, 0.55 ) + uNightAmbient;
}

vec3 streetRadiance() {
	vec3 lit = uKeyColor * clamp( uKeyDir.y, 0.0, 1.0 ) * 0.3183;
	vec3 street = 0.2 * ( lit + cityAmbient() * 0.9 );
	// warm pools under the street lights
	return street + vec3( 1.0, 0.6, 0.28 ) * 0.03 * uPracticals;
}

vec3 skyline( vec3 dir, vec3 haze, inout float isCity ) {
	float az = atan( dir.z, dir.x );
	float colIx = floor( az * 30.0 / 3.14159265 );
	float h1 = skyHash12( vec2( colIx, 3.0 ) );
	float h2 = skyHash12( vec2( floor( az * 11.0 / 3.14159265 ), 7.0 ) );
	float top = ( 0.04 + 0.2 * h1 * h1 + 0.1 * h2 ) * uSkyline;
	if ( dir.y > top ) return vec3( 0.0 );
	isCity = 1.0;
	vec3 flat_ = normalize( vec3( dir.x, 0.0, dir.z ) + 1e-5 );
	vec3 keyFlat = normalize( vec3( uKeyDir.x, 0.0, uKeyDir.z ) + 1e-5 );
	// We see the face whose normal is -dir; it is lit when it faces the key.
	float facing = max( dot( - flat_, keyFlat ), 0.0 ) * sqrt( max( 1.0 - uKeyDir.y * uKeyDir.y, 0.0 ) );
	vec3 wall = 0.3 * ( uKeyColor * facing * 0.3183 * 1.5 + cityAmbient() * 0.5 ) + streetRadiance() * 0.3;
	// Night: rows of warm windows.
	vec2 grid = vec2( az * 180.0 / 3.14159265, dir.y * 140.0 );
	vec2 cell = floor( grid );
	float on = step( 0.62, skyHash12( cell + colIx * 13.0 ) );
	vec2 f = fract( grid );
	float pane = step( 0.25, f.x ) * step( f.x, 0.75 ) * step( 0.3, f.y ) * step( f.y, 0.75 );
	wall += vec3( 1.0, 0.72, 0.42 ) * on * pane * uPracticals * 0.35;
	// Distance haze on the far blocks.
	return mix( wall, haze, 0.2 );
}
#endif

void main() {
	vec3 dir = normalize( vSkyDir );
	float mu = dot( dir, atmoSunDir );
	float up = max( dir.y, 0.0 );
	vec3 haze = atmoHaze( dir );

	// Rayleigh-style gradient: deep zenith, bright horizon, phase lift.
	float horizonT = pow( 1.0 - up, 4.0 );
	vec3 col = mix( uZenith, uHorizon, horizonT );
	col *= 0.86 + 0.14 * ( 1.0 + mu * mu );
	// The last few degrees are the haze itself, the colour fog blends to.
	col = mix( col, haze, pow( 1.0 - up, 14.0 ) );

	// Mie: a wide warm lobe around the sun.
	col += uMie * ( henyeyGreenstein( mu, 0.76 ) * 0.28 + henyeyGreenstein( mu, 0.35 ) * 0.25 );

	// City glow: sodium light scattered back down from the haze layer.
	col += uLightPollution * ( exp( - up * 7.0 ) * 0.85 + 0.15 );

	// Night sky objects fade out into the city glow near the horizon.
	float skyClear = smoothstep( 0.0, 0.22, dir.y );
	col += skyStars( dir ) * uStars * skyClear;
	col += skyMoon( dir ) * smoothstep( -0.02, 0.06, dir.y );

	// Sun disk with limb darkening.
	float sunCos = cos( 0.0095 );
	float disk = smoothstep( sunCos - 0.00002, sunCos + 0.00004, mu );
	if ( disk > 0.0 ) {
		float r = clamp( ( 1.0 - mu ) / ( 1.0 - sunCos ), 0.0, 1.0 );
		float limb = 1.0 - 0.55 * ( 1.0 - sqrt( max( 1.0 - r, 0.0 ) ) );
		col += uSunDisk * uSunDiskI * disk * limb * smoothstep( -0.012, 0.004, dir.y );
	}

	vec4 cloud = skyClouds( dir, mu, haze );
	col = mix( col, cloud.rgb, cloud.a );

	// Below the horizon there is only haze (the fog's far colour).
	col = mix( col, haze, smoothstep( 0.0, - 0.04, dir.y ) );

	#ifdef ENV_BAKE
		float isCity = 0.0;
		vec3 city = skyline( dir, haze, isCity );
		col = mix( col, city, isCity );
		// The night fill lives in the environment only, never on screen.
		col += uNightAmbient * ( 1.0 - isCity ) * step( 0.0, dir.y );
		if ( dir.y < 0.0 ) {
			col = mix( col, streetRadiance(), smoothstep( 0.0, - 0.08, dir.y ) );
		}
	#endif

	gl_FragColor = vec4( max( col, vec3( 0.0 ) ), 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`

export function createSkyMaterial(
  uniforms: SkyUniforms,
  options: { envBake?: boolean; octaves?: number } = {},
): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    name: options.envBake ? 'AtmosphereSkyEnv' : 'AtmosphereSky',
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: {
      CLOUD_OCTAVES: options.octaves ?? 5,
      ...(options.envBake ? { ENV_BAKE: '' } : {}),
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
    fog: false,
  })
  return material
}
