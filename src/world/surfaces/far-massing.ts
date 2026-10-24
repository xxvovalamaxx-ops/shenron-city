/**
 * The far massing tiers (lod.js L2/L3/L4) as a surface material.
 *
 * Those meshes are reduced footprints and boxes with a colour per vertex and
 * no building id, so they cannot run the facade shader. What they can do is
 * agree with it at the hand-over distance: the near facade collapses to "the
 * palette mixed with the glass share" and, at night, "the expected lit share
 * of each floor". This material draws the same two things from world space
 * alone — a storey grid at the facade's typical height, a coarse cell hash
 * for per-building variation, and the same occupancy table — so the skyline
 * past 900 m keeps glowing instead of going black when the tier swaps.
 */
import * as THREE from 'three'
import { cityLightingUniforms } from '../city-lighting-uniforms'
import { CITY_HASH_GLSL, SURFACE_NOISE_GLSL } from './city-glsl'
import { registerSurfaceMaterial } from './surface-quality'

const FRAG_PARS = /* glsl */ `
uniform float uCityPractical;
uniform float uCityWetness;
uniform float uCityOcc[ 8 ];
varying vec3 vFWorld;
varying vec3 vFNrm;
${CITY_HASH_GLSL}
${SURFACE_NOISE_GLSL}
vec3 farEmis;
`

const FRAG_BODY = /* glsl */ `
{
	vec3 n = normalize( vFNrm );
	float y = vFWorld.y - 12.0;
	float fwY = fwidth( y );
	farEmis = vec3( 0.0 );
	if ( abs( n.y ) < 0.7 ) {
		// the glass share darkens a wall the way the near facade's does
		diffuseColor.rgb *= 0.82;
		// a building-sized cell, snapped to Manhattan's grid
		vec2 g = vec2( dot( vFWorld.xz, vec2( 0.875, 0.485 ) ), dot( vFWorld.xz, vec2( 0.485, -0.875 ) ) );
		vec2 cell = floor( g / vec2( 24.0, 60.0 ) );
		uint seed = cityMix2( 0x5eedc7a3u, uint( int( cell.x ) ), uint( int( cell.y ) ) ) | 1u;
		int kind = int( cityU01( cityMix1( seed, 7u ) ) * 3.0 ); // mixed, residential or office
		float occ = uCityOcc[ kind ];
		float row = floor( y / 3.4 );
		float rowShare = cityU01( cityMix2( seed, uint( int( row ) ), 0x5354u ) ) < 0.08 ? 1.0
			: clamp( occ * ( 0.4 + 0.5 * cityU01( cityMix2( seed, uint( int( row ) ), 0x77u ) ) ), 0.0, 1.0 );
		float avgShare = clamp( occ * 0.62 + 0.06, 0.0, 1.0 ) * step( 1e-4, occ );
		float share = mix( avgShare, rowShare, 1.0 - smoothstep( 0.4, 1.0, fwY / 3.4 ) );
		vec3 lamp = kind == 2 ? vec3( 0.78, 0.84, 0.97 ) : vec3( 1.0, 0.82, 0.6 );
		farEmis = lamp * share * 0.42 * uCityPractical * 1.5 * step( 0.5, y );
	}
	diffuseColor.rgb *= 1.0 - 0.18 * uCityWetness;
}
`

let shared: THREE.MeshStandardMaterial | null = null

export function getFarMassingMaterial(): THREE.MeshStandardMaterial {
  if (shared) return shared
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0,
  })
  material.name = 'city-far-massing'
  material.onBeforeCompile = (shader) => {
    for (const [name, uniform] of Object.entries(cityLightingUniforms)) {
      shader.uniforms[name] = uniform
    }
    shader.vertexShader = 'varying vec3 vFWorld;\nvarying vec3 vFNrm;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\tvFWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n\tvFNrm = normalize( mat3( modelMatrix ) * objectNormal );',
    )
    shader.fragmentShader = FRAG_PARS + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_BODY}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += farEmis;')
  }
  material.customProgramCacheKey = () => 'city-far-massing-v1'
  material.userData.cityShared = true
  shared = registerSurfaceMaterial(material)
  return shared
}
