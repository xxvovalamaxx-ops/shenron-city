/**
 * Global shader patches: aerial-perspective height fog and a shadow edge fade.
 *
 * Both go into three's ShaderChunk library rather than into individual
 * materials, because the city's materials have four different owners (the
 * facade and road shaders, the life-engine Lambert materials, the GLTF
 * standard materials, the vehicle paint). A chunk patch reaches all of them,
 * including ones written after this, with no per-material setup — which is
 * also why cascaded shadow maps (CSM.js) were ruled out: CSM overwrites every
 * material's onBeforeCompile and would break the facade shader.
 *
 * Fog: three's stock fog is a flat colour mixed in by view depth. This keeps
 * three's uniforms and fallback (a material whose uniforms lack ours still
 * gets stock fog), and replaces the maths with
 *   - exponential distance haze plus an analytic height-fog integral, denser
 *     at street level and thinning with altitude, so the aerial view looks
 *     down through the haze instead of into a grey wall;
 *   - a colour that warms toward the sun and cools away from it, the same
 *     function the sky dome uses at its horizon, so the far city dissolves
 *     into the sky instead of ending at a line;
 *   - a hard floor at `fogFar` so the streaming edge never shows.
 *
 * Shadows: a single camera-following shadow map ends somewhere. Fading the
 * shadow term over the last few percent of the map turns that edge into a
 * gradient that the haze swallows.
 *
 * Must run before the first frame: three caches built-in programs by
 * parameters, not by chunk source.
 */
import * as THREE from 'three'
import { atmosphereGlobals } from './lighting-state'

/** GLSL shared by the fog chunk and the sky dome. Expects the atmo uniforms. */
export const ATMO_HAZE_GLSL = /* glsl */ `
vec3 atmoHaze( vec3 dir ) {
	float s = max( dot( dir, atmoSunDir ), 0.0 );
	// broad warm wedge plus a tighter glow straight at the sun
	float w = 0.55 * pow( s, atmoFog2.y ) + 0.45 * pow( s, atmoFog2.y * 4.0 );
	// a level ray looks through the most air, so the sun wedge hugs the horizon
	w *= mix( 1.0, 0.55, clamp( dir.y * 3.0, 0.0, 1.0 ) );
	return mix( atmoHazeAway, atmoHazeSun, clamp( w, 0.0, 1.0 ) );
}
`

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vAtmoWorld;
#endif
`

// World position from the view-space position, valid for any rigid view
// matrix: w = R^T (v - t). Needs nothing the chunk does not already have.
const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vAtmoWorld = ( vec4( mvPosition.xyz - viewMatrix[ 3 ].xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vAtmoWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	uniform vec3 atmoSunDir;
	uniform vec3 atmoHazeSun;
	uniform vec3 atmoHazeAway;
	uniform vec4 atmoFog;
	uniform vec4 atmoFog2;
	${ATMO_HAZE_GLSL}
	float atmoFogAmount( vec3 camPos, vec3 dir, float dist ) {
		float start = atmoFog2.w;
		float d = max( dist - start, 0.0 );
		float h0 = camPos.y + dir.y * min( dist, start ) - atmoFog.w;
		float b = atmoFog.z;
		float x = b * dir.y * d;
		float F = abs( x ) < 1e-3 ? 1.0 - 0.5 * x : ( 1.0 - exp( - x ) ) / x;
		float optical = atmoFog.x * d + atmoFog.y * exp( - b * max( h0, - 40.0 ) ) * d * F;
		float f = 1.0 - exp( - optical );
		f = max( f, smoothstep( atmoFog2.x * 0.55, atmoFog2.x, dist ) );
		return clamp( f, 0.0, 1.0 );
	}
#endif
`

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 atmoFogColor = fogColor;
	if ( atmoFog2.z > 0.5 ) {
		vec3 atmoRay = vAtmoWorld - cameraPosition;
		float atmoDist = length( atmoRay );
		vec3 atmoDir = atmoRay / max( atmoDist, 1e-4 );
		fogFactor = atmoFogAmount( cameraPosition, atmoDir, atmoDist );
		atmoFogColor = atmoHaze( atmoDir );
		// Stock three mixes fog after tone mapping and the output transfer;
		// take the haze through the same path so the low preset (tone mapped
		// on screen) and the post chain (linear HDR) agree.
		#ifdef TONE_MAPPING
			atmoFogColor = toneMapping( atmoFogColor );
		#endif
		atmoFogColor = linearToOutputTexel( vec4( atmoFogColor, 1.0 ) ).rgb;
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, atmoFogColor, fogFactor );
#endif
`

const SHADOW_RETURN = 'return mix( 1.0, shadow, shadowIntensity );'
const SHADOW_RETURN_FADED = /* glsl */ `
			vec2 atmoEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy );
			float atmoEdgeFade = smoothstep( 0.0, 0.09, min( atmoEdge.x, atmoEdge.y ) );
			return mix( 1.0, shadow, shadowIntensity * atmoEdgeFade );`

/** The uniforms the patched chunks read, pointing at the shared globals. */
export function atmosphereFogUniforms(): Record<string, THREE.IUniform> {
  return {
    atmoSunDir: { value: atmosphereGlobals.sunDir },
    atmoHazeSun: { value: atmosphereGlobals.hazeSun },
    atmoHazeAway: { value: atmosphereGlobals.hazeAway },
    atmoFog: { value: atmosphereGlobals.fog },
    atmoFog2: { value: atmosphereGlobals.fog2 },
  }
}

let installed = false

export function installAtmosphereChunks(): void {
  if (installed) return
  installed = true

  const chunks = THREE.ShaderChunk as unknown as Record<string, string>
  chunks.fog_pars_vertex = FOG_PARS_VERTEX
  chunks.fog_vertex = FOG_VERTEX
  chunks.fog_pars_fragment = FOG_PARS_FRAGMENT
  chunks.fog_fragment = FOG_FRAGMENT

  // Only the 2D getShadow() variants: point-light shadows sample a cube and
  // have no frustum edge to fade.
  const shadow = chunks.shadowmap_pars_fragment
  const split = shadow.indexOf('getPointShadow')
  if (split > 0) {
    const head = shadow.slice(0, split).split(SHADOW_RETURN).join(SHADOW_RETURN_FADED)
    chunks.shadowmap_pars_fragment = head + shadow.slice(split)
  }

  // Built-in materials clone their uniforms from ShaderLib at compile time;
  // ShaderMaterials with fog merge UniformsLib.fog. Give both our entries.
  const lib = THREE.UniformsLib as unknown as Record<string, Record<string, THREE.IUniform>>
  Object.assign(lib.fog, atmosphereFogUniforms())
  const shaderLib = THREE.ShaderLib as unknown as Record<string, { uniforms: Record<string, THREE.IUniform> }>
  for (const key of Object.keys(shaderLib)) {
    const entry = shaderLib[key]
    if (entry?.uniforms && 'fogColor' in entry.uniforms) {
      Object.assign(entry.uniforms, atmosphereFogUniforms())
    }
  }
}
